exports.createBuffer = function(size){
  if (Buffer.allocUnsafe)
  {
      return Buffer.allocUnsafe(size);
  }
  if (Buffer.alloc)
  {
    return Buffer.alloc(size);
  }
  return new Buffer(size);
};

exports.TarantoolError = function(msg){
	Error.call(this);
	if (Error.captureStackTrace) {
		Error.captureStackTrace(this);
	} else {
		this.stack = new Error().stack;
	}
	this.message = msg;
	this.name = 'TarantoolError';
};
exports.TarantoolError.prototype = Object.create(Error.prototype);
exports.TarantoolError.prototype.constructor = Error;