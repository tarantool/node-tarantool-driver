exports.createBuffer = function (size){
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

exports.parseURL = function(str, reserve){
  var result = {};
  var parsed = str.split(':');
  if(reserve){
    result.username = null;
    result.password = null;
  }
  switch (parsed.length){
    case 1:
      result.host = parsed[0];
      break;
    case 2:
      result.host = parsed[0];
      result.port = parsed[1];
      break;
    default:
      result.username = parsed[0];
      result.password = parsed[1].split('@')[0];
      result.host = parsed[1].split('@')[1];
      result.port = parsed[2];
  }
  return result;
};

exports.TarantoolError = function(msg){
  Error.call(this);
  this.message = msg;
	this.name = 'TarantoolError';
  if (Error.captureStackTrace) {
		Error.captureStackTrace(this);
	} else {
		this.stack = new Error().stack;
	}
};
exports.TarantoolError.prototype = Object.create(Error.prototype);
exports.TarantoolError.prototype.constructor = Error;