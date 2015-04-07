'use strict';
var tarantoolConstants = require('./const');
var net = require('net');
var _ = require('underscore');
var EventEmitter = require('events');
var msgpack = require('msgpack');
var vow = require('vow');

var states = {
    CONNECTING: 0,
    CONNECTED: 1,
    AWAITING: 2,
    REQUESTING: 3,
    GETTING: 4,
    INITED: 5,
    DISONECTED: 6,
    PREHELLO: 7
};

var commandType = {
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
    this.responseEnded = true;
}

TarantoolConnection.prototype.onData = function(data){
    console.log(data.length, data.toString());
    switch(this.state){
        case states.PREHELLO:
            for (var i = 0; i<this.commandsQueue.length; i++)
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
        case states.CONNECTED:
            //new TarantoolResponse(data);
            this.responseEnded = false;
            this.curResponseLength = buffer.readUIntBE(1, 4);
            console.log('len', this.curResponseLength);
            this.buffer = buffer.slice(5);
            if (this.buffer.length >= this.curResponseLength)
            {
                this.ended = true;
                if (this.buffer.length > length){
                    var plusResponse = new TarantoolResponse(this.buffer.slice(this.curResponseLength));
                    if (plusResponse.ended)
                    {

                    }
                    this.buffer = this.buffer.slice(0, length);
                }
                this.processing();
            }
            break;
    }
};

TarantoolConnection.prototype._responseBufferTrack = function(){
    
};

TarantoolConnection.prototype._processResponse = function(buffer){
    try{
        var success = buffer[1] == 0x00;
        console.log(this.buffer);
        if (this.success){
            // add fixarraymap with 2 objects before main object
            var dataBuffer = Buffer.concat([new Buffer([0x92]), this.buffer.slice(5)]);
            console.log(dataBuffer);
            var obj = msgpack.unpack(dataBuffer);
            console.log(obj);
        }
        else{
            console.log('its error');
        }
    } catch(e){
        console.log(e, e.stack);
    }
}

TarantoolConnection.prototype.onConnect = function(){
    this.state = states.PREHELLO;
};

TarantoolConnection.prototype.onError = function(error){
    for (var i=0; i<this.commandsQueue.length; i++)
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
    var dfd = vow.defer();
    console.log('start ping');
    var reqId = requestId.getId();
    var header = this._header(tarantoolConstants.RequestCode.rqPing, reqId);
    console.log('header', header);
    var body = new Buffer(0);
    this._request(header, body);
    this.commandsQueue.push([tarantoolConstants.RequestCode.rqPing, reqId, dfd]);
    return dfd.promise();
};


TarantoolConnection.prototype._header = function(command, reqId){
    try {
        var header = new Buffer([0x82, tarantoolConstants.KeysCode.code, command,
            tarantoolConstants.KeysCode.sync, 0xce, 0, 0, 0, 0]);
        header.writeUIntBE(reqId, 5, 4);
        return header;
    } catch(e){
        console.log(e, e.stack);
    }
};

TarantoolConnection.prototype._request = function(header, body){
    console.log('start request');
    var sumL = header.length + body.length;
    var prefixSizeBuffer = new Buffer(5);
    prefixSizeBuffer[0] = 0xCE;
    prefixSizeBuffer.writeUIntBE(sumL, 1, 4);
    try {
        var buffer = Buffer.concat([prefixSizeBuffer, header, body]);
        console.log(buffer);
        this.socket.write(buffer);
    } catch (e){
        console.log(e, e.stack);
    }

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

//@InputType(Buffer)
function TarantoolResponse(buffer){
    this.ended = false;
    this.currentBufferLength = 0;
    var length = buffer.readUIntBE(1, 4);
    console.log('len', length);
    this.buffer = buffer.slice(5);
    if (this.buffer.length >= length)
    {
        this.ended = true;
        if (this.buffer.length > length){
            var plusResponse = new TarantoolResponse(this.buffer.slice(length));
            if (plusResponse.ended)
            {

            }
            this.buffer = this.buffer.slice(0, length);
        }
        this.processing();
    }
}

TarantoolResponse.prototype.add = function(buffer){
    if (this.ended)
    {

    }
};

TarantoolResponse.prototype.processing = function(){
    try{
        this.success = this.buffer[6] == 0x00;
        console.log(this.buffer);
        if (this.success){
            // add fixarraymap with 2 objects before main object
            var dataBuffer = Buffer.concat([new Buffer([0x92]), this.buffer.slice(5)]);
            console.log(dataBuffer);
            var obj = msgpack.unpack(dataBuffer);
            console.log(obj);
        }
        else{
            console.log('its error');
        }
    } catch(e){
        console.log(e, e.stack);
    }
};

module.exports = TarantoolConnection;