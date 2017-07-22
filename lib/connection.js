/* global Promise */

var util = require('util');
var msgpack = require('msgpack-lite');
var crypto = require('crypto');
var debug = require('debug')('tarantool-driver:main');
var _ = require('lodash');

var utils = require('./utils');
var Denque = require('./denque');
var tarantoolConstants = require('./const');
var Commands = require('./commands');
var Connector = require('./connector');
var eventHandler = require('./event-handler');
var multiplierBuffer = 2;

var Decoder = require("msgpack-lite").Decoder;
var decoder = new Decoder();

TarantoolConnection.defaultOptions = {
    host: 'localhost',
    port: 3301,
    username: null,
    password: null,
    timeout: 0,
    retryStrategy: function (times) {
        return Math.min(times * 50, 2000);
    },
    // closeOnAuthFail: false  // close connection if auth failed
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
        END: 32
    };
    this.setState(this.states.INITED);
    this.commandsQueue = new Denque();
    this.offlineQueue = new Denque();
    this.namespace = {};
    this.bufferSlide = utils.createBuffer(1024*10);
    this.bufferOffset = 0;
    this.bufferLength = 0;
    this.awaitingResponseLength = -1;
    this.retryAttempts = 0;
    
    this.connect().catch(_.noop);
    
    // if (this.options.timeout) {
    //   this.socket.setTimeout(this.options.timeout, function(socket){
    //     if (options.log)
    //       console.log('socket timeouted');
    //     this.onError(new Error('timeout socket'));
    //   }.bind(this));
    // }
}

_.assign(TarantoolConnection.prototype, Commands.prototype);

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
            if(parsed.length === 2){
                this.host = parsed[0];
                this.options.port = parsed[1];
            } else {
                this.username = parsed[0];
                this.password = parsed[1].split('@')[0];
                this.host = parsed[1].split('@')[1];
                this.port = parsed[2];
            }
        } else if (typeof arg === 'number') {
            this.options.port = arg;
        } else {
            throw new Error('Invalid argument ' + arg);
        }
    }
    _.defaults(this.options, TarantoolConnection.defaultOptions);
    if (typeof this.options.port === 'string') {
        this.options.port = parseInt(this.options.port, 10);
    }
};

TarantoolConnection.prototype.sendCommand = function(command, buffer){	
	//if connected -> write to socket
	//else add to offlineQueue
	//command = [code, reqId, {resolve, reject}]
	
	//if reconnection -> reject
    if (this.state === this.states.END) {
        command[2].reject(new Error('Connection is closed.'));
	}
    if(this.state === this.states.CONNECTED){
        debug('socket write -> %s(%s)', _.findKey(tarantoolConstants.requestCode, command[0]), command[1]);
        this.commandsQueue.push(command);
        this.socket.write(buffer);
	} else {
        debug('queue -> %s(%s)', _.findKey(tarantoolConstants.requestCode, command[0]), command[1]);
		this.offlineQueue.push(command);
	}
};

TarantoolConnection.prototype.setState = function (state) {
    var address;
    if (this.options.path) {
        address = this.options.path;
    } else if (this.socket && this.socket.remoteAddress && this.socket.remotePort) {
        address = this.socket.remoteAddress + ':' + this.socket.remotePort;
    } else {
        address = this.options.host + ':' + this.options.port;
    }
    debug('state[%s]: %s -> %s', address, this.state || '[empty]', state);
    this.state = state;
};

TarantoolConnection.prototype.connect = function(){
    return new Promise(function (resolve, reject) {
        if(this.state != this.states.INITED){
            if (this.state === this.states.CONNECTING || this.state === this.states.CONNECTED) {
                reject(new Error('Tarantool is already connecting/connected'));
                return;
            } else if(this.state === this.states.END){
                reject(new Error('Connection is already destroyed'));
                return;
            }
        }
        this.commandsQueue.push([tarantoolConstants.RequestCode.rqConnect, null, {resolve: resolve, reject: reject}]);
        this.setState(this.states.CONNECTING);
        var _this = this;
        this.connector.connect(function(err, socket){
            if(err){
                _this.flushQueue(err);
                _this.silentEmit('error', err);
                reject(err);
                _this.setStatus('end');
                return;
            }
            _this.socket = socket;
            socket.once('connect', eventHandler.connectHandler(_this));
            socket.once('error', eventHandler.errorHandler(_this));
            socket.once('close', eventHandler.closeHandler(_this));
            socket.on('data', eventHandler.dataHandler(_this));
            
            socket.setNoDelay(true);
            // if (this.options.timeout) {
            //     this.socket.setTimeout(this.options.timeout, function(socket){
            //         if (options.log)
            //         console.log('socket timeouted');
            //         this.onError(new Error('timeout socket'));
            //     }.bind(this));
            // }

            if (_this.options.timeout) {
                socket.setTimeout(_this.options.timeout, function () {
                    socket.setTimeout(0);
                    socket.destroy();

                    var error = new Error('connect ETIMEDOUT');
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

// TarantoolConnection.prototype.disconnect = function (reconnect) {
//   if (!reconnect) {
//     this.manuallyClosing = true;
//   }
//   if (this.reconnectTimeout) {
//     clearTimeout(this.reconnectTimeout);
//     this.reconnectTimeout = null;
//   }
//   if (this.status === 'wait') {
//     eventHandler.closeHandler(this)();
//   } else {
//     this.connector.disconnect();
//   }
// };

TarantoolConnection.prototype.flushQueue = function (error) {
    var i;
    for (i=0; i<this.commandsQueue.length; i++) {
		this.commandsQueue[i][2].reject(error);
    }
    for (i=0; i<this.commandsQueue.length; i++) {
		this.commandsQueue[i][2].reject(error);
    }
    
    // this function in redis
    // shifting commands from queue
    // while (this.offlineQueue.length > 0) {
    //     item = this.offlineQueue.shift();
    //     item.command.reject(error);
    // }
    // if (this.commandQueue.length > 0) {
    //     while (this.commandQueue.length > 0) {
    //         item = this.commandQueue.shift();
    //         item.command.reject(error);
    //     }
    // }
};
TarantoolConnection.prototype.destroy = function(interupt){
    return new Promise(function (resolve, reject) {
        if (interupt)
        {
            this.flushQueue(new Error('force destroy socket'));
            // this._interupt(new Error('force destroy socket'));
            this.socket.destroy();
            resolve(true);
        }
        else
        {
            if (this.commandsQueue.length)
            {
                this.setState(this.states.END);
                this.commandsQueue.push([tarantoolConstants.RequestCode.rqDestroy, -1,
                    {resolve: resolve, reject: reject}]);
                // this.awaitingDestroy = true;
            }
            else
            {
                this.socket.destroy();
                resolve(true);
            }
        }
    }.bind(this));
};

TarantoolConnection.prototype.IteratorsType = tarantoolConstants.IteratorsType;

module.exports = TarantoolConnection;
