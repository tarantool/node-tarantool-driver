/* global Promise */


var tarantoolConstants = require('./const');
var net = require('net');
var _ = require('underscore');
var EventEmitter = require('events');
var msgpack = require('msgpack-lite');
var crypto = require('crypto');
var xor = require('bitwise-xor');

const multiplierBuffer = 2;

var Decoder = require("msgpack-lite").Decoder;
var decoder = new Decoder();


//msgpack implementation example
/*
    @interface
    decode: (Buffer buf)
    encode: (Object obj)
 */
const exampleCustomMsgpack = {
    encode: function(obj){
        return msgpack.encode(obj);
    },
    decode: function(buf){
        return msgpack.decode(buf);
    }
};

const shatransform = function(t){
    return crypto.createHash('sha1').update(t).digest();
};
const states = {
    CONNECTING: 0,
    CONNECTED: 1,
    AWAITING: 2,
    INITED: 4,
    PREHELLO: 8,
    AWAITING_LENGTH: 16
};

var revertStates = {};
Object.keys(states).forEach(function(k){
    revertStates[states[k]] = k;
});

const requestMethods = ['select', 'delete', 'insert', 'replace', 'update', 'eval', 'call', 'upsert'];

var requestId = {
    _id: 0,
    getId: function(){
        if (this._id > 1000000)
            this._id = 0;
        return this._id++;
    }
};

const defaultOptions = {
    host: 'localhost',
    port: '3301',
    log: false,
    timeout: 0
};

function createBuffer(size){
  if (Buffer.allocUnsafe)
  {
      return Buffer.allocUnsafe(size);
  }
  if (Buffer.alloc)
  {
    return Buffer.alloc(size)
  }
  return new Buffer(size);
}

function TarantoolConnection (options){
    this.socket = new net.Socket({
        readable: true,
        writable: true
    });
	  this.schemaId = null;
    this.socket.setNoDelay();
    this.msgpack = options.msgpack || msgpack;
    this.state = states.INITED;
    this.options = _.extend({}, defaultOptions, options);
    this.commandsQueue = [];
    this.awaitingDestroy = false;
    this.namespace = {};
    this.bufferSlide = createBuffer(1024*10);
    this.bufferOffset = 0;
    this.bufferLength = 0;
    this.awaitingResponseLength = -1;
    this.socket.on('connect', this.onConnect.bind(this));
    this.socket.on('error', this.onError.bind(this));
    this.socket.on('end', this.onClose.bind(this));
    this.socket.on('data', this.onData.bind(this));
    if (this.options.timeout) {
      this.socket.setTimeout(this.options.timeout, function(socket){
        if (options.log)
          console.log('socket timeouted');
        this.onError(new Error('timeout socket'));
      }.bind(this));
    }
}

TarantoolConnection.prototype._getSpaceId = function(name){
    return this.select(tarantoolConstants.Space.space, tarantoolConstants.IndexSpace.name, 1, 0,
        'eq', [name])
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
        }.bind(this));
};

TarantoolConnection.prototype._getIndexId = function(spaceId, indexName){
    return this.select(tarantoolConstants.Space.index, tarantoolConstants.IndexSpace.indexName, 1, 0,
        'eq', [spaceId, indexName])
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
            }.bind(this));
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

