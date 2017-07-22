var msgpack = require('msgpack-lite');
var debug = require('debug');
var debugResp = debug('tarantool-driver:response');
var debugConn = debug('tarantool-driver:connection');

var utils = require('./utils');
var tarantoolConstants = require('./const');

var Decoder = msgpack.Decoder;
var decoder = new Decoder();

var multiplierBuffer = 2;

exports.connectHandler = function (self) {
	return function () {
		self.setState(this.states.PREHELLO);
		
		//check if there is commands in offlineQueue and send them
		if (self.offlineQueue.length) {
      debugConn('send %d commands in offline queue', self.offlineQueue.length);
      var offlineQueue = self.offlineQueue;
      self.resetOfflineQueue();
      while (offlineQueue.length > 0) {
        self.sendCommand(offlineQueue.shift());
      }
		}
		
  };
};

exports.dataHandler = function(self){
	return function(data){
		switch(self.state){
			case self.states.PREHELLO:
				for (var i = 0; i<self.commandsQueue.length; i++)
				{
					if (self.commandsQueue._list[(self.commandsQueue._head + i) & self.commandsQueue._capacityMask][0] == tarantoolConstants.RequestCode.rqConnect)
					{
						self.commandsQueue.peekAt(i)[1].resolve(true);
						self.commandsQueue.removeOne(i);
						i--;
					}
				}
				self.salt = data.slice(64, 108).toString('utf8');
				self.setState(self.states.CONNECTED);
				// self.state = self.states.CONNECTED;
				break;
			case self.states.CONNECTED:
				//console.log('connected', data.length, data);
				if (data.length >= 5)
				{
					var len = data.readUInt32BE(1);
					//если респонс пришел целиком
					var offset = 5;
					while(len > 0 && len+offset <= data.length)
					{
						_processResponse(self, data, offset, len);
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
					}
					if (len)
							self.awaitingResponseLength = len;
					if (self.awaitingResponseLength>0)
							self.state = self.states.AWAITING;
					if (self.awaitingResponseLength<0)
							self.state = self.states.AWAITING_LENGTH;
					_addToInnerBuffer(self, data, offset, data.length - offset);
				}
				else
				{
					//ожидаем длину респонса целиком
					self.state = self.states.AWAITING_LENGTH;
					//добавляем результат в длинный общий бафер в этот момент коннекта по хорошему bufferLength должен быть равен 0
					_addToInnerBuffer(self, data);
					return;
				}
				break;
			case self.states.AWAITING_LENGTH:
				_addToInnerBuffer(self, data);
				if (self.bufferLength >= 5)
				{
					self.awaitingResponseLength = self.bufferSlide.readUInt32BE(self.bufferOffset+1);
					self.bufferLength-=5;
					self.bufferOffset+=5;
					while(self.awaitingResponseLength >0 && self.awaitingResponseLength <= self.bufferLength)
					{
						self._processResponse(self.bufferSlide, self.bufferOffset, self.awaitingResponseLength);
						self.bufferOffset += self.awaitingResponseLength;
						self.bufferLength -= self.awaitingResponseLength;
						if (self.bufferLength)
						{
							if (self.bufferLength>=5)
							{
								self.awaitingResponseLength = self.bufferSlide.readUInt32BE(self.bufferOffset+1);
								self.bufferLength-=5;
								self.bufferOffset+=5;
							}
							else
							{
								self.awaitingResponseLength = -1;
							}
						}
						else
						{
							self.awaitingResponseLength = -1;
							self.state = self.states.CONNECTED;
							return;
						}
					}
					if (self.awaitingResponseLength>0)
						self.state = self.states.AWAITING;
					if (self.awaitingResponseLength<0)
						self.state = self.states.AWAITING_LENGTH;
				}
				break;
		}
	};
};

exports.errorHandler = function(self){
	return function(error){
		debugConn('error: %s', error);
		self.flushQueue(error);
		self.setState(self.states.END);
		//emit silent error
	};
};

exports.closeHandler = function(self){
	return function(){
		debugConn('end by other side');
		self.flushQueue(new Error('closed connection on other side'));
		self.setState(self.states.END);
	};
};

