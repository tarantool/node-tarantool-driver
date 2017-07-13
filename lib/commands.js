var Promise = require('bluebird');
var crypto = require('crypto');
var tarantoolConstants = require('./const');


const requestMethods = ['select', 'delete', 'insert', 'replace', 'update', 'eval', 'call', 'upsert'];

var requestId = {
    _id: 0,
    getId: function(){
        if (this._id > 1000000)
            this._id = 0;
        return this._id++;
    }
};

function Commands() {
    
}


TarantoolConnection.prototype._header = function(command, reqId){
    var header = new Buffer([0x82, tarantoolConstants.KeysCode.code, command,
        tarantoolConstants.KeysCode.sync, 0xce, 0, 0, 0, 0]);
    header.writeUInt32BE(reqId, 5);
    return header;
};

TarantoolConnection.prototype._request = function(header, body){
    var sumL = header.length + body.length;
    var prefixSizeBuffer = new Buffer(5+sumL);
    prefixSizeBuffer[0] = 0xCE;
    prefixSizeBuffer.writeUInt32BE(sumL, 1);
    header.copy(prefixSizeBuffer, 5);
    body.copy(prefixSizeBuffer, 5+header.length);
    // console.log('requst', prefixSizeBuffer);
    this.socket.write(prefixSizeBuffer);
};


Commands.prototype.ping = function(){
    return new Promise(function (resolve, reject) {
        var reqId = this._getRequestId();
        var header = this._header(tarantoolConstants.RequestCode.rqPing, reqId);
        var body = new Buffer(0);
        this._request(header, body);
        this.commandsQueue.push([tarantoolConstants.RequestCode.rqPing, reqId, {resolve: resolve, reject: reject}]);
    }.bind(this));
};

Commands.prototype.select = function(spaceId, indexId, limit, offset, iterator, key){
    var conn = this;
    if (!(key instanceof Array))
        key = [key];

    return new Promise(function(resolve, reject){
        if (typeof(spaceId) == 'string' && conn.namespace[spaceId])
            spaceId = conn.namespace[spaceId].id;
        if (typeof(indexId)=='string' && conn.namespace[spaceId] && conn.namespace[spaceId].indexes[indexId])
            indexId = conn.namespace[spaceId].indexes[indexId];
        if (typeof(spaceId)=='string' || typeof(indexId)=='string')
        {

            return conn._getMetadata(spaceId, indexId)
                .then(function(info){
                    return conn.select(info[0], info[1], limit, offset, iterator, key);
                })
                .then(resolve)
                .catch(reject);
        }
        var reqId = conn._getRequestId();
        //var header = conn._header(tarantoolConstants.RequestCode.rqSelect, reqId);
        //var header = new Buffer([0x82, tarantoolConstants.KeysCode.code, command,
        //    tarantoolConstants.KeysCode.sync, 0xce, 0, 0, 0, 0]);
        //header.writeUInt32BE(reqId, 5);
        //return header;
        //don't need a key for all iterator
        if (iterator == 'all')
            key = [];
        //console.log(spaceId, key);
        var bufKey = conn.msgpack.encode(key);
        var len = 31+bufKey.length;
        var buffer = createBuffer(5+len);

        buffer[0] = 0xce;
        buffer.writeUInt32BE(len, 1);
        buffer[5] = 0x82;
        buffer[6] = tarantoolConstants.KeysCode.code;
        buffer[7] = tarantoolConstants.RequestCode.rqSelect;
        buffer[8] = tarantoolConstants.KeysCode.sync;
        buffer[9] = 0xce;
        buffer.writeUInt32BE(reqId, 10)
        buffer[14] = 0x86;
        buffer.writeUInt8(tarantoolConstants.KeysCode.space_id, 15);
        buffer[16] = 0xcd;
        buffer.writeUInt16BE(spaceId, 17);
        buffer[19] = tarantoolConstants.KeysCode.index_id;
        buffer.writeUInt8(indexId, 20);
        buffer[21] = tarantoolConstants.KeysCode.limit;
        buffer[22] = 0xce;
        buffer.writeUInt32BE(limit, 23);
        buffer[27] = tarantoolConstants.KeysCode.offset;
        buffer[28] = 0xce;
        buffer.writeUInt32BE(offset, 29);
        buffer[33] = tarantoolConstants.KeysCode.iterator;
        buffer.writeUInt8(tarantoolConstants.IteratorsType[iterator], 34);
        buffer[35] = tarantoolConstants.KeysCode.key;
        bufKey.copy(buffer, 36);
        //var c= Buffer.concat([new Buffer([0x92]),buffer.slice(5)]);
        //console.log(c);
        //console.log(msgpack.decode(c));
        //console.log(len, buffer.length, bufKey.length, buffer, bufKey, tarantoolConstants.KeysCode.key)

        //var bodyArr = [new Buffer([0x86,tarantoolConstants.KeysCode.space_id]), conn.msgpack.encode(spaceId),
        //    tarantoolConstants.BufferedKeys.index_id, conn.msgpack.encode(indexId),
        //    tarantoolConstants.BufferedKeys.limit, conn.msgpack.encode(limit),
        //    tarantoolConstants.BufferedKeys.offset, conn.msgpack.encode(offset),
        //    tarantoolConstants.BufferedIterators[iterator],
        //    conn.msgpack.encode(key)
        //];
        //console.log(bodyArr);
        //var body = Buffer.concat(bodyArr);
        //conn._request(header, body);
        //var sumL = header.length + body.length;
        //var prefixSizeBuffer = new Buffer(5+sumL);
        //prefixSizeBuffer[0] = 0xCE;
        //prefixSizeBuffer.writeUInt32BE(sumL, 1);
        //header.copy(prefixSizeBuffer, 5);
        //body.copy(prefixSizeBuffer, 5+header.length);
        //console.log('requst', prefixSizeBuffer);
        conn.socket.write(buffer);
        conn.commandsQueue.push([tarantoolConstants.RequestCode.rqSelect, reqId, {resolve: resolve, reject: reject}]);
    });
};

