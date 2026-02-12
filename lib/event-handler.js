const debug = require('./utils/debug').extend('event-handler');
const { states, symbols: {
    bypassOfflineQueue: bypassOfflineQueueSym
} } = require('./const');
const { pick } = require('lodash');
const { TarantoolError } = require('./errors');
const {
    closeConnection,
    tryToReconnect,
    rejectSentCommands
} = require('./utils');

/**
 * Handles the initial handshake data from server
 * @private
 */
exports.dataHandler_prehello = function (data) {
    this.salt = data.toString('utf8').split('\n')[1].replaceAll(' ', '');

    this.connector.socket.on('data', this.mpDecoderStream.write.bind(this.mpDecoderStream));

    if (this.options.password) {
        this.setState(states.AUTH);
        this._auth(this.options.username, this.options.password, {
            [bypassOfflineQueueSym]: true
        })
            .then(() => {
                debug('authenticated [%s]', this.options.username);
                this.retryAttempts = 0;
                this.setState(
                    states.CONNECT,
                    pick(this.options, ['port', 'host', 'path'])
                );
            })
            .catch((err) => {
                debug('failed to authenticate: %O', err);
                this.errorHandler(err);
                return exports.closeHandler.call(this, err);
            });
    } else {
        this.retryAttempts = 0;
        this.setState(states.CONNECT, pick(this.options, ['port', 'host', 'path']));
    }
};

/**
 * Handles errors from socket
 * @private
 * @param {Error} error - Error object
 */
const errorHandler = function (error) {
    debug('handled error: %s', error);
    this.silentEmit('error', error);

    // check if error relates to the pending connection process
    if (this.pendingPromises.connect) {
        this.connectionErrors.push(error);
    }
};
exports.errorHandler = errorHandler;

const ERR_DRAINING_TIMED_OUT = new TarantoolError(
    'Timed out awaiting for sent command for being fulfilled before disconnect'
);
const ERR_MANUALLY_CLOSED = new TarantoolError('manually closed');

/**
 * Handles socket close event
 * @private
 * @param {boolean|Error} [error] - Error object or boolean indicating transmission error
 * @param {boolean} [graceful] - Whether to wait for pending commands
 */
exports.closeHandler = async function (error, graceful) {
    // check if had a transmission error
    // https://nodejs.org/api/net.html#event-close_1
    if (error === true) {error = new TarantoolError('Socket transmission error');}
    // consider this is a duplicate after .quit() or .disconnect()
    // which may be inited by the socket 'close' listener
    if (this._state[0] & states.END && error != undefined) {return;}

    const close = closeConnection.bind(this);

    // check if this was a manual disconnection
    if (this._state[0] & states.END) {
        debug(
            'skip reconnecting since the connection is manually closed (or has been closed before)'
        );

        if (graceful) {
            return (
                this._awaitSentCommandsDrain()
                // if some commands are still not fulfilled
                    .catch(() => {
                        debug(
                            'Timed out awaiting for sent commands responses, rejecting them'
                        );
                        rejectSentCommands.call(this, ERR_DRAINING_TIMED_OUT);
                    })
                    .finally(() => close(ERR_MANUALLY_CLOSED))
            );
        } else {
            return close(ERR_MANUALLY_CLOSED);
        }
    }

    // consider this close event was not planned or manually invoked
    return tryToReconnect.call(this);
};
