/* global Promise */

var util = require('util');
var msgpack = require('msgpack-lite');
var crypto = require('crypto');
var debug = require('debug')('tarantool-driver:main');
var _ = require('lodash');

var utils = require('./utils');
var Denque = require('denque');
var tarantoolConstants = require('./const');
var Commands = require('./commands');
var Connector = require('./connector');
var eventHandler = require('./event-handler');
var multiplierBuffer = 2;

var Decoder = require("msgpack-lite").Decoder;
var decoder = new Decoder();

var revertStates = {
    0: 'CONNECTING',
    1: 'CONNECTED',
    2: 'AWAITING',
    4: 'INITED',
    8: 'PREHELLO',
    16: 'AWAITING_LENGTH',
    32: 'END',
    64: 'RECONNECTING',
    128: 'AUTH'
};
TarantoolConnection.defaultOptions = {
    host: 'localhost',
    port: 3301,
    username: null,
    password: null,
    timeout: 0,
    retryStrategy: function (times) {
        return Math.min(times * 50, 2000);
    },
    lazyConnect: false
};

function TarantoolConnection (options){
    if (!(this instanceof TarantoolConnection)) {
        return new TarantoolConnection(arguments[0], arguments[1], arguments[2]);
    }
    this.parseOptions(arguments[0], arguments[1], arguments[2]);
    this.connector = new Connector(this.options);
    this.schemaId = null;
    this.msgpack = msgpack;
    this.states = {
        CONNECTING: 0,
        CONNECTED: 1,
        AWAITING: 2,
        INITED: 4,
        PREHELLO: 8,
        AWAITING_LENGTH: 16,
        END: 32,
        RECONNECTING: 64,
        AUTH: 128
    };
    this.commandsQueue = new Denque();
    this.offlineQueue = new Denque();
    this.namespace = {};
    this.bufferSlide = utils.createBuffer(1024*10);
    this.bufferOffset = 0;
    this.bufferLength = 0;
    this.awaitingResponseLength = -1;
    this.retryAttempts = 0;
    this._id = 0;
    if (this.options.lazyConnect) {
        this.setState(this.states.INITED);
    } else {
        this.connect().catch(_.noop);
    }
}

_.assign(TarantoolConnection.prototype, Commands.prototype);
_.assign(TarantoolConnection.prototype, require('./parser'));

TarantoolConnection.prototype.resetOfflineQueue = function () {
  this.offlineQueue = new Denque();
};

TarantoolConnection.prototype.parseOptions = function(){
    this.options = {};
    for (var i = 0; i < arguments.length; ++i) {
        var arg = arguments[i];
        if (arg === null || typeof arg === 'undefined') {
            continue;
        }
        if (typeof arg === 'object') {
            _.defaults(this.options, arg);
        } else if (typeof arg === 'string') {
            if(!isNaN(arg) && (parseFloat(arg) | 0) === parseFloat(arg)){
                this.options.port = arg;
                continue;
            }
            var parsed = arg.split(':');
            switch (parsed.length){
                case 1:
                    this.options.host = parsed[0];
                    break;
                case 2:
                    this.options.host = parsed[0];
                    this.options.port = parsed[1];
                    break;
                default:
                    this.options.username = parsed[0];
                    this.options.password = parsed[1].split('@')[0];
                    this.options.host = parsed[1].split('@')[1];
                    this.options.port = parsed[2];
            }
        } else if (typeof arg === 'number') {
            this.options.port = arg;
        } else {
            throw new utils.TarantoolError('Invalid argument ' + arg);
        }
    }
    _.defaults(this.options, TarantoolConnection.defaultOptions);
    if (typeof this.options.port === 'string') {
        this.options.port = parseInt(this.options.port, 10);
    }
};

TarantoolConnection.prototype.sendCommand = function(command, buffer){
    switch (this.state){
        case this.states.INITED:
            this.connect().catch(_.noop);
        case this.states.PREHELLO:
        case this.states.CONNECTING:
        case this.states.RECONNECTING:
        case this.states.AUTH:
            debug('queue -> %s(%s)', command[0], command[1]);
		    this.offlineQueue.push([command, buffer]);
            break;
        case this.states.END:
            command[2].reject(new utils.TarantoolError('Connection is closed.'));
            break;
        // CONNECTED AWAITING AWAITING_LENGTH
        default:
            this.commandsQueue.push(command);
            this.socket.write(buffer);
    }
};

TarantoolConnection.prototype.setState = function (state, delay) {
    var address;
    if (this.socket && this.socket.remoteAddress && this.socket.remotePort) {
        address = this.socket.remoteAddress + ':' + this.socket.remotePort;
    } else {
        address = this.options.host + ':' + this.options.port;
    }
    debug('state[%s]: %s -> %s', address, revertStates[this.state] || '[empty]', revertStates[state]);
    if(state === 64) debug('delay: %s', delay);
    this.state = state;
};

TarantoolConnection.prototype.connect = function(){
    return new Promise(function (resolve, reject) {
        if (this.state === this.states.CONNECTING || this.state === this.states.CONNECTED) {
            reject(new utils.TarantoolError('Tarantool is already connecting/connected'));
            return;
        }
        this.commandsQueue.push([tarantoolConstants.RequestCode.rqConnect, null, {resolve: resolve, reject: reject}]);
        this.setState(this.states.CONNECTING);
        var _this = this;
        this.connector.connect(function(err, socket){
            if(err){
                _this.flushQueue(err);
                console.error(err);
                reject(err);
                _this.setState(_this.states.END);
                return;
            }
            _this.socket = socket;
            socket.once('connect', eventHandler.connectHandler(_this));
            socket.once('error', eventHandler.errorHandler(_this));
            socket.once('close', eventHandler.closeHandler(_this));
            socket.on('data', eventHandler.dataHandler(_this));
            
            socket.setNoDelay(true);

            if (_this.options.timeout) {
                socket.setTimeout(_this.options.timeout, function () {
                    socket.setTimeout(0);
                    socket.destroy();

                    var error = new utils.TarantoolError('connect ETIMEDOUT');
                    error.errorno = 'ETIMEDOUT';
                    error.code = 'ETIMEDOUT';
                    error.syscall = 'connect';
                    eventHandler.errorHandler(_this)(error);
                });
                socket.once('connect', function () {
                    socket.setTimeout(0);
                });
            }
        });
    }.bind(this));
};

TarantoolConnection.prototype.flushQueue = function (error) {
    while (this.offlineQueue.length > 0) {
        this.offlineQueue.shift()[0][2].reject(error);
    }
    while (this.commandsQueue.length > 0) {
        this.commandsQueue.shift()[2].reject(error);
    }
};
                /* renamed from destroy */
TarantoolConnection.prototype.disconnect = function(reconnect){
    if (!reconnect) {
        this.manuallyClosing = true;
    }
    if (this.reconnectTimeout) {
        clearTimeout(this.reconnectTimeout);
        this.reconnectTimeout = null;
    }
    if (this.state === this.states.INITED) {
        eventHandler.closeHandler(this)();
    } else {
        this.connector.disconnect();
    }
};

TarantoolConnection.prototype.IteratorsType = tarantoolConstants.IteratorsType;

module.exports = TarantoolConnection;