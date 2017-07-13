/* global Promise */

// var Promise = require('bluebird');
// var net = require('net');
var EventEmitter = require('events').EventEmitter;
var util = require('util');
var msgpack = require('msgpack-lite');
var crypto = require('crypto');
var objectAssign = require('object-assign');
var debug = require('debug')('tarantool-node:connection');
var _ = require('lodash');

var Denque = require('./denque');
var tarantoolConstants = require('./const');
var Commands = require('./commands');
var Connector = require('./connector');
var eventHandler = require('./event-handler');
var multiplierBuffer = 2;

var Decoder = require("msgpack-lite").Decoder;
var decoder = new Decoder();

var states = {
    CONNECTING: 0,
    CONNECTED: 1,
    AWAITING: 2,
    INITED: 4,
    PREHELLO: 8,
    AWAITING_LENGTH: 16
};
// var revertStates = {};
// Object.keys(states).forEach(function(k){
//     revertStates[states[k]] = k;
// });

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
    if (!(this instanceof TarantoolConnection)) {
        return new TarantoolConnection(arguments[0], arguments[1], arguments[2]);
    }
    this.parseOptions(arguments[0], arguments[1], arguments[2]);
    this.connector = new Connector(this.options);
    EventEmitter.call(this);
	this.schemaId = null;
    this.socket.setNoDelay(true);
    this.msgpack = msgpack;
    this.states = {
        CONNECTING: 0,
        CONNECTED: 1,
        AWAITING: 2,
        INITED: 4,
        PREHELLO: 8,
        AWAITING_LENGTH: 16
    },
    this.state = states.INITED;
    this.options = objectAssign({}, TarantoolConnection.defaultOptions, options);
    this.commandsQueue = new Denque();
    this.awaitingDestroy = false;
    this.namespace = {};
    this.bufferSlide = createBuffer(1024*10);
    this.bufferOffset = 0;
    this.bufferLength = 0;
    this.awaitingResponseLength = -1;
    // this.socket.on('connect', this.onConnect.bind(this));
    // this.socket.on('error', this.onError.bind(this));
    // this.socket.on('end', this.onClose.bind(this));
    // this.socket.on('data', this.onData.bind(this));
    this._id = 0;
    if (this.options.timeout) {
      this.socket.setTimeout(this.options.timeout, function(socket){
        if (options.log)
          console.log('socket timeouted');
        this.onError(new Error('timeout socket'));
      }.bind(this));
    }
}

util.inherits(TarantoolConnection, EventEmitter);
_.assign(TarantoolConnection.prototype, Commands.prototype);

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

TarantoolConnection.prototype._getRequestId = function(){
  if (this._id > 3000000)
    this._id =0;
  return this._id++;
};

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
                if (this.commandsQueue._list[(this.commandsQueue._head + i) & this.commandsQueue._capacityMask][0] == tarantoolConstants.RequestCode.rqConnect)
                {
                    this.commandsQueue.peekAt(i)[1].resolve(true);
                    this.commandsQueue.removeOne(i);
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
		offset=offset||0
        decoder.buffer = buffer;
        decoder.offset = offset+23;
        //var header = decoder.fetch();
        //var body = decoder.fetch();
        var obj = decoder.fetch();
        //console.log('proc 2', obj);
        //console.log(obj);
	var schemaId = buffer.readUInt32BE(offset+19);
	var reqId = buffer.readUInt32BE(offset+13);
	var code = buffer.readUInt32BE(offset+3);
    if (this.schemaId)
    {
      if (this.schemaId != schemaId)
      {
        this.schemaId = schemaId;
        //clear cache for naming
        this.namespace = {};
      }
    }
    else
    {
      this.schemaId = schemaId;
    }
    var task;
    for(var i = 0; i<this.commandsQueue.length; i++) {
        task = this.commandsQueue._list[(this.commandsQueue._head + i) & this.commandsQueue._capacityMask];
        if (task[1] == reqId)
        {
            this.commandsQueue.removeOne(i);
            break;
        }
    }

    var dfd = task[2];
    var success = code == 0 ? true : false;
    if (this.options.log)
    {
		console.log('process msg object', obj);
		console.log('is success', success);
		console.log(dfd);
		if (obj[tarantoolConstants.KeysCode.data])
			console.log('return data', obj[tarantoolConstants.KeysCode.data]);
    }
    if (success)
      dfd.resolve(this._processResponseBody(task[0], obj[tarantoolConstants.KeysCode.data]));
    else
      dfd.reject(new Error(obj[tarantoolConstants.KeysCode.error]));
    if (this.awaitingDestroy && this.commandsQueue.length == 1)
    {
      this.commandsQueue.peekAt(0)[2].resolve(true);
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
    this.commandsQueue.clear();
};

TarantoolConnection.prototype.onClose = function(){
    if (this.options.log)
      console.log('end by other side');
    this._interupt(new Error('closed connection on other side'));
    this._stubMethods();
};

TarantoolConnection.prototype._interupt = function(error){
    for (var i=0; i<this.commandsQueue.length; i++) {
        if(this.commandsQueue.peekAt(i)[0] == tarantoolConstants.RequestCode.rqConnect){
            this.commandsQueue.peekAt(i)[1].reject(error);
        }
    }
};

TarantoolConnection.prototype.setState = function (state, arg) {
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
    process.nextTick(this.emit.bind(this, state, arg));
};

TarantoolConnection.prototype.connect = function(){
    return new Promise(function (resolve, reject) {
        if (this.state === states.CONNECTING || this.state === states.CONNECTED) {
            reject(new Error('Tarantool is already connecting/connected'));
            return;
        }
        this.commandsQueue.push([tarantoolConstants.RequestCode.rqConnect, {resolve: resolve, reject: reject}]);
        this.setState(states.CONNECTING);
        var _this = this;
        this.connector.connect(function(err, socket){
            if(err){
                _this.flushQueue(err);
                _this.silentEmit('error', err);
                reject(err);
                _this.setStatus('end');
                return;
            }
            socket.once('connect', eventHandler.connectHandler(_this));
            socket.once('error', eventHandler.errorHandler(_this));
            socket.once('close', eventHandler.closeHandler(_this));
            socket.on('data', eventHandler.dataHandler(_this));
        
        });
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
TarantoolConnection.prototype.auth = function(username, password){
    return new Promise(function (resolve, reject) {
        this.commandsQueue.push([tarantoolConstants.RequestCode.rqAuth, reqId, {resolve: resolve, reject: reject}]);
        this.connector.auth(username, password);
        // var reqId = requestId.getId();
        // var header = this._header(tarantoolConstants.RequestCode.rqAuth, reqId);
        // var buffered = {
        //     username: this.msgpack.encode(username)
        // };
        // var scrambled = scramble(password, this.salt);
        // var body = Buffer.concat([new Buffer([0x82, tarantoolConstants.KeysCode.username]), buffered.username,
        //     new Buffer([0x21, 0x92]), tarantoolConstants.passEnter, new Buffer([0xb4]), scrambled]);
        // this._request(header, body);
    }.bind(this));
};

TarantoolConnection.prototype.disconnect = function (reconnect) {
  if (!reconnect) {
    this.manuallyClosing = true;
  }
  if (this.reconnectTimeout) {
    clearTimeout(this.reconnectTimeout);
    this.reconnectTimeout = null;
  }
  if (this.status === 'wait') {
    eventHandler.closeHandler(this)();
  } else {
    this.connector.disconnect();
  }
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
