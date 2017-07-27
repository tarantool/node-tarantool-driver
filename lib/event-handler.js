var msgpack = require('msgpack-lite');
var debug = require('debug')('tarantool-driver:connection');

var tarantoolConstants = require('./const');

var Decoder = msgpack.Decoder;
var decoder = new Decoder();

exports.connectHandler = function (self) {
	return function () {
		self.setState(self.states.PREHELLO);
		
		//check if there is commands in offlineQueue and send them
		
		// if (self.offlineQueue.length) {
    //   debug('send %d commands in offline queue', self.offlineQueue.length);
    //   var offlineQueue = self.offlineQueue;
    //   self.resetOfflineQueue();
    //   while (offlineQueue.length > 0) {
    //     self.sendCommand(offlineQueue.shift());
    //   }
		// }
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
						self.commandsQueue.peekAt(i)[2].resolve(true);
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
          	self._processResponse(data, offset, len);
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
							self.setState(self.states.AWAITING);
					if (self.awaitingResponseLength<0)
							self.setState(self.states.AWAITING_LENGTH);
					self._addToInnerBuffer(data, offset, data.length - offset);
				}
				else
				{
					//ожидаем длину респонса целиком
					// self.state = self.states.AWAITING_LENGTH;
					self.setState(self.states.AWAITING_LENGTH);
					//добавляем результат в длинный общий бафер в этот момент коннекта по хорошему bufferLength должен быть равен 0
					self._addToInnerBuffer(data);
					return;
				}
				break;
			case self.states.AWAITING:
				self._addToInnerBuffer(data);
				while(self.awaitingResponseLength > 0 && self.awaitingResponseLength <= self.bufferLength)
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
				break;
			case self.states.AWAITING_LENGTH:
				self._addToInnerBuffer(data);
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
							// self.state = self.states.CONNECTED;
							self.setState(self.states.CONNECTED);
							return;
						}
					}
					if (self.awaitingResponseLength>0)
						// self.state = self.states.AWAITING;
					self.setState(self.states.AWAITING);
					if (self.awaitingResponseLength<0)
						// self.state = self.states.AWAITING_LENGTH;
					self.setState(self.states.AWAITING_LENGTH);
				}
				break;
		}
	};
};

exports.errorHandler = function(self){
	return function(error){
		debug('error: %s', error);
		// self.flushQueue(error);
		console.error('[tarantool-driver] socket error:', error.stack);
	};
};

exports.closeHandler = function(self){
	return function(){		
		if (typeof self.options.retryStrategy !== 'function') {
      debug('skip reconnecting because `retryStrategy` is not a function');
      return close();
    }
    var retryDelay = self.options.retryStrategy(++self.retryAttempts);

    if (typeof retryDelay !== 'number') {
      debug('skip reconnecting because `retryStrategy` doesn\'t return a number');
      return close();
    }

    debug('reconnect in %sms', retryDelay);

    self.setState(self.states.RECONNECTING, retryDelay);
    self.reconnectTimeout = setTimeout(function () {
      self.reconnectTimeout = null;
      self.connect().catch(function(){});
    }, retryDelay);
	};

	function close() {
    self.setState(self.states.END);
    self.flushQueue(new Error('closed connection on other side'));
  }
};

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