Commands.prototype.selectCb = function(spaceId, indexId, limit, offset, iterator, key, success, error){
    //console.log(arguments);
    var conn = this;
    if (!(key instanceof Array))
        key = [key];
    var reqId = this._getRequestId();
    if (iterator == 'all')
        key = [];
    //console.log(spaceId, key);
    var bufKey = conn.msgpack.encode(key);
    var len = 31+bufKey.length;
    var buffer = createBuffer(5+len);

    buffer[0] = 0xce;
    buffer.writeUInt32BE(len, 1);
    buffer[5] = 0x82;
    buffer[6] = tarantoolConstants.KeysCode.code;
    buffer[7] = tarantoolConstants.RequestCode.rqSelect;
    buffer[8] = tarantoolConstants.KeysCode.sync;
    buffer[9] = 0xce;
    buffer.writeUInt32BE(reqId, 10)
    buffer[14] = 0x86;
    buffer.writeUInt8(tarantoolConstants.KeysCode.space_id, 15);
    buffer[16] = 0xcd;
    buffer.writeUInt16BE(spaceId, 17);
    buffer[19] = tarantoolConstants.KeysCode.index_id;
    buffer.writeUInt8(indexId, 20);
    buffer[21] = tarantoolConstants.KeysCode.limit;
    buffer[22] = 0xce;
    buffer.writeUInt32BE(limit, 23);
    buffer[27] = tarantoolConstants.KeysCode.offset;
    buffer[28] = 0xce;
    buffer.writeUInt32BE(offset, 29);
    buffer[33] = tarantoolConstants.KeysCode.iterator;
    buffer.writeUInt8(tarantoolConstants.IteratorsType[iterator], 34);
    buffer[35] = tarantoolConstants.KeysCode.key;
    bufKey.copy(buffer, 36);
    conn.socket.write(buffer);
    //console.log(buffer);
    conn.commandsQueue.push([tarantoolConstants.RequestCode.rqSelect, reqId, {resolve: success, reject: error}]);
};

