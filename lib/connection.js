'use strict';
var tarantoolConstants = require('./const');
var net = require('net');
var _ = require('underscore');
var EventEmitter = require('events');
var msgpack = require('msgpack5')();
var crypto = require('crypto');
var xor = require('bitwise-xor');

var shatransform = function(t){
    return crypto.createHash('sha1').update(t).digest();
};

var states = {
    CONNECTING: 0,
    CONNECTED: 1,
    AWAITING: 2,
    INITED: 3,
    PREHELLO: 4
};

var requestMethods = ['select', 'delete', 'insert', 'replace', 'update', 'eval', 'call'];

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
    log: false
};

function TarantoolConnection (options){
    this.socket = new net.Socket({
        readable: true,
        writable: true
    });
    this.state = states.INITED;
    this.options = _.extend({}, defaultOptions, options);
    this.commandsQueue = [];
    this.awaitingDestroy = false;
    this.namespace = {};
    this.socket.on('connect', this.onConnect.bind(this));
    this.socket.on('error', this.onError.bind(this));
    this.socket.on('data', this.onData.bind(this));
}

TarantoolConnection.prototype._getSpaceId = function(name){
    return this.select(tarantoolConstants.Space.space, tarantoolConstants.IndexSpace.name, 1, 0,
        tarantoolConstants.IteratorsType.all, [name])
        .then(function(value){
            if (value && value.length && value[0])
            {
                var spaceId = value[0][0];
                this.namespace[name] = {
                    id: spaceId,
                    name: name,
                    indexes: {}
                };
                this.namespace[spaceId] = {
                    id: spaceId,
                    name: name,
                    indexes: {}
                };
                return spaceId;
            }
            else
            {
                throw new Error('Cannot read a space name or space is not defined');
            }
        }.bind(this))
};

TarantoolConnection.prototype._getIndexId = function(spaceId, indexName){
    return this.select(tarantoolConstants.Space.index, tarantoolConstants.IndexSpace.indexName, 1, 0,
        tarantoolConstants.IteratorsType.all, [spaceId, indexName])
        .then(function(value) {
            if (value && value[0] && value[0].length>1) {
                var indexId = value[0][1];
                var space = this.namespace[spaceId];
                if (space) {
                    this.namespace[space.name].indexes[indexName] = indexId;
                    this.namespace[space.id].indexes[indexName] = indexId;
                }
                return indexId;
            }
            else
                throw new Error('Cannot read a space name indexes or index is not defined');
        }.bind(this));
};

TarantoolConnection.prototype._getMetadata = function(spaceName, indexName){
    if (this.namespace[spaceName])
    {
        spaceName = this.namespace[spaceName].id;
    }
    if (typeof(this.namespace[spaceName]) != 'undefined' && typeof(this.namespace[spaceName].indexes[indexName])!='undefined')
    {
        indexName = this.namespace[spaceName].indexes[indexName];
    }
    if (typeof(spaceName)=='string' && typeof(indexName)=='string')
    {
        return this._getSpaceId(spaceName)
            .then(function(spaceId){
                return Promise.all([spaceId, this._getIndexId(spaceId, indexName)]);
            }.bind(this))
    }
    var promises = [];
    if (typeof(spaceName) == 'string')
        promises.push(this._getSpaceId(spaceName));
    else
        promises.push(spaceName);
    if (typeof(indexName) == 'string')
        promises.push(this._getIndexId(spaceName, indexName));
    else
        promises.push(indexName);
    if(this.options.log)
        console.log('promises', promises);
    return Promise.all(promises);
};