TarantoolConnection.prototype._addToInnerBuffer = function(data, from, size){
    if (from && size)
    {
        if (this.bufferOffset + this.bufferLength + size < this.bufferSlide.length)
        {
            data.copy(this.bufferSlide, this.bufferOffset + this.bufferLength, from, from+size);
            this.bufferLength+=size;
        }
        else
        {
            var destLen = size + this.bufferLength;
            if (this.bufferSlide.length > destLen)
            {
                var newBuffer = createBuffer(this.bufferSlide.length * multiplierBuffer);
                this.bufferSlide.copy(newBuffer, 0, this.bufferOffset, this.bufferOffset+this.bufferLength);
                data.copy(newBuffer, this.bufferLength, from, from+size);
                this.bufferSlide = newBuffer;
            }
            else
            {
                var newLen = this.bufferSlide.length*multiplierBuffer;
                while(newLen < destLen)
                    newLen *= multiplierBuffer;
                var newBuffer = createBuffer(newLen);
                //console.log('increase new buffer', newBuffer.length, destLen);
                this.bufferSlide.copy(newBuffer, 0, this.bufferOffset, this.bufferOffset+this.bufferLength);
                data.copy(newBuffer, this.bufferLength, from, from+size);
                this.bufferSlide = newBuffer;
            }
            this.bufferOffset = 0;
            this.bufferLength = destLen;
        }
    }
    else
    {
        if (this.bufferOffset + this.bufferLength + data.length < this.bufferSlide.length)
        {
            data.copy(this.bufferSlide, this.bufferOffset + this.bufferLength);
            this.bufferLength+=data.length;
        }
        else
        {
            var destLen = data.length + this.bufferLength;
            if (this.bufferSlide.length > destLen)
            {
                var newBuffer = createBuffer(this.bufferSlide.length * multiplierBuffer);
                this.bufferSlide.copy(newBuffer, 0, this.bufferOffset, this.bufferOffset+this.bufferLength);
                data.copy(newBuffer, this.bufferLength);
                this.bufferSlide = newBuffer;
            }
            else
            {
                var newLen = this.bufferSlide.length*multiplierBuffer;
                while(newLen < destLen)
                    newLen *= multiplierBuffer;
                var newBuffer = createBuffer(newLen);
                //console.log('increase new buffer', newBuffer.length, destLen);
                this.bufferSlide.copy(newBuffer, 0, this.bufferOffset, this.bufferOffset+this.bufferLength);
                data.copy(newBuffer, this.bufferLength);
                //console.log(this.bufferLength, data.length)
                this.bufferSlide = newBuffer;
            }
            this.bufferOffset = 0;
            this.bufferLength = destLen;
        }
    }
};

