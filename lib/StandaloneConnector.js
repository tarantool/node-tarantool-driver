const net = require('net');
const tls = require('tls');
const {TarantoolError} = require('./errors');

const ERR_SOCKET_NOT_CREATED = new TarantoolError('Socket not created yet');
const ERR_SOCKET_ALREADY_CREATED = new TarantoolError('Socket is already created');

/**
 * Standalone socket connector for Tarantool
 */
module.exports = class StandaloneConnector {
    socket = null;
    options = null;
    write = () => ERR_SOCKET_NOT_CREATED;

    /**
     * Creates a connector
     * @param {Object} options - Connection options
     */
    constructor(options) {
        this.options = options;
    }

    /**
     * Disconnects the socket
     */
    disconnect(cb) {
        if (!this.socket) {throw ERR_SOCKET_NOT_CREATED;}
        this.socket.end(cb);
    }

    /**
     * Connects to the server
     * @param {Function} callback - Callback function
     */
    connect(callback) {
        try {
            if (this.socket) {throw ERR_SOCKET_ALREADY_CREATED;}

            let connectionModule;
            if (typeof this.options.tls == 'object') {
                connectionModule = tls;
                Object.assign(this.options, this.options.tls);
            } else {
                connectionModule = net;
            }
            this.socket = connectionModule.connect(this.options);
            this.write = this.socket.write.bind(this.socket);
            this.socket.setKeepAlive(this.options.keepAlive, parseInt(this.options.keepAlive) || 0);
            this.socket.setNoDelay(this.options.noDelay);
        } catch (err) {
            callback(err);
            return;
        }

        callback(null, this.socket);
    }

    /**
     * Checks if socket is writable
     * @returns {boolean} True if socket is writable
     */
    isWritable() {
        return this.socket?.writable || false;
    }
};