TarantoolConnection.prototype.onData = function(data){

    switch(this.state){
        case states.PREHELLO:
            for (var i = 0; i<this.commandsQueue.length; i++)
            {
                if (this.commandsQueue[i][0] == tarantoolConstants.RequestCode.rqConnect)
                {
                    this.commandsQueue[i][1].resolve(true);
                    this.commandsQueue.splice(i, 1);
                    i--;
                }
            }
            this.salt = data.slice(64, 108).toString('utf8');
            if (this.options.log)
            {
                console.log('state PREHELLO to state CONNECTED');
            }
            this.state = states.CONNECTED;
            break;
        case states.CONNECTED:
            var trackResult = this._responseBufferTrack(data);
            if (trackResult.length == 2)
            {
                this.state = states.AWAITING;
                this.awaitingResponseLength = trackResult[1];
                this.buffer = trackResult[0];
                if (this.options.log)
                {
                    console.log('from state connected to state awaiting');
                }
            }
            else
            {
                this.buffer = null;
                //this.state = states.CONNECTED;
                if (this.options.log)
                {
                    console.log('state connected and buffer clear');
                }
            }
            break;
        case states.AWAITING:
            var trackResult = this._responseBufferTrack(Buffer.concat([this.buffer, data]), this.awaitingResponseLength);
            if (trackResult.length == 2)
            {
                this.state = states.AWAITING;
                this.awaitingResponseLength = trackResult[1];
                this.buffer = trackResult[0];
                if (this.options.log)
                {
                    console.log('state awaiting and awaiting result');
                }
            }
            else
            {
                this.buffer = null;
                this.state = states.CONNECTED;
                if (this.options.log)
                {
                    console.log('state awaiting to state connected and clear buffer');
                }
            }
            break;
    }
};

TarantoolConnection.prototype._responseBufferTrack = function(buffer, length){
    if (!length)
    {
        if (buffer.length >= 5)
        {
            length = buffer.readUIntBE(1, 4);
            buffer = buffer.slice(5);
        }
        else
            return [buffer, null];
    }
    if (buffer.length >= length)
    {
        if (buffer.length == length)
        {
            this._processResponse(buffer);
            return [];
        }
        else
        {
            var curBuffer = buffer.slice(0, length);
            this._processResponse(curBuffer);
            return this._responseBufferTrack(buffer.slice(length));
        }
    }
    else
        return [buffer, length];
};

TarantoolConnection.prototype._processResponse = function(buffer){
    // add fixarraymap with 2 objects before main object
    var dataBuffer = Buffer.concat([new Buffer([0x92]), buffer]);
    var obj = msgpack.decode(dataBuffer);

    var reqId = obj[0][1];
    for(var i = 0; i<this.commandsQueue.length; i++)
        if (this.commandsQueue[i][1] == reqId)
        {
            var task = this.commandsQueue[i];
            this.commandsQueue.splice(i, 1);
            break;
        }
    var dfd = task[2];
    var success = obj[0][0] == 0 ? true : false;
    if (this.options.log)
    {
        console.log('process msg object', obj);
        if (obj[1][tarantoolConstants.KeysCode.data])
            console.log('return data', obj[1][tarantoolConstants.KeysCode.data]);
    }
    if (success)
        dfd.resolve(this._processResponseBody(task[0], obj[1][tarantoolConstants.KeysCode.data]));
    else
        dfd.reject(new Error(obj[1][tarantoolConstants.KeysCode.error]));
    if (this.awaitingDestroy && this.commandsQueue.length == 1)
    {
        this.commandsQueue[0][2].resolve(true);
        this.socket.destroy();
    }
};

TarantoolConnection.prototype._processResponseBody = function(cmd, data){
    return cmd == tarantoolConstants.RequestCode.rqAuth ? true : data;
};

TarantoolConnection.prototype.onConnect = function(){
    this.state = states.PREHELLO;
};

TarantoolConnection.prototype.onError = function(error){
    this._interupt(error);
    this._stubMethods();
    this.socket.destroy();
    this.commandsQueue = [];
};

TarantoolConnection.prototype._interupt = function(error){
    for (var i=0; i<this.commandsQueue.length; i++) {
        var dfd = this.commandsQueue[i][0] == tarantoolConstants.RequestCode.rqConnect ? this.commandsQueue[i][1]
            : this.commandsQueue[i][2];
        dfd.reject(error);
    }
};

TarantoolConnection.prototype.connect = function(){
    if (this.options.log)
        console.log('connect call');
    return new Promise(function (resolve, reject) {
        if (this.state == states.INITED)
        {
            this.state = states.CONNECTING;
            this.commandsQueue.push([tarantoolConstants.RequestCode.rqConnect, {resolve: resolve, reject: reject}]);
            this.socket.connect({port: this.options.port, host: this.options.host});
            if (this.options.log)
            {
                console.log('try to connect add to command queue and socket connection');
            }
        }
        else
        {
            reject(new Error(this.awaitingDestroy ? 'already destroyed' : 'already connected'));
            if (this.options.log)
            {
                console.log('connection already destroyed');
            }
        }
    }.bind(this));
};

