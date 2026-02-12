const { EventEmitter } = require('events');
const { withResolvers, applyMixin, parseOptions } = require('./utils');
const debug = require('./utils/debug').extend('main');
const { mergeWith, noop, defaults } = require('lodash');
const MsgPack = require('./MsgPack');
const { revertStates, states, Iterators, defaultOptions, symbols: {
    bypassOfflineQueue: bypassOfflineQueueSym,
    pipelined: pipelinedSym
} } = require('./const');
const { pipeline } = require('./pipeline/Pipeline');
const PipelineResponse = require('./pipeline/PipelineResponse');
const { createTransaction } = require('./Transaction');
const parser = require('./parser');
const AutoPipeliner = require('./pipeline/AutoPipeliner');
const eventHandler = require('./event-handler');
const Commander = require('./Commander');
const OfflineQueue = require('./OfflineQueue');
const { TarantoolError, ReplyError } = require('./errors');
const { format, deprecate } = require('node:util');
const PreparedStatement = require('./PreparedStatement');
const {setFastTimeout} = require('./utils/FastTimer');
const {commandsNum} = require('./Command');

class TarantoolConnection extends Commander {
    static MsgPack = MsgPack;
    static PreparedStatement = PreparedStatement;
    static PipelineResponse = PipelineResponse;
    static errors = {
        ReplyError,
        TarantoolError
    };
    static iterators = Iterators;

    connect = connect;
    destroy = deprecate(
        disconnect,
        '\'.destroy()\' method is deprecated. Use \'.disconnect()\' instead.',
        'Tarantool-Driver'
    );
    disconnect = disconnect;
    quit = quit;
    useNextReserve = useNextReserve;
    setState = setState;
    silentEmit = silentEmit;
    errorHandler = eventHandler.errorHandler;
    _awaitSentCommandsDrain = _awaitSentCommandsDrain;

    // parser
    processResponse = parser.processResponse;
    _returnBool = parser._returnBool;

    // pipeline
    pipeline = pipeline;

    transaction = createTransaction;

    offlineQueue = new OfflineQueue(this);
    autoPipeliner = new AutoPipeliner(this);
    schemaId = 0;
    retryAttempts = 0;
    sentCommands = new Map();
    _state = [states.INITED];
    pendingPromises = {};
    mpDecoderStream = null;
    connectionErrors = [];
    reserveIterator = 0;
    salt = '';
    connector = null;

    /**
     * Creates a new TarantoolConnection instance
     *
     * Can be called with multiple argument variants:
     * - new TarantoolConnection(port, host, opts)
     * - new TarantoolConnection(host, port, opts)
     * - new TarantoolConnection(port, opts)
     * - new TarantoolConnection(host, opts)
     * - new TarantoolConnection(connectionString)
     * - new TarantoolConnection(connectionObject)
     *
     * @param {string|number|Object} [arg1] - Host, port, connection string, or connection object
     * @param {string|number|Object} [arg2] - Port, host, or connection options
     * @param {Object} [arg3] - Connection options
     *
     * @param {string} [opts.host='localhost'] - Server host
     * @param {number} [opts.port=3301] - Server port
     * @param {string} [opts.path] - Unix socket path (overrides host/port)
     * @param {number} [opts.timeout=5000] - Connection timeout in milliseconds
     * @param {boolean} [opts.lazyConnect=false] - Don't connect automatically on instantiation
     * @param {boolean} [opts.enableOfflineQueue=true] - Enable offline queue
     * @param {boolean} [opts.enableAutoPipelining=true] - Enable automatic pipelining
     * @param {number} [opts.sliderBufferInitialSize=16384] - Initial size of buffer pool
     * @param {boolean} [opts.tupleToObject=false] - Convert tuple arrays to objects
     * @param {number} [opts.commandTimeout] - Max execution time for commands in milliseconds
     * @param {boolean} [opts.prefetchSchema=true] - Fetch schema on connect
     * @param {Array<string|Object>} [opts.reserveHosts] - Fallback hosts for failover
     * @param {Object} [opts.Connector] - Custom connector implementation class
     * @param {Object} [opts.MsgPack] - Custom MsgPack implementation class
     */
    constructor() {
        const parsed = defaults(
            parseOptions(arguments[0], arguments[1], arguments[2]),
            defaultOptions
        );

        super(parsed);
        EventEmitter.call(this);

        this.msgpacker = new this.options.MsgPack(this.options);
        this.packUuid = this.msgpacker.packUuid;
        this.packInteger = this.msgpacker.packInteger;
        this.packDecimal = this.msgpacker.packDecimal;
        this.packInterval = this.msgpacker.packInterval;
        this.mpDecoderStream = createUnpackrStream.call(this);

        this.offlineQueue.set(); // request will be rejected with an error if 'enableOfflineQueue' is set to false and connection is not established
        if (!this.options.lazyConnect) {
            this.connect().catch(noop);
        }
    }