function _processResponse(self, buffer, offset, length){
	offset=offset||0;
	decoder.buffer = buffer;
	decoder.offset = offset+23;
	var obj = decoder.fetch();
	//console.log('proc 2', obj);
	//console.log(obj);
	var schemaId = buffer.readUInt32BE(offset+19);
	var reqId = buffer.readUInt32BE(offset+13);
	var code = buffer.readUInt32BE(offset+3);
	if (self.schemaId)
	{
	  if (self.schemaId != schemaId)
	  {
		self.schemaId = schemaId;
		//clear cache for naming
		self.namespace = {};
	  }
	}
	else
	{
	  self.schemaId = schemaId;
	}
	var task;
	for(var i = 0; i<self.commandsQueue.length; i++) {
		task = self.commandsQueue._list[(self.commandsQueue._head + i) & self.commandsQueue._capacityMask];
		if (task[1] == reqId)
		{
			self.commandsQueue.removeOne(i);
			break;
		}
	}
	var dfd = task[2];
	var success = code == 0 ? true : false;
	debugResp('success - [%s] \nprocess msg object %O \n', success, obj);
	if (success)
	  dfd.resolve(_isAuth(task[0], obj[tarantoolConstants.KeysCode.data]));
	else
	  dfd.reject(new Error(obj[tarantoolConstants.KeysCode.error]));
	if (self.state === self.states.END && self.commandsQueue.length == 1)
	{
	  self.commandsQueue.peekAt(0)[2].resolve(true);
	  self.socket.destroy();
	}
}

function _isAuth(cmd, data){
	return cmd == tarantoolConstants.RequestCode.rqAuth ? true : data;
}

function _addToInnerBuffer(self, data, from, size){
	var newBuffer;
	var destLen;
	var newLen;
	if (from && size)
	{
		if (self.bufferOffset + self.bufferLength + size < self.bufferSlide.length)
		{
			data.copy(self.bufferSlide, self.bufferOffset + self.bufferLength, from, from+size);
			self.bufferLength+=size;
		}
		else
		{
			destLen = size + self.bufferLength;
			if (self.bufferSlide.length > destLen)
			{
				newBuffer = utils.createBuffer(self.bufferSlide.length * multiplierBuffer);
				self.bufferSlide.copy(newBuffer, 0, self.bufferOffset, self.bufferOffset+self.bufferLength);
				data.copy(newBuffer, self.bufferLength, from, from+size);
				self.bufferSlide = newBuffer;
			}
			else
			{
				newLen = self.bufferSlide.length*multiplierBuffer;
				while(newLen < destLen)
					newLen *= multiplierBuffer;
				newBuffer = utils.createBuffer(newLen);
				//console.log('increase new buffer', newBuffer.length, destLen);
				self.bufferSlide.copy(newBuffer, 0, self.bufferOffset, self.bufferOffset+self.bufferLength);
				data.copy(newBuffer, self.bufferLength, from, from+size);
				self.bufferSlide = newBuffer;
			}
			self.bufferOffset = 0;
			self.bufferLength = destLen;
		}
	}
	else
	{
		if (self.bufferOffset + self.bufferLength + data.length < self.bufferSlide.length)
		{
			data.copy(self.bufferSlide, self.bufferOffset + self.bufferLength);
			self.bufferLength+=data.length;
		}
		else
		{
			destLen = data.length + self.bufferLength;
			if (self.bufferSlide.length > destLen)
			{
				newBuffer = utils.createBuffer(self.bufferSlide.length * multiplierBuffer);
				self.bufferSlide.copy(newBuffer, 0, self.bufferOffset, self.bufferOffset+self.bufferLength);
				data.copy(newBuffer, self.bufferLength);
				self.bufferSlide = newBuffer;
			}
			else
			{
				newLen = self.bufferSlide.length*multiplierBuffer;
				while(newLen < destLen)
					newLen *= multiplierBuffer;
				newBuffer = utils.createBuffer(newLen);
				//console.log('increase new buffer', newBuffer.length, destLen);
				self.bufferSlide.copy(newBuffer, 0, self.bufferOffset, self.bufferOffset+self.bufferLength);
				data.copy(newBuffer, self.bufferLength);
				//console.log(self.bufferLength, data.length)
				self.bufferSlide = newBuffer;
			}
			self.bufferOffset = 0;
			self.bufferLength = destLen;
		}
	}
}

// TarantoolConnection.prototype.onError = function(error){
// 	if (this.options.log)
// 	  console.log('error socket', error);
// 	this._interupt(error);
// 	this._stubMethods();
// 	this.socket.destroy();
// 	this.commandsQueue.clear();
// };

// TarantoolConnection.prototype.onClose = function(){
// 	if (this.options.log)
// 	  console.log('end by other side');
// 	this._interupt(new Error('closed connection on other side'));
// 	this._stubMethods();
// };

// TarantoolConnection.prototype._interupt = function(error){
// 	for (var i=0; i<this.commandsQueue.length; i++) {
// 		if(this.commandsQueue.peekAt(i)[0] == tarantoolConstants.RequestCode.rqConnect){
// 			this.commandsQueue.peekAt(i)[1].reject(error);
// 		}
// 	}
// };