Commands.prototype.delete = function(spaceId, indexId, key){
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
            var reqId = this._getRequestId();

            var bufKey = this.msgpack.encode(key);

            var len = 17+bufKey.length;
            var buffer = createBuffer(5+len);

            buffer[0] = 0xce;
            buffer.writeUInt32BE(len, 1);
            buffer[5] = 0x82;
            buffer[6] = tarantoolConstants.KeysCode.code;
            buffer[7] = tarantoolConstants.RequestCode.rqDelete;
            buffer[8] = tarantoolConstants.KeysCode.sync;
            buffer[9] = 0xce;
            buffer.writeUInt32BE(reqId, 10)
            buffer[14] = 0x83;
            buffer.writeUInt8(tarantoolConstants.KeysCode.space_id, 15);
            buffer[16] = 0xcd;
            buffer.writeUInt16BE(spaceId, 17);
            buffer[19] = tarantoolConstants.KeysCode.index_id;
            buffer.writeUInt8(indexId, 20);
            buffer[21] = tarantoolConstants.KeysCode.key;
            bufKey.copy(buffer, 22);


            //var header = this._header(tarantoolConstants.RequestCode.rqDelete, reqId);
            //var buffered = {
            //    spaceId: this.msgpack.encode(spaceId),
            //    indexId: this.msgpack.encode(indexId),
            //    key: this.msgpack.encode(key)
            //};
            //var body = Buffer.concat([new Buffer([0x86,tarantoolConstants.KeysCode.space_id]), buffered.spaceId,
            //    new Buffer([tarantoolConstants.KeysCode.index_id]), buffered.indexId,
            //    new Buffer([tarantoolConstants.KeysCode.key]), buffered.key]);
            //this._request(header, body);
            this.socket.write(buffer);
            this.commandsQueue.push([tarantoolConstants.RequestCode.rqSelect, reqId, {resolve: resolve, reject: reject}]);
        }
        else
            reject(new Error('need array'));
    }.bind(this));
};

Commands.prototype.update = function(spaceId, indexId, key, ops){
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
            var reqId = this._getRequestId();
            //var header = this._header(tarantoolConstants.RequestCode.rqUpdate, reqId);
            //var cmd = [{}]

            var bufKey = this.msgpack.encode(key);
            var bufOps = this.msgpack.encode(ops);

            var len = 18+bufKey.length+bufOps.length;
            var buffer = createBuffer(len+5);

            buffer[0] = 0xce;
            buffer.writeUInt32BE(len, 1);
            buffer[5] = 0x82;
            buffer[6] = tarantoolConstants.KeysCode.code;
            buffer[7] = tarantoolConstants.RequestCode.rqUpdate;
            buffer[8] = tarantoolConstants.KeysCode.sync;
            buffer[9] = 0xce;
            buffer.writeUInt32BE(reqId, 10)
            buffer[14] = 0x84;
            buffer.writeUInt8(tarantoolConstants.KeysCode.space_id, 15);
            buffer[16] = 0xcd;
            buffer.writeUInt16BE(spaceId, 17);
            buffer[19] = tarantoolConstants.KeysCode.index_id;
            buffer.writeUInt8(indexId, 20);
            buffer[21] = tarantoolConstants.KeysCode.key;
            bufKey.copy(buffer, 22);
            buffer[22+bufKey.length] = tarantoolConstants.KeysCode.tuple;
            bufOps.copy(buffer, 23+bufKey.length);


            this.socket.write(buffer);


            //var buffered = {
            //    spaceId: this.msgpack.encode(spaceId),
            //    indexId: this.msgpack.encode(indexId),
            //    ops: this.msgpack.encode(ops),
            //    key: this.msgpack.encode(key)
            //};
            //var body = Buffer.concat([new Buffer([0x84,tarantoolConstants.KeysCode.space_id]), buffered.spaceId,
            //    new Buffer([tarantoolConstants.KeysCode.index_id]), buffered.indexId,
            //    new Buffer([tarantoolConstants.KeysCode.key]), buffered.key,
            //    new Buffer([tarantoolConstants.KeysCode.tuple]), buffered.ops]);
            //this._request(header, body);
            this.commandsQueue.push([tarantoolConstants.RequestCode.rqUpdate, reqId, {resolve: resolve, reject: reject}]);
        }
        else
            reject(new Error('need array'));
    }.bind(this));
};