TarantoolConnection.prototype.ping = function(){
    return new Promise(function (resolve, reject) {
        var reqId = requestId.getId();
        var header = this._header(tarantoolConstants.RequestCode.rqPing, reqId);
        var body = new Buffer(0);
        this._request(header, body);
        this.commandsQueue.push([tarantoolConstants.RequestCode.rqPing, reqId, {resolve: resolve, reject: reject}]);
    }.bind(this));
};

TarantoolConnection.prototype.select = function(spaceId, indexId, limit, offset, iterator, key){
    if (Number.isInteger(key))
        key = [key];
    return new Promise(function(resolve, reject){
        if (typeof(spaceId)=='string' || typeof(indexId)=='string')
        {
            return this._getMetadata(spaceId, indexId)
                .then(function(info){
                    return this.select(info[0], info[1], limit, offset, iterator, key);
                }.bind(this))
                .then(resolve)
                .catch(reject);
        }
        var reqId = requestId.getId();
        var header = this._header(tarantoolConstants.RequestCode.rqSelect, reqId);
        //don't need a key for all iterator
        if (iterator == 'all')
            key = [];
        var buffered = {
            spaceId: msgpack.encode(spaceId),
            indexId: msgpack.encode(indexId),
            limit: msgpack.encode(limit),
            offset: msgpack.encode(offset),
            key: msgpack.encode(key)
        };
        var body = Buffer.concat([new Buffer([0x86,tarantoolConstants.KeysCode.space_id]), buffered.spaceId,
            new Buffer([tarantoolConstants.KeysCode.index_id]), buffered.indexId,
            new Buffer([tarantoolConstants.KeysCode.limit]), buffered.limit,
            new Buffer([tarantoolConstants.KeysCode.offset]), buffered.offset,
            new Buffer([tarantoolConstants.KeysCode.iterator, tarantoolConstants.IteratorsType[iterator],
                tarantoolConstants.KeysCode.key]),
            buffered.key
        ]);
        this._request(header, body);
        this.commandsQueue.push([tarantoolConstants.RequestCode.rqSelect, reqId, {resolve: resolve, reject: reject}]);
    }.bind(this));
};

TarantoolConnection.prototype.delete = function(spaceId, indexId, key){
    if (Number.isInteger(key))
        key = [key];
    return new Promise(function (resolve, reject) {
        if (Array.isArray(key))
        {
            if (typeof(spaceId)=='string' || typeof(indexId)=='string')
            {
                return this._getMetadata(spaceId, indexId)
                    .then(function(info){
                        return this.delete(info[0], info[1],  key);
                    }.bind(this))
                    .then(resolve)
                    .catch(reject);
            }
            var reqId = requestId.getId();
            var header = this._header(tarantoolConstants.RequestCode.rqDelete, reqId);
            var buffered = {
                spaceId: msgpack.encode(spaceId),
                indexId: msgpack.encode(indexId),
                key: msgpack.encode(key)
            };
            var body = Buffer.concat([new Buffer([0x86,tarantoolConstants.KeysCode.space_id]), buffered.spaceId,
                new Buffer([tarantoolConstants.KeysCode.index_id]), buffered.indexId,
                new Buffer([tarantoolConstants.KeysCode.key]), buffered.key]);
            this._request(header, body);
            this.commandsQueue.push([tarantoolConstants.RequestCode.rqSelect, reqId, {resolve: resolve, reject: reject}]);
        }
        else
            reject(new Error('need array'));
    }.bind(this));
};