TarantoolConnection.prototype.onData = function(data){
    var trackResult;
    //console.log(revertStates[this.state]);
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
            //trackResult = this._responseBufferTrack(data);
            //первые 5 байт под размер
            //console.log('connected', data.length, data);
            if (data.length >= 5)
            {
                var len = data.readUInt32BE(1);
                //console.log('len', len);
                //если респонс пришел целиком
                var offset = 5;
                while(len > 0 && len+offset <= data.length)
                {
                    this._processResponse(data, offset, len);
                    offset+=len;
                    if (data.length - offset)
                    {
                        if (data.length-offset >= 5)
                        {
                            len = data.readUInt32BE(offset+1);
                            offset+=5;
                        }
                        else
                        {
                            len = -1;
                        }
                    }
                    else
                    {
                        return;
                    }

                    //if (this.bufferLength)
                    //{
                    //    if (this.bufferLength>=5)
                    //    {
                    //        this.awaitingResponseLength = this.bufferSlide.readUInt32BE(this.bufferOffset+1);
                    //        this.bufferLength-=5;
                    //        this.bufferOffset+=5;
                    //    }
                    //    else
                    //    {
                    //        this.awaitingResponseLength = -1;
                    //    }
                    //}
                    //else
                    //{
                    //    this.awaitingResponseLength = -1;
                    //    this.state = states.CONNECTED;
                    //    return;
                    //}
                }
                if (len)
                    this.awaitingResponseLength = len;
                if (this.awaitingResponseLength>0)
                    this.state = states.AWAITING;
                if (this.awaitingResponseLength<0)
                    this.state = states.AWAITING_LENGTH;
                this._addToInnerBuffer(data, offset, data.length - offset);
                //if (data.length >= len+5)
                //{
                //    //пакет пришел целиком можно не копировать в общий бафер свой контекст
                //    var offset = 5;
                //    if (data.length ==len+offset)
                //    {
                //        this._processResponse(data, offset, len);
                //        //console.log('full one packet');
                //        return;
                //    }
                //    var awaitLen = false;
                //    //дефолтный отступ
                //    //console.log('before while', len, offset, data.elgnth);
                //    while (len > 0 && offset + len <= data.length)
                //    {
                //        //console.log('while start', len, offset, data.length);
                //        this._processResponse(data, offset, len);
                //        offset+=len;
                //        //console.log('in midlle', offset);
                //        if (data.length - offset >=5)
                //        {
                //            len = data.readUInt32BE(offset+1);
                //            offset += 5;
                //        }
                //        else
                //        {
                //            len = -1;
                //        }
                //        //console.log('while end', len, offset, data.length);
                //    }
                //    if (len > 0)
                //    {
                //        this.awaitingResponseLength = len;
                //        this.state = states.AWAITING;
                //    }
                //    else {
                //        if (offset)
                //        this.state = states.AWAITING_LENGTH;
                //    }
                //    //добавляем результат в длинный общий бафер в этот момент коннекта по хорошему bufferLength должен быть равен 0
                //    this._addToInnerBuffer(data, offset, data.length - offset);
                //    return;
                //}
                //else
                //{
                //    this.awaitingResponseLength = len;
                //    this.state = states.AWAITING;
                //    this._addToInnerBuffer(data, 5, data.length - 5);
                //}
            }
            else
            {
                //ожидаем длину респонса целиком
                this.state = states.AWAITING_LENGTH;
                //добавляем результат в длинный общий бафер в этот момент коннекта по хорошему bufferLength должен быть равен 0
                this._addToInnerBuffer(data);
                return;
            }
            break;
        case states.AWAITING:
            //console.log('awaiting', data, this.bufferLength, this.bufferOffset, this.bufferSlide)
            //console.log('await len', this.awaitingResponseLength);
            this._addToInnerBuffer(data);
            while(this.awaitingResponseLength > 0 && this.awaitingResponseLength <= this.bufferLength)
            {
                //console.log('while start', 'await len:', this.awaitingResponseLength, 'len:', this.bufferLength,
                //    'offset:', this.bufferOffset, 'slice:',
                //    this.bufferSlide.slice(this.bufferOffset, this.bufferOffset+this.bufferLength)
                //);
                this._processResponse(this.bufferSlide, this.bufferOffset, this.awaitingResponseLength);
                this.bufferOffset += this.awaitingResponseLength;
                this.bufferLength -= this.awaitingResponseLength;
                //console.log('aftter process',
                //    'await len:', this.awaitingResponseLength, 'len:', this.bufferLength,
                //    'offset:', this.bufferOffset, 'slice:',
                //    this.bufferSlide.slice(this.bufferOffset, this.bufferOffset+this.bufferLength)
                //);
                if (this.bufferLength)
                {
                    if (this.bufferLength>=5)
                    {
                        this.awaitingResponseLength = this.bufferSlide.readUInt32BE(this.bufferOffset+1);
                        this.bufferLength-=5;
                        this.bufferOffset+=5;
                    }
                    else
                    {
                        this.awaitingResponseLength = -1;
                    }
                }
                else
                {
                    this.awaitingResponseLength = -1;
                    this.state = states.CONNECTED;
                    return;
                }
                //console.log('while end',
                //    'await len:', this.awaitingResponseLength, 'len:', this.bufferLength,
                //    'offset:', this.bufferOffset, 'slice:',
                //    this.bufferSlide.slice(this.bufferOffset, this.bufferOffset+this.bufferLength)
                //);
            }
            if (this.awaitingResponseLength>0)
                this.state = states.AWAITING;
            if (this.awaitingResponseLength<0)
                this.state = states.AWAITING_LENGTH;
            //console.log('after state', this.state);

            //this._processResponse(this.bufferSlide, this.bufferOffset, );
            //trackResult = this._responseBufferTrack(Buffer.concat([this.buffer, data]), this.awaitingResponseLength);
            //if (trackResult.length == 2)
            //{
            //    this.state = states.AWAITING;
            //    this.awaitingResponseLength = trackResult[1];
            //    this.buffer = trackResult[0];
            //    if (this.options.log)
            //    {
            //        console.log('state awaiting and awaiting result');
            //    }
            //}
            //else
            //{
            //    this.buffer = null;
            //    this.state = states.CONNECTED;
            //    if (this.options.log)
            //    {
            //        console.log('state awaiting to state connected and clear buffer');
            //    }
            //}
            break;
        case states.AWAITING_LENGTH:
            //console.log('awaiting length', data, this.bufferLength, this.bufferOffset, this.bufferSlide);
            this._addToInnerBuffer(data);
            if (this.bufferLength >= 5)
            {
                this.awaitingResponseLength = this.bufferSlide.readUInt32BE(this.bufferOffset+1);
                this.bufferLength-=5;
                this.bufferOffset+=5;
                while(this.awaitingResponseLength >0 && this.awaitingResponseLength <= this.bufferLength)
                {
                    //console.log('bb while start', 'await len:', this.awaitingResponseLength, 'len:', this.bufferLength,
                    //    'offset:', this.bufferOffset, 'slice:',
                    //    this.bufferSlide.slice(this.bufferOffset, this.bufferOffset+this.bufferLength)
                    //);
                    this._processResponse(this.bufferSlide, this.bufferOffset, this.awaitingResponseLength);
                    this.bufferOffset += this.awaitingResponseLength;
                    this.bufferLength -= this.awaitingResponseLength;
                    //console.log('bb aftter process',
                    //    'await len:', this.awaitingResponseLength, 'len:', this.bufferLength,
                    //    'offset:', this.bufferOffset, 'slice:',
                    //    this.bufferSlide.slice(this.bufferOffset, this.bufferOffset+this.bufferLength)
                    //);
                    if (this.bufferLength)
                    {
                        if (this.bufferLength>=5)
                        {
                            this.awaitingResponseLength = this.bufferSlide.readUInt32BE(this.bufferOffset+1);
                            this.bufferLength-=5;
                            this.bufferOffset+=5;
                        }
                        else
                        {
                            this.awaitingResponseLength = -1;
                        }
                    }
                    else
                    {
                        this.awaitingResponseLength = -1;
                        this.state = states.CONNECTED;
                        //console.log('to connected states', this.bufferOffset, this.bufferLength, this.bufferSlide.slice(this.bufferOffset, this.bufferOffset+10));
                        return;
                    }
                    //console.log('bb while end',
                    //    'await len:', this.awaitingResponseLength, 'len:', this.bufferLength,
                    //    'offset:', this.bufferOffset, 'slice:',
                    //    this.bufferSlide.slice(this.bufferOffset, this.bufferOffset+this.bufferLength)
                    //);
                }
                if (this.awaitingResponseLength>0)
                    this.state = states.AWAITING;
                if (this.awaitingResponseLength<0)
                    this.state = states.AWAITING_LENGTH;
            }
            //console.log('bb after state', this.state);
            break;
    }
};