Commands.prototype.upsert = function(spaceId, ops, tuple){
    return new Promise(function (resolve, reject) {
        if (Array.isArray(ops)){
            if (typeof(spaceId)=='string')
            {
                return this._getMetadata(spaceId, 0)
                    .then(function(info){
                        return this.upsert(info[0], ops, tuple);
                    }.bind(this))
                    .then(resolve)
                    .catch(reject);
            }
            var reqId = this._getRequestId();


            var bufTuple = this.msgpack.encode(tuple);
            var bufOps = this.msgpack.encode(ops);

            var len = 16+bufTuple.length+bufOps.length;
            var buffer = createBuffer(len+5);

            buffer[0] = 0xce;
            buffer.writeUInt32BE(len, 1);
            buffer[5] = 0x82;
            buffer[6] = tarantoolConstants.KeysCode.code;
            buffer[7] = tarantoolConstants.RequestCode.rqUpsert;
            buffer[8] = tarantoolConstants.KeysCode.sync;
            buffer[9] = 0xce;
            buffer.writeUInt32BE(reqId, 10)
            buffer[14] = 0x83;
            buffer.writeUInt8(tarantoolConstants.KeysCode.space_id, 15);
            buffer[16] = 0xcd;
            buffer.writeUInt16BE(spaceId, 17);
            buffer[19] = tarantoolConstants.KeysCode.tuple;
            bufTuple.copy(buffer, 20);
            buffer[20+bufTuple.length] = tarantoolConstants.KeysCode.def_tuple;
            bufOps.copy(buffer, 21+bufTuple.length);

            this.socket.write(buffer);

            //var header = this._header(tarantoolConstants.RequestCode.rqUpsert, reqId);
            //var buffered = {
            //    spaceId: this.msgpack.encode(spaceId),
            //    ops: this.msgpack.encode(ops),
            //    tuple: this.msgpack.encode(tuple)
            //};
            //var body = Buffer.concat([new Buffer([0x84,tarantoolConstants.KeysCode.space_id]), buffered.spaceId,
            //    new Buffer([tarantoolConstants.KeysCode.def_tuple]), buffered.ops,
            //    new Buffer([tarantoolConstants.KeysCode.tuple]), buffered.tuple]);
            //if (this.options.log)
            //    console.log(body);
            //this._request(header, body);
            this.commandsQueue.push([tarantoolConstants.RequestCode.rqUpsert, reqId, {resolve: resolve, reject: reject}]);
        }
        else
            reject(new Error('need ops array'));
    }.bind(this));
};


Commands.prototype.eval = function(expression){
    var tuple = Array.prototype.slice.call(arguments, 1);
    return new Promise(function (resolve, reject) {
        var reqId = this._getRequestId();
        var bufExp = this.msgpack.encode(expression);
        var bufTuple = this.msgpack.encode(tuple ? tuple : []);
        var len = 15+bufExp.length + bufTuple.length;
        var buffer = createBuffer(len+5);

        buffer[0] = 0xce;
        buffer.writeUInt32BE(len, 1);
        buffer[5] = 0x82;
        buffer[6] = tarantoolConstants.KeysCode.code;
        buffer[7] = tarantoolConstants.RequestCode.rqEval;
        buffer[8] = tarantoolConstants.KeysCode.sync;
        buffer[9] = 0xce;
        buffer.writeUInt32BE(reqId, 10)
        buffer[14] = 0x82;
        buffer.writeUInt8(tarantoolConstants.KeysCode.expression, 15);
        bufExp.copy(buffer, 16);
        buffer[16+bufExp.length] = tarantoolConstants.KeysCode.tuple;
        bufTuple.copy(buffer, 17+bufExp.length);

        this.socket.write(buffer);
        
        // var header = this._header(tarantoolConstants.RequestCode.rqEval, reqId);
        // var buffered = {
        //     expression: this.msgpack.encode(expression),
        //     tuple: this.msgpack.encode(tuple)
        // };
        // var body = Buffer.concat([new Buffer([0x82,tarantoolConstants.KeysCode.expression]), buffered.expression,
        //     new Buffer([tarantoolConstants.KeysCode.tuple]), buffered.tuple]);
        // this._request(header, body);
        this.commandsQueue.push([tarantoolConstants.RequestCode.rqEval, reqId, {resolve: resolve, reject: reject}]);
    }.bind(this));
};