TarantoolConnection.prototype.update = function(spaceId, indexId, key, ops){
    if (Number.isInteger(key))
        key = [key];
    return new Promise(function (resolve, reject) {
        if (Array.isArray(ops) && Array.isArray(key)){
            if (typeof(spaceId)=='string' || typeof(indexId)=='string')
            {
                return this._getMetadata(spaceId, indexId)
                    .then(function(info){
                        return this.update(info[0], info[1],  key, ops);
                    }.bind(this))
                    .then(resolve)
                    .catch(reject);
            }
            var reqId = requestId.getId();
            var header = this._header(tarantoolConstants.RequestCode.rqUpdate, reqId);
            var buffered = {
                spaceId: msgpack.encode(spaceId),
                indexId: msgpack.encode(indexId),
                ops: msgpack.encode(ops),
                key: msgpack.encode(key)
            };
            var body = Buffer.concat([new Buffer([0x84,tarantoolConstants.KeysCode.space_id]), buffered.spaceId,
                new Buffer([tarantoolConstants.KeysCode.index_id]), buffered.indexId,
                new Buffer([tarantoolConstants.KeysCode.key]), buffered.key,
                new Buffer([tarantoolConstants.KeysCode.tuple]), buffered.ops]);
            this._request(header, body);
            this.commandsQueue.push([tarantoolConstants.RequestCode.rqUpdate, reqId, {resolve: resolve, reject: reject}]);
        }
        else
            reject(new Error('need array'));
    }.bind(this));
};



TarantoolConnection.prototype.upsert = function(spaceId, key, ops, tuple){
    return new Promise(function (resolve, reject) {
        if (Number.isInteger(key))
            key = [key];
        if (Array.isArray(ops) && Array.isArray(key)){
            if (typeof(spaceId)=='string' || typeof(indexId)=='string')
            {
                return this._getMetadata(spaceId, indexId)
                    .then(function(info){
                        return this.update(info[0], info[1],  key, ops);
                    }.bind(this))
                    .then(resolve)
                    .catch(reject);
            }
            var reqId = requestId.getId();
            var header = this._header(tarantoolConstants.RequestCode.rqUpsert, reqId);
            var buffered = {
                spaceId: msgpack.encode(spaceId),
                //indexId: msgpack.encode(indexId),
                ops: msgpack.encode(ops),
                key: msgpack.encode(key),
                tuple: msgpack.encode(tuple)
            };
            var body = Buffer.concat([new Buffer([0x84,tarantoolConstants.KeysCode.space_id]), buffered.spaceId,
                //new Buffer([tarantoolConstants.KeysCode.index_id]), buffered.indexId,
                new Buffer([tarantoolConstants.KeysCode.key]), buffered.key,
                new Buffer([tarantoolConstants.KeysCode.tuple]), buffered.ops,
                new Buffer([tarantoolConstants.KeysCode.def_tuple]), buffered.tuple]);
            console.log(body);
            this._request(header, body);
            this.commandsQueue.push([tarantoolConstants.RequestCode.rqUpsert, reqId, {resolve: resolve, reject: reject}]);
        }
        else
            reject(new Error('need array'));
    }.bind(this));
};


TarantoolConnection.prototype.eval = function(expression){
    var tuple = Array.prototype.slice.call(arguments, 1);
    return new Promise(function (resolve, reject) {
        var reqId = requestId.getId();
        var header = this._header(tarantoolConstants.RequestCode.rqEval, reqId);
        var buffered = {
            expression: msgpack.encode(expression),
            tuple: msgpack.encode(tuple)
        };
        var body = Buffer.concat([new Buffer([0x82,tarantoolConstants.KeysCode.expression]), buffered.expression,
            new Buffer([tarantoolConstants.KeysCode.tuple]), buffered.tuple]);
        this._request(header, body);
        this.commandsQueue.push([tarantoolConstants.RequestCode.rqEval, reqId, {resolve: resolve, reject: reject}]);
    }.bind(this));
};

TarantoolConnection.prototype.call = function(functionName){
    var tuple = arguments.length > 1 ? Array.prototype.slice.call(arguments, 1): [];
    return new Promise(function (resolve, reject) {
        var reqId = requestId.getId();
        var header = this._header(tarantoolConstants.RequestCode.rqCall, reqId);
        var buffered = {
            functionName: msgpack.encode(functionName),
            tuple: msgpack.encode(tuple ? tuple : [])
        };
        var body = Buffer.concat([new Buffer([0x82,tarantoolConstants.KeysCode.function_name]), buffered.functionName,
            new Buffer([tarantoolConstants.KeysCode.tuple]), buffered.tuple]);
        this._request(header, body);
        this.commandsQueue.push([tarantoolConstants.RequestCode.rqCall, reqId, {resolve: resolve, reject: reject}]);
    }.bind(this));
};

TarantoolConnection.prototype.insert = function(spaceId, tuple){
    var reqId = requestId.getId();
    return this._replaceInsert(tarantoolConstants.RequestCode.rqInsert, reqId, spaceId, tuple);
};

