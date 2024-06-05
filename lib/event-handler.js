var debug = require('debug')('tarantool-driver:handler');
var { TarantoolError } = require('./utils');

exports.connectHandler = function (self) {
	return function () {
		self.retryAttempts = 0;
		switch(self.state){
			case self.states.CONNECTING:
				self.dataState = self.states.PREHELLO;
				break;
			case self.states.CONNECTED:
				if(self.options.password){
					self.setState(self.states.AUTH);
					self._auth(self.options.username, self.options.password)
						.then(function(){
							self.setState(self.states.CONNECT, {host: self.options.host, port: self.options.port});
							debug('authenticated [%s]', self.options.username);
							sendOfflineQueue(self);
						}, function(err){
							self.flushQueue(err);
							self.silentEmit('error', err);
							self.disconnect(true);
						});
				} else {
					self.setState(self.states.CONNECT, {host: self.options.host, port: self.options.port});
					sendOfflineQueue(self);
				}
				break;
		}
  };
};

function sendOfflineQueue(self){
	if (self.offlineQueue.length) {
		debug('send %d commands in offline queue', self.offlineQueue.length);
		var offlineQueue = self.offlineQueue;
		self.resetOfflineQueue();
		while (offlineQueue.length > 0) {
			var command = offlineQueue.shift();
			self.sendCommand(command[0], command[1]);
		}
	}
}

exports.dataHandler = function(self){
	return function(data){
		switch(self.dataState){
			case self.states.PREHELLO:
				self.salt = data.slice(64, 108).toString('utf8');
				self.dataState = self.states.CONNECTED;
				self.setState(self.states.CONNECTED);
				exports.connectHandler(self)();
				break;
			case self.states.CONNECTED:
				if (data.length >= 5)
				{
					var len = data.readUInt32BE(1);
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
						self.dataState = self.states.AWAITING;
					if (self.awaitingResponseLength<0)
						self.dataState = self.states.AWAITING_LENGTH;
					self.bufferSlide.add(data, offset, data.length - offset);
				}
				else
				{
					self.dataState = self.states.AWAITING_LENGTH;
					self.bufferSlide.add(data);
					return;
				}
				break;
			case self.states.AWAITING:
				self.bufferSlide.add(data);
				while(self.awaitingResponseLength > 0 && self.awaitingResponseLength <= self.bufferSlide.bufferLength)
				{
					self._processResponse(self.bufferSlide.buffer, self.bufferSlide.bufferOffset);
					self.bufferSlide.bufferOffset += self.awaitingResponseLength;
					self.bufferSlide.bufferLength -= self.awaitingResponseLength;
					if (self.bufferSlide.bufferLength)
					{
						if (self.bufferSlide.bufferLength>=5)
						{
							self.awaitingResponseLength = self.bufferSlide.buffer.readUInt32BE(self.bufferSlide.bufferOffset+1);
							self.bufferSlide.bufferLength-=5;
							self.bufferSlide.bufferOffset+=5;
						}
						else
						{
							self.awaitingResponseLength = -1;
						}
					}
					else
					{
						self.awaitingResponseLength = -1;
						self.dataState = self.states.CONNECTED;
						self.state = self.states.CONNECT;
						return;
					}
				}
				if (self.awaitingResponseLength>0)
					self.dataState = self.states.AWAITING;
					self.state = self.states.AWAITING;
				if (self.awaitingResponseLength<0)
					self.dataState = self.states.AWAITING_LENGTH;
					self.state = self.states.AWAITING_LENGTH;
				break;
			case self.states.AWAITING_LENGTH:
				self.bufferSlide.add(data);
				if (self.bufferSlide.bufferLength >= 5)
				{
					self.awaitingResponseLength = self.bufferSlide.buffer.readUInt32BE(self.bufferSlide.bufferOffset+1);
					self.bufferSlide.bufferLength-=5;
					self.bufferSlide.bufferOffset+=5;
					while(self.awaitingResponseLength >0 && self.awaitingResponseLength <= self.bufferSlide.bufferLength)
					{
						self._processResponse(self.bufferSlide.buffer, self.bufferSlide.bufferOffset, self.awaitingResponseLength);
						self.bufferSlide.bufferOffset += self.awaitingResponseLength;
						self.bufferSlide.bufferLength -= self.awaitingResponseLength;
						if (self.bufferSlide.bufferLength)
						{
							if (self.bufferSlide.bufferLength>=5)
							{
								self.awaitingResponseLength = self.bufferSlide.buffer.readUInt32BE(self.bufferSlide.bufferOffset+1);
								self.bufferSlide.bufferLength-=5;
								self.bufferSlide.bufferOffset+=5;
							}
							else
							{
								self.awaitingResponseLength = -1;
							}
						}
						else
						{
							self.awaitingResponseLength = -1;
							self.dataState = self.states.CONNECTED;
							self.state = self.states.CONNECT;
							return;
						}
					}
					if (self.awaitingResponseLength>0)
						self.dataState = self.states.AWAITING;
					if (self.awaitingResponseLength<0)
						self.dataState = self.states.AWAITING_LENGTH;
				}
				break;
		}
	};
};

exports.errorHandler = function(self){
	return function(error){
		debug('error: %s', error);
		self.silentEmit('error', error);
	};
};

exports.closeHandler = function (self) {
	function close () {
		self.setState(self.states.END);
		self.flushQueue(new TarantoolError('Connection is closed.'));
  	}

	return function(){
		process.nextTick(self.emit.bind(self, 'close'));
		if (self.manuallyClosing) {
			self.manuallyClosing = false;
			debug('skip reconnecting since the connection is manually closed.');
			return close();
		}
		if (typeof self.options.retryStrategy !== 'function') {
			debug('skip reconnecting because `retryStrategy` is not a function');
			return close();
		}
		var retryDelay = self.options.retryStrategy(++self.retryAttempts);

		if (typeof retryDelay !== 'number') {
			debug('skip reconnecting because `retryStrategy` doesn\'t return a number');
			return close();
		}
		self.setState(self.states.RECONNECTING, retryDelay);
		if (self.options.reserveHosts) {
			if (self.retryAttempts-1 == self.options.beforeReserve){
				self.useNextReserve();
				self.connect().catch(function(){});
				return;
			}
		}
		debug('reconnect in %sms', retryDelay);

		self.reconnectTimeout = setTimeout(function () {
			self.reconnectTimeout = null;
			self.connect().catch(function(){});
		}, retryDelay);
	};
};