const { TarantoolError } = require('../errors');
const { defaults, noop } = require('lodash');
const { states, nullishOpts } = require('../const');
const { format } = require('node:util');
const debug = require('./debug').extend('utils');
require('debug').formatters.h = bufferToHex;

function parseURL(str) {
    var result = {};
    if (str.startsWith('/')) {
        result.path = str;
        return result;
    }
    var parsed = str.split(':');
    switch (parsed.length) {
        case 1:
            result.host = parsed[0];
            break;
        case 2:
            result.host = parsed[0];
            result.port = parsed[1];
            break;
        default:
            result.username = parsed[0];
            result.password = parsed[1].split('@')[0];
            result.host = parsed[1].split('@')[1];
            result.port = parsed[2];
    }
    return result;
}

function withResolversPoly() {
    let resolve = Promise.resolve;
    let reject = Promise.reject;
    const promise = new Promise(function (_resolve, _reject) {
        resolve = _resolve;
        reject = _reject;
    });

    return {
        promise,
        resolve,
        reject
    };
}

exports.withResolvers = Promise.withResolvers ? Promise.withResolvers.bind(Promise) : withResolversPoly;

exports.applyMixin = function applyMixin(derivedConstructor, mixinConstructor) {
    Object.getOwnPropertyNames(mixinConstructor.prototype).forEach((name) => {
        Object.defineProperty(
            derivedConstructor.prototype,
            name,
            Object.getOwnPropertyDescriptor(mixinConstructor.prototype, name)
        );
    });
};

function bufferToHex (v) {
    return v.toString('hex');
};
module.exports.bufferToHex = bufferToHex;

module.exports.parseOptions = function parseOptions() {
    const options = {};
    for (let i = 0; i < arguments.length; ++i) {
        var arg = arguments[i];
        if (arg == null) {
            continue;
        }

        switch (typeof arg) {
            case 'object':
                defaults(options, arg);
                break;
            case 'string':
                if (!isNaN(arg) && (parseFloat(arg) | 0) === parseFloat(arg)) {
                    options.port = arg;
                    continue;
                }
                defaults(options, parseURL(arg));
                break;
            case 'number':
                options.port = arg;
                break;
            default:
                throw new TarantoolError('Invalid argument: ' + arg);
        }
    }

    if (typeof options.port === 'string') {
        options.port = parseInt(options.port, 10);
    }
    defaults(options, nullishOpts);
    if (options.path) {
        options.port = null;
        options.host = null;
    }
    if (options.port) options.path = null;

    return options;
};

module.exports.tryToReconnect = function tryToReconnect() {
    this.offlineQueue.set();
    const close = module.exports.closeConnection.bind(this);

    if (typeof this.options.retryStrategy !== 'function') {
        debug('skip reconnecting because `retryStrategy` is not a function');
        return close(new TarantoolError(`'retryStrategy' is not a function`));
    }
    const retryDelay = this.options.retryStrategy(++this.retryAttempts);

    if (typeof retryDelay !== 'number') {
        const err = format(
            '\'retryStrategy\' doesn\'t return a number. Received value: ',
            retryDelay
        );
        debug(err);
        return close(new TarantoolError(err));
    }

    this.setState(states.RECONNECTING, retryDelay);
    this.pendingPromises.connect = null;
    if (this.connector?.socket) this.connector?.disconnect(); // close the existing connection

    const useReserve = this.retryAttempts - 1 >= this.options.beforeReserve;
    if (this.options.reserveHosts?.length && useReserve) {
        try {
            const nextReserveHost = this.useNextReserve();
            debug(
                'reconnecting to the next reserve host in %sms: %O',
                retryDelay,
                nextReserveHost
            );
        } catch (e) {
            debug('Got error while choosing next reserve host: %O', e);
            return close(e)
        }
    } else if (useReserve) {
        return close(
            new TarantoolError(
                `All ${this.options.beforeReserve} connection attempts were failed and no 'reserveHosts' are specified`, {
                    cause: this.connectionErrors
                }
            )
        );
    } else {
        debug('reconnecting to the same host in %sms', retryDelay);
    }

    setTimeout(() => {
        // don't reconnect if connection was closed manually before new reconnection attempt
        if (this._state[0] & states.END) return;

        this.connect().catch(noop);
    }, retryDelay);
};

module.exports.closeConnection = function closeConnection(error) {
    this.setState(states.END);
    this.offlineQueue.flush(
        new TarantoolError('Connection is closed.', {
            cause: error
        })
    );
    rejectSentCommands.call(this, ERR_UNGRACEFUL_FLUSH);
    process.nextTick(() => {
        this.emit('close');
    });
    if (this.connector?.socket) this.connector?.disconnect(() => {
        // maybe add some logic?
    });
};

const ERR_UNGRACEFUL_FLUSH = new TarantoolError('Flushed the commands queue not gracefully');
/**
 * Rejects all pending commands with an error
 * @private
 */
const rejectSentCommands = function (err) {
    for (const [key, value] of this.sentCommands.entries()) {
        debug('Rejecting unresolved request with reqId № %i', key)

        value[1](err);
    }
    this.sentCommands.clear();
}
module.exports.rejectSentCommands = rejectSentCommands;
