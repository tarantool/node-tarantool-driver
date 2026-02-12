const Command = require('./Command');
const debug = require('./utils/debug').extend('offline-queue');
const { noop } = require('lodash');
const { TarantoolError } = require('./errors');

const ERR_OFFLINE_QUEUE_DISABLED = new TarantoolError(
    'Connection not established and "enableOfflineQueue" option is disabled'
);

const cmdArr = Object.values(Command.commands);

module.exports = class OfflineQueue {
    queue = new Array();
    enabled = false;

    /**
     * Creates an OfflineQueue instance
     * @param {TarantoolConnection} self - Parent connection instance
     */
    constructor(self) {
        this.self = self;
    }

    /**
     * Enables the offline queue
     */
    set() {
        debug(
            'Setting the offline queue, commands will be passed to the queue manager'
        );
        this.enabled = true;
    }

    /**
     * Flushes the offline queue with an error
     * @private
     * @param {Error} error - Error to reject with
     */
    flush(error) {
        debug(
            'Flushing offline queue with %i commands, rejecting pending callbacks with the following error: %O',
            this.queue.length,
            error
        );
        while (this.queue.length > 0) {
            this.queue.shift()[2](error, null);
        }
    }

    /**
     * Disables the offline queue
     */
    unset() {
        debug(
            'Unsetting the offline queue, now commands should be sent directly'
        );
        this.enabled = false;
    }

    /**
     * Adds a command to the offline queue
     * @private
     * @param {number} requestCode - Request code
     * @param {Array} args - Command arguments
     * @param {Function} cb - Callback function
     */
    add(requestCode, args, cb) {
        debug('Added command to the OfflineQueue, arguments: %O', arguments);

        if (!this.self.options.enableOfflineQueue) {
            return cb(ERR_OFFLINE_QUEUE_DISABLED, null);
        }

        if (!this.self.isConnectedState()) {
            this.self.connect().catch(noop);
        }

        this.queue.push([requestCode, args, cb]);
    }

    /**
     * Resets the offline queue
     */
    reset() {
        this.queue = [];
    }

    /**
     * Sends all queued commands to the server
     */
    send() {
        debug('Sending %d commands from offline queue', this.queue.length);

        while (this.queue.length > 0) {
            const [rqCode, args, cb] = this.queue.shift();

            const cmd = cmdArr.find((value) => {
                return value.rqCode === rqCode;
            });

            const p = cmd.function.call(this.self, ...args);
            if (p instanceof Promise) {
                p.then((result) => cb(null, result)).catch((error) =>
                    cb(error, null)
                );
            }
        }
    }
};