    /**
     * Checks if the connection is in CONNECT state
     * @returns {boolean} True if connected
     */
    isConnectedState() {
        return this._state[0] & states.CONNECT;
    }

    /**
     * Sends a command to the server
     * @private
     * @param {number} requestCode - Request code
     * @param {number} reqId - Request ID
     * @param {Buffer} buffer - Command buffer
     * @param {Function} [cb] - Callback function
     * @param {Array} commandArguments - Command arguments
     * @returns {Promise}
     */
    sendCommand(requestCode, reqId, buffer, cb, commandArguments) {
    // create promise for async methods
        let promise;
        if (!cb) {
            const p = withResolvers();
            promise = p.promise;

            cb = (error, success) => {
                if (error) {return p.reject(error);}

                p.resolve(success);
            };
        }


        const opts = commandArguments[commandsNum[requestCode].optsPos] ||= {};
        // check if should pass commands through the OfflineQueue
        if (this.offlineQueue.enabled && !opts[bypassOfflineQueueSym]) {
            this.offlineQueue.add(requestCode, commandArguments, cb);

            return promise;
        }

        switch (this._state[0]) {
            case states.AUTH:
            case states.CONNECT: {
                if (!this.connector.isWritable()) {
                    cb(new TarantoolError('Socket is not writable'), null);
                    break;
                }
                // create an array which will be stored untill the response is received
                const setValue = [
                    requestCode,
                    cb,
                    null, // command arguments
                    null, // timeoud id
                    opts
                ];

                if (opts.tupleToObject ?? this.options.tupleToObject) {
                    setValue[2] = commandArguments;
                }

                const commandTimeout =
                    opts.commandTimeout ?? this.options.commandTimeout;
                if (commandTimeout) {
                    // setFastTimeout is more performant than native setTimeout
                    setValue[3] = setFastTimeout(() => {
                        cb(
                            new TarantoolError(
                                `Request №${reqId} timed out of ${commandTimeout} ms`
                            ),
                            null
                        );
                        this.sentCommands.delete(reqId); // prevent memory leaks
                    }, commandTimeout);
                }

                this.sentCommands.set(reqId, setValue);
                const shouldAutoPipeline =
                    opts[pipelinedSym] === true
                        ? false
                        : (opts.autoPipeline ??
                          this.options.enableAutoPipelining);
                // check if should be autopipelined
                if (shouldAutoPipeline) {
                    this.autoPipeliner.add(buffer);
                } else if (opts[pipelinedSym]) {
                    return buffer;
                } else {
                    debug(
                        'sending request (rqCode: %i) №%i to server, buffer: %h, cmd args: %O',
                        requestCode,
                        reqId,
                        buffer,
                        commandArguments
                    );
                    this.connector.write(buffer, null, () => {
                        // wait for the buffer to become free
                        // https://nodejs.org/api/net.html#socketwritedata-encoding-callback
                        this.bufferPool.releaseBuffer(buffer);
                    });
                }
                break;
            }
            case states.END:
                cb(
                    new TarantoolError('Connection is finished', {
                        cause: this.connectionErrors // if had them
                    }),
                    null
                );
                break;
            default:
                cb(
                    new TarantoolError(
                        `Unexpected state "${
                            revertStates[this._state[0]]
                        }": should have been sent command to offline queue instead.`
                    ),
                    null
                );
        }

        return promise;
    }
}
applyMixin(TarantoolConnection, EventEmitter);