TarantoolConnection.prototype.replace = function(spaceId, tuple){
    var reqId = requestId.getId();
    return this._replaceInsert(tarantoolConstants.RequestCode.rqReplace, reqId, spaceId, tuple);
};

TarantoolConnection.prototype._replaceInsert = function(cmd, reqId, spaceId, tuple){
    return new Promise(function (resolve, reject) {
        if (Array.isArray(tuple)){
            if (typeof(spaceId)=='string')
            {
                return this._getMetadata(spaceId, 0)
                    .then(function(info){
                        return this._replaceInsert(cmd, reqId, info[0], tuple);
                    }.bind(this))
                    .then(resolve)
                    .catch(reject);
            }
            var header = this._header(cmd, reqId);
            var buffered = {
                spaceId: msgpack.encode(spaceId),
                tuple: msgpack.encode(tuple)
            };
            var body = Buffer.concat([new Buffer([0x82,tarantoolConstants.KeysCode.space_id]), buffered.spaceId,
                new Buffer([tarantoolConstants.KeysCode.tuple]), buffered.tuple]);
            this._request(header, body);
            this.commandsQueue.push([cmd, reqId, {resolve: resolve, reject: reject}]);
        }
        else
            reject(new Error('need array'));
    }.bind(this));
};

TarantoolConnection.prototype.auth = function(username, password){
    return new Promise(function (resolve, reject) {
        var reqId = requestId.getId();
        var header = this._header(tarantoolConstants.RequestCode.rqAuth, reqId);
        var buffered = {
            username: msgpack.encode(username)
        };
        var scrambled = scramble(password, this.salt);
        var body = Buffer.concat([new Buffer([0x82, tarantoolConstants.KeysCode.username]), buffered.username,
            new Buffer([0x21, 0x92]), tarantoolConstants.passEnter, new Buffer([0xb4]), scrambled]);
        this._request(header, body);
        this.commandsQueue.push([tarantoolConstants.RequestCode.rqAuth, reqId, {resolve: resolve, reject: reject}]);
    }.bind(this));
};

function scramble(password, salt){
    var encSalt = new Buffer(salt, 'base64');
    var step1 = shatransform(password);
    var step2 = shatransform(step1);
    var step3 = shatransform(Buffer.concat([encSalt.slice(0, 20), step2]));
    var scramble = xor(step1, step3);
    return scramble;
}

TarantoolConnection.prototype._header = function(command, reqId){
    var header = new Buffer([0x82, tarantoolConstants.KeysCode.code, command,
        tarantoolConstants.KeysCode.sync, 0xce, 0, 0, 0, 0]);
    header.writeUIntBE(reqId, 5, 4);
    return header;
};

TarantoolConnection.prototype._request = function(header, body){
    var sumL = header.length + body.length;
    var prefixSizeBuffer = new Buffer(5);
    prefixSizeBuffer[0] = 0xCE;
    prefixSizeBuffer.writeUIntBE(sumL, 1, 4);
    var buffer = Buffer.concat([prefixSizeBuffer, header, body]);
    this.socket.write(buffer);
};

TarantoolConnection.prototype.destroy = function(interupt){
    return new Promise(function (resolve, reject) {
        if (interupt)
        {
            this._interupt(new Error('force destroy socket'));
            this.socket.destroy();
            resolve(true);
        }
        else
        {
            if (this.commandsQueue.length)
            {
                this.commandsQueue.push([tarantoolConstants.RequestCode.rqDestroy, -1,
                    {resolve: resolve, reject: reject}]);
                this.awaitingDestroy = true;
                //disable methods
                this._stubMethods();
            }
            else
            {
                this.socket.destroy();
                resolve(true);
            }
        }
    }.bind(this));
};

TarantoolConnection.prototype._notAvailableMethod = function(){
    return new Promise(function (resolve, reject) {
        reject(new Error('connection will be destroyed or already destroyed, create another one'));
    });
};

TarantoolConnection.prototype._stubMethods = function(){
    for (var i = 0; i<requestMethods.length; i++)
        this[requestMethods[i]] = this._notAvailableMethod;
};

TarantoolConnection.prototype.IteratorsType = tarantoolConstants.IteratorsType;

module.exports = TarantoolConnection;
