'use strict';
var tarantoolConstants = require('./const');
var net = require('net');
var _ = require('underscore');
var EventEmitter = require('events');
var msgpack = require('msgpack');

const states = {
    CONNECTING: 0,
    CONNECTED: 1,
    AWAITING: 2,
    REQUESTING: 3,
    GETTING: 4,
    INITED: 5,
    DISONECTED: 6,
    PREHELLO: 7
};

const commandType = {
    CONNECT: 0,
    REQUEST: 1
};

var requestId = {
    _id: 0,
    getId: function(){
        if (this._id > 1000000)
            this._id = 0;
        return this._id++;
    }
};

var defaultOptions = {
    host: 'localhost',
    port: '3301',
    username: null,
    password: null,
    timeout: 5000,
    reconnect: true
};


function TarantoolConnection (options){
    this.socket = new net.Socket({
        readable: true,
        writable: true
    });
    this.state = states.INITED;
    this.emitter = new EventEmitter();
    this.options = _.extend(defaultOptions, options);
    this.commandsQueue = [];
    this.socket.on('connect', this.onConnect.bind(this));
    this.socket.on('error', this.onError.bind(this));
    this.socket.on('data', this.onData.bind(this));
}

TarantoolConnection.prototype.onData = function(data){
    console.log(data.length, data.toString());
    switch(this.state){
        case states.PREHELLO:
            for (let i = 0; i<this.commandsQueue.length; i++)
            {
                if (this.commandsQueue[i][0] == commandType.CONNECT)
                {
                    this.commandsQueue[i][1](true);
                    this.commandsQueue.splice(i, 1);
                    i--;
                }
            }
            this.state = states.CONNECTED;
            break;
    }
};

TarantoolConnection.prototype.onConnect = function(){
    this.state = states.PREHELLO;
};

TarantoolConnection.prototype.onError = function(error){
    for (let i=0; i<this.commandsQueue.length; i++)
        this.commandsQueue[i][2](error);
    this.commandsQueue = [];
};

TarantoolConnection.prototype.connect = function(){
    console.log('pre connect');
    this.state = states.CONNECTING;
    return new Promise(function(resolve, reject){
        this.commandsQueue.push([commandType.CONNECT, resolve, reject]);
        this.socket.connect({port: this.options.port, host: this.options.host});
    }.bind(this));
};

TarantoolConnection.prototype.ping = function(){

};

TarantoolConnection.prototype._request = function(header, body){
    var sumL = header.length + body.length;
    var prefixSizeBuffer = new Buffer(5);
    socket.write()
};

TarantoolConnection.prototype.destroy = function(interupt){
    if (interupt)
    {
        this.socket.destroy();
    }
    else
    {
        this.commandsQueue.push('destroy');
    }
};

module.exports = TarantoolConnection;