/**
 * Switches to next reserve host
 * @private
 */
const useNextReserve = function () {
    const connectRetryAttempts = this.options.connectRetryAttempts;
    if (this.retryAttempts > connectRetryAttempts) {
        throw new TarantoolError(
            `Exceeded "connectRetryAttempts" (${connectRetryAttempts}) while trying to establish a connection`
        );
    }
    if (this.reserveIterator >= this.options.reserveHosts?.length) {this.reserveIterator = 0;}
    const reserveHost = this.options.reserveHosts?.[this.reserveIterator++];
    if (!reserveHost) {
        throw new TarantoolError(
            'Attempted to use the next reserve host, but there are none of them left'
        );
    }
    // .call(...) allows passing 'reserveHost' as string, object, integer,
    // or even array (like ['localhost', 3301, {timeout: 20000}], having the same behavior as `new Tarantool('localhost', 3301, {timeout: 20000}})`)
    const reserveOptions = parseOptions.call(this, reserveHost);
    mergeWith(this.options, reserveOptions, (target, src) => {
        if (src !== undefined) {
            return src;
        } else {
            return target;
        }
    });

    return reserveOptions;
};

/**
 * Sets the connection state
 * @private
 * @param {number} state - New state
 * @param {*} arg - Additional argument
 */
const setState = function (state, arg) {
    const address =
        this.options.path != null
            ? this.options.path
            : this.options.host + ':' + this.options.port;
    debug(
        'state[%s]: %s -> %s',
        address,
        revertStates[this._state[0]] || '[empty]',
        revertStates[state]
    );
    this._state[0] = state;

    process.nextTick(() => {
        this.emit(revertStates[state], arg);
    });
};

/**
 * Establishes a connection to the Tarantool server
 * @public
 * @returns {Promise<void>}
 */
const connect = function () {
    if (this.pendingPromises.connect || this.isConnectedState()) {
        return Promise.reject(
            new TarantoolError('Tarantool is already connecting/connected')
        );
    }

    // create new promise if it doesn't exist
    this.pendingPromises.connect ||= new Promise((resolve, reject) => {
        this.setState(states.CONNECTING);
        this.connector = new this.options.Connector(this.options);
        const _this = this;
        this.connector.connect(function (err, socket) {
            if (err) {
                _this.offlineQueue.flush(err);
                _this.silentEmit('error', err);
                reject(err);
                _this.setState(states.END);
                return;
            }

            socket.on('error', eventHandler.errorHandler.bind(_this));
            socket.once('close', eventHandler.closeHandler.bind(_this));
            socket.once('data', eventHandler.dataHandler_prehello.bind(_this));

            // this is only needed until the connection is succesfully established
            socket.setTimeout(_this.options.timeout, function () {
                socket.destroy();

                const error = new TarantoolError(
                    'connect ETIMEDOUT'
                );
                error.errorno = 'ETIMEDOUT';
                error.code = 'ETIMEDOUT';
                error.syscall = 'connect';
                _this.errorHandler(error);
            });
            socket.once('connect', function () {
                // now we can clear the setTimeout which was set above
                socket.setTimeout(0);
            });

            // prevent from EventEmitter memory leak
            const listeners = _this.listeners('connect');
            if (!listeners.length || !listeners.some((func) => func._u)) {
                const connectionConnectHandler = function () {
                    _this.removeListener('close', connectionCloseHandler);

                    if (this.options.prefetchSchema) {
                        return this.fetchSchema()
                            .then(() => {
                                this.offlineQueue.unset();
                                this.offlineQueue.send();
                            })
                            .then(resolve)
                            .catch((error) =>
                                reject(
                                    new TarantoolError(
                                        'Failed to fetch space schema',
                                        {
                                            cause: error
                                        }
                                    )
                                )
                            );
                    } else {
                        this.offlineQueue.unset();
                        this.offlineQueue.send();
                    }

                    resolve();
                };
                connectionConnectHandler._u = true; // make this function unique without relying on the name of function
                const connectionCloseHandler = function () {
                    _this.removeListener('connect', connectionConnectHandler);
                    reject(
                        new TarantoolError('Connection is closed.', {
                            cause: _this.connectionErrors
                        })
                    );
                };
                _this.once('connect', connectionConnectHandler);
                _this.once('close', connectionCloseHandler);
            }
        });
    });

    return this.pendingPromises.connect
        .then(() => this.connectionErrors = [])
    // clear created promise
        .finally(() => {
            this.pendingPromises.connect = null;
        });
};