TarantoolConnection.prototype._responseIt = function(buffer, offset, length){
    decoder.buffer = buffer;
    decoder.offset = offset;
    return decoder.fetch();
};

TarantoolConnection.prototype._responseBufferTrack = function(buffer, length){

    if (!length)
    {
        if (buffer.length >= 5)
        {
            length = buffer.readUInt32BE(1);
            //buffer = buffer.slice(5);
        }
        else{
            if (this.bufferSlide.length < buffer.length + this.bufferOffset + this.bufferLength)
            {
                if (buffer.length > this.bufferSlide.length+this.bufferLength)
                {
                    var destLen = this.bufferSlide.length+this.bufferLength;
                    var futureLen = this.bufferSlide.length;
                    while(futureLen<destLen)
                    {
                        futureLen = futureLen * multiplierBuffer;
                    }
                    var newBuffer = createBuffer(futureLen);
                    this.bufferSlide.copy(newBuffer, 0, this.bufferOffset, this.bufferLength);
                    buffer.copy(newBuffer, this.bufferLength);
                    this.bufferSlide = newBuffer;
                    this.bufferOffset = 0;
                    this.bufferLength = destLen;
                }
                else {
                    var prevBuffer = this.bufferSlide.slice(this.bufferOffset, this.bufferOffset+this.bufferLength);
                    prevBuffer.copy(this.bufferSlide, 0);
                    buffer.copy(this.bufferSlide, prevBuffer.length);
                    this.bufferOffset = 0;
                    this.bufferLength = prevBuffer.length + buffer.length;
                }
            }
            else
            {
                buffer.copy(this.bufferSlide, this.bufferOffset+this.bufferLength);
                this.bufferLength += buffer.length;

            }
            return [buffer, null];
        }
    }
    if (buffer.length >= length)
    {
        if (buffer.length == length)
        {
            this._processResponse(buffer, 5, buffer.length-5);
            return [];
        }
        else
        {
            var curBuffer = buffer.slice(0, length);
            this._processResponse(buffer);
            return this._responseBufferTrack(buffer.slice(length));
        }
    }
    else
    {
        if (this.bufferSlide.length < buffer.length + this.bufferOffset + this.bufferLength)
        {
            if (buffer.length > this.bufferSlide.length+this.bufferLength)
            {
                var destLen = this.bufferSlide.length+this.bufferLength;
                var futureLen = this.bufferSlide.length;
                while(futureLen<destLen)
                {
                    futureLen = futureLen * multiplierBuffer;
                }
                var newBuffer = createBuffer(futureLen);
                this.bufferSlide.copy(newBuffer, 0, this.bufferOffset, this.bufferLength);
                buffer.copy(newBuffer, this.bufferLength);
                this.bufferSlide = newBuffer;
                this.bufferOffset = 0;
                this.bufferLength = destLen;
            }
            else {
                var prevBuffer = this.bufferSlide.slice(this.bufferOffset, this.bufferOffset+this.bufferLength);
                prevBuffer.copy(this.bufferSlide, 0);
                buffer.copy(this.bufferSlide, prevBuffer.length);
                this.bufferOffset = 0;
                this.bufferLength = prevBuffer.length + buffer.length;
            }
        }
        else
        {
            buffer.copy(this.bufferSlide, this.bufferOffset+this.bufferLength);
            this.bufferLength += buffer.length;

        }
        return [buffer, length];
    }
};