Commands.prototype.call = function(functionName){
    var tuple = arguments.length > 1 ? Array.prototype.slice.call(arguments, 1): [];
    return new Promise(function (resolve, reject) {
        var reqId = this._getRequestId();
        var bufName = this.msgpack.encode(functionName);
        var bufTuple = this.msgpack.encode(tuple ? tuple : []);
        var len = 15+bufName.length + bufTuple.length;
        var buffer = createBuffer(len+5);

        buffer[0] = 0xce;
        buffer.writeUInt32BE(len, 1);
        buffer[5] = 0x82;
        buffer[6] = tarantoolConstants.KeysCode.code;
        buffer[7] = tarantoolConstants.RequestCode.rqCall;
        buffer[8] = tarantoolConstants.KeysCode.sync;
        buffer[9] = 0xce;
        buffer.writeUInt32BE(reqId, 10)
        buffer[14] = 0x82;
        buffer.writeUInt8(tarantoolConstants.KeysCode.function_name, 15);
        bufName.copy(buffer, 16);
        buffer[16+bufName.length] = tarantoolConstants.KeysCode.tuple;
        bufTuple.copy(buffer, 17+bufName.length);

        //console.log(buffer, bufTuple);
        this.socket.write(buffer);
        /*var header = this._header(tarantoolConstants.RequestCode.rqCall, reqId);
        var body = Buffer.concat([new Buffer([0x82,tarantoolConstants.KeysCode.function_name]), buffered.functionName,
            new Buffer([tarantoolConstants.KeysCode.tuple]), buffered.tuple]);
        this._request(header, body);*/
        this.commandsQueue.push([tarantoolConstants.RequestCode.rqCall, reqId, {resolve: resolve, reject: reject}]);
    }.bind(this));
};

Commands.prototype.insert = function(spaceId, tuple){
    var reqId = this._getRequestId();
    return this._replaceInsert(tarantoolConstants.RequestCode.rqInsert, reqId, spaceId, tuple);
};

Commands.prototype.replace = function(spaceId, tuple){
    var reqId = this._getRequestId();
    return this._replaceInsert(tarantoolConstants.RequestCode.rqReplace, reqId, spaceId, tuple);
};

Commands.prototype._replaceInsert = function(cmd, reqId, spaceId, tuple){
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

            var bufTuple = this.msgpack.encode(tuple);

            var len = 15+bufTuple.length;
            var buffer = createBuffer(len+5);

            buffer[0] = 0xce;
            buffer.writeUInt32BE(len, 1);
            buffer[5] = 0x82;
            buffer[6] = tarantoolConstants.KeysCode.code;
            buffer[7] = cmd;
            buffer[8] = tarantoolConstants.KeysCode.sync;
            buffer[9] = 0xce;
            buffer.writeUInt32BE(reqId, 10)
            buffer[14] = 0x82;
            buffer.writeUInt8(tarantoolConstants.KeysCode.space_id, 15);
            buffer[16] = 0xcd;
            buffer.writeUInt16BE(spaceId, 17);
            buffer[19] = tarantoolConstants.KeysCode.tuple;
            bufTuple.copy(buffer, 20);

            //console.log(buffer, bufTuple);
            this.socket.write(buffer);


            //var header = this._header(cmd, reqId);
            //
            //var buffered = {
            //    spaceId: this.msgpack.encode(spaceId),
            //    tuple: this.msgpack.encode(tuple)
            //};
            //var body = Buffer.concat([new Buffer([0x82,tarantoolConstants.KeysCode.space_id]), buffered.spaceId,
            //    new Buffer([tarantoolConstants.KeysCode.tuple]), buffered.tuple]);
            //this._request(header, body);
            this.commandsQueue.push([cmd, reqId, {resolve: resolve, reject: reject}]);
        }
        else
            reject(new Error('need array'));
    }.bind(this));
};

const shatransform = function(t){
    return crypto.createHash('sha1').update(t).digest();
};

function xor(a, b) {
  if (!Buffer.isBuffer(a)) a = new Buffer(a)
  if (!Buffer.isBuffer(b)) b = new Buffer(b)
  var res = []
  if (a.length > b.length) {
    for (var i = 0; i < b.length; i++) {
      res.push(a[i] ^ b[i])
    }
  } else {
    for (var i = 0; i < a.length; i++) {
      res.push(a[i] ^ b[i])
    }
  }
  return new Buffer(res);
}

function scramble(password, salt){
    var encSalt = new Buffer(salt, 'base64');
    var step1 = shatransform(password);
    var step2 = shatransform(step1);
    var step3 = shatransform(Buffer.concat([encSalt.slice(0, 20), step2]));
    return xor(step1, step3);
}

module.exports = Commands;