/**
 * Emits an event silently (doesn't throw on no listeners)
 * @private
 * @param {string} eventName - Event name
 * @returns {boolean} True if event was emitted
 */
const silentEmit = function (eventName) {
    const listenersLen = this.listeners(eventName).length;
    let error;
    if (eventName === 'error') {
        error = arguments[1];

        if (
            error instanceof Error &&
            (error.message === 'Connection manually closed' ||
                error.syscall === 'read')
        ) {
            return;
        }

        // if no 'error' listeners
        if (!listenersLen) {
            return process.emitWarning(
                new TarantoolError(format('Unhandled error event: %O', error)) // error object may not be filled correctly if passing error via {cause: error}, so we are using util's format()
            );
        }
    }

    if (listenersLen > 0) {
        return this.emit.apply(this, arguments);
    }

    return false;
};

/**
 * Closes the connection immediately.
 * Some sent commands (if present) will be rejected with an error.
 * @public
 * @returns {undefined}
 */
const disconnect = function () {
    debug('received a manual \'.disconnect()\' call');
    this.setState(states.END);
    return eventHandler.closeHandler.call(this, undefined, false);
};

/**
 * Closes the connection gracefully and waits for pending commands to fulfill
 * @public
 * @returns {Promise<void>}
 */
const quit = function () {
    debug('received a manual \'.quit()\' call');
    this.setState(states.END);
    return eventHandler.closeHandler.call(this, undefined, true);
};

/**
 * Creates a decoder stream for msgpack messages
 * @private
 * @returns {Stream} Decoder stream
 */
const createUnpackrStream = function () {
    let decodedHeaders = null;
    let decodingStep = 0;

    const unpackrStream = this.msgpacker.createDecoderStream();

    unpackrStream.on('error', (error) => {
        this.errorHandler(
            new TarantoolError('MsgPack decoder error', {
                cause: error
            })
        );
    });

    unpackrStream.on('data', (data) => {
        const type = typeof data;
        switch (type) {
            case 'number':
                decodingStep = 0;
                break;
            case 'object':
                switch (decodingStep) {
                    case 0:
                        decodedHeaders = data;
                        decodingStep = 1;
                        break;
                    case 1:
                        this.processResponse(decodedHeaders, data);
                        decodingStep = 2; // in order to catch the unexpected data in the 'default' block below
                        break;
                    default:
                        this.errorHandler(
                            new TarantoolError(
                                'Unknown step detected while decoding response data, maybe network loss occured?'
                            )
                        );
                }
                break;
            default:
                this.errorHandler(
                    new TarantoolError(
                        'Type of decoded value does not satisfy requirements: ' +
                            type
                    )
                );
        }
    });

    return unpackrStream;
};

/**
 * Waits until all sent commands are drained (responses received)
 * @public
 * @returns {Promise<void>}
 */
const _awaitSentCommandsDrain = async function () {
    if (this.sentCommands.size === 0) {return Promise.resolve();}

    let timeoudId, intervalId;
    return Promise.race([
        new Promise((_, reject) => {
            timeoudId = setTimeout(reject, this.options.timeout);
            timeoudId.unref();
        }),
        new Promise((resolve) => {
            intervalId = setInterval(() => {
                if (this.sentCommands.size === 0) {return resolve();}
            }, 500);
            intervalId.unref();
        })
    ]).finally(() => {
    // free the event loop
        clearTimeout(timeoudId);
        clearInterval(intervalId);
    });
};

module.exports = TarantoolConnection;