TarantoolConnection.prototype._processResponse = function(buffer, offset, length){
    //if (offset)
    //{
    //  var dataBuffer = createBuffer(length+1);
    //  dataBuffer[0]= 0x92;
    //  buffer.copy(dataBuffer, 1, offset, `);
    //}
    //else
    //{
    //  // add fixarraymap with 2 objects before main object
    //  var dataBuffer = Buffer.concat([new Buffer([0x92]), buffer]);
    //}
        //console.log('process', buffer, offset)
        decoder.buffer = buffer;
        decoder.offset = offset || 0;
        //var header = decoder.fetch();
        //var body = decoder.fetch();
        var obj = [decoder.fetch(), decoder.fetch()];
        //console.log('proc 2', obj);
        //console.log(obj);

    var reqId = obj[0][1];
    if (this.schemaId)
    {
      if (this.schemaId != obj[0][5])
      {
        this.schemaId = obj[0][5];
        //clear cache for naming
        this.namespace = {};
      }
    }
    else
    {
      this.schemaId = obj[0][5];
    }
    var task;
    for(var i = 0; i<this.commandsQueue.length; i++) {
      task = this.commandsQueue[i];
      if (task[1] == reqId)
      {
        this.commandsQueue.splice(i, 1);
        break;
      }
    }

    var dfd = task[2];
    var success = obj[0][0] == 0 ? true : false;
    if (this.options.log)
    {
      console.log('process msg object', obj);
        console.log('is success', success);
        console.log(dfd);
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
    if (this.options.log)
      console.log('error socket', error);
    this._interupt(error);
    this._stubMethods();
    this.socket.destroy();
    this.commandsQueue = [];
};

TarantoolConnection.prototype.onClose = function(){
    if (this.options.log)
      console.log('end by other side');
    this._interupt(new Error('closed connection on other side'));
    this._stubMethods();
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
    var conn = this;
    if (!(key instanceof Array))
        key = [key];

    return new Promise(function(resolve, reject){
        if (typeof(spaceId)=='string' || typeof(indexId)=='string')
        {
            return conn._getMetadata(spaceId, indexId)
                .then(function(info){
                    return conn.select(info[0], info[1], limit, offset, iterator, key);
                })
                .then(resolve)
                .catch(reject);
        }
        var reqId = requestId.getId();
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

TarantoolConnection.prototype.selectCb = function(spaceId, indexId, limit, offset, iterator, key, success, error){
    //console.log(arguments);
    var conn = this;
    if (!(key instanceof Array))
        key = [key];
    var reqId = requestId.getId();
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



TarantoolConnection.prototype.upsert = function(spaceId, ops, tuple){
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
            var reqId = requestId.getId();


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
            buffer[14] = 0x84;
            buffer.writeUInt8(tarantoolConstants.KeysCode.space_id, 15);
            buffer[16] = 0xcd;
            buffer.writeUInt16BE(spaceId, 17);
            buffer[19] = tarantoolConstants.KeysCode.def_tuple;
            bufOps.copy(buffer, 20);
            buffer[20+bufOps.length] = tarantoolConstants.KeysCode.tuple;
            bufTuple.copy(buffer, 21+bufOps.length);

            //console.log(buffer, bufOps, bufTuple);
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


TarantoolConnection.prototype.eval = function(expression){
    var tuple = Array.prototype.slice.call(arguments, 1);
    return new Promise(function (resolve, reject) {
        var reqId = requestId.getId();
        var header = this._header(tarantoolConstants.RequestCode.rqEval, reqId);
        var buffered = {
            expression: this.msgpack.encode(expression),
            tuple: this.msgpack.encode(tuple)
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
            functionName: this.msgpack.encode(functionName),
            tuple: this.msgpack.encode(tuple ? tuple : [])
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

TarantoolConnection.prototype.auth = function(username, password){
    return new Promise(function (resolve, reject) {
        var reqId = requestId.getId();
        var header = this._header(tarantoolConstants.RequestCode.rqAuth, reqId);
        var buffered = {
            username: this.msgpack.encode(username)
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
    return xor(step1, step3);
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
    //console.log('requst', prefixSizeBuffer);
    this.socket.write(prefixSizeBuffer);
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