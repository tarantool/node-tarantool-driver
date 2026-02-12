const Command = require('../Command');
const PipelineResponse = require('./PipelineResponse');
const { noop } = require('lodash');
const {symbols: {
    pipelined: pipelinedSym
}} = require('../const');

class Pipeline {
    pipelinedCommands = [];

    /**
     * Creates a new Pipeline instance
     * @param {TarantoolConnection} self - Parent connection instance
     */
    constructor(self) {
        this._parent = self;
    }

    /**
     * Executes all pipelined commands in a single batch
     * @public
     * @returns {Promise<PipelineResponse>} Response object containing results for each command
     */
    exec() {
        // if not connected
        if (!this._parent.isConnectedState()) this._parent.connect().catch(noop);
        // wait until connection is fully established
        if (this._parent.pendingPromises?.connect) {
            return this._parent.pendingPromises.connect
            .then(() => this.exec());
        };

        const promises = [];
        const buffers = [];
        for (const [command, args] of this.pipelinedCommands) {
            promises.push(
                new Promise((resolve) => {
                    try {
                        const func = command.function;
                        const originalCb = args[command.argsLen];
                        args[command.argsLen] = function cbInterceptor (error, result) {
                            if (error) {
                                resolve([error, null]);
                            } else {
                                resolve([null, result]);
                            }

                            if (originalCb) originalCb(error, result);
                        }
                        const buffer = func.apply(this._parent, args);
                        buffers.push(buffer);
                    } catch (error) {
                        resolve([error, null]);
                    }
                })
            );
        }

        this.flushPipelined();
        const concatenatedBuffer = Buffer.concat(buffers);
        this._parent.connector.write(concatenatedBuffer, null, () => {
            this._parent.bufferPool.releaseBuffer(concatenatedBuffer);
        });

        return Promise.all(promises)
        .then(function (result) {
            return new PipelineResponse(result);
        });
    }

    /**
     * Clears the pipelined commands queue
     * @public
     */
    flushPipelined() {
        this.pipelinedCommands = [];
    }
}

Command.list.map((name) => {
    Pipeline.prototype[name] = function commandInterceptor() {
        const optsPos = Command.commands[name].optsPos;
        const args = [...arguments];
        if (args[optsPos]) {
            args[optsPos][pipelinedSym] = true;
        } else {
            args[optsPos] = {
                [pipelinedSym]: true
            };
        }

        this.pipelinedCommands.push([
            Command.commands[name],
            args
        ]);
        return this;
    };
});

/**
 * Creates a new Pipeline instance
 * Allows queuing commands for batch execution
 * May be created only once and reused multiple times
 * @public
 * @returns {Pipeline} Pipeline instance
 */
module.exports.pipeline = function () {
    return new Pipeline(this);
};