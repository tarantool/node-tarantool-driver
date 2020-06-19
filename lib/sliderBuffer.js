var utils = require('./utils');

function SliderBuffer(){
  this.bufferOffset = 0;
  this.bufferLength = 0;
  this.buffer = utils.createBuffer(10 * 1024 * 1024);
}

SliderBuffer.prototype.add = function(data, fromOpt, sizeOpt){
  var multiplierBuffer = 2;
  var newBuffer;
  var destLen;
  var newLen;
  const from = typeof fromOpt === 'undefined' ? 0 : fromOpt;
  const size = typeof sizeOpt === 'undefined' ? data.length : sizeOpt;
  if (this.bufferOffset + this.bufferLength + size < this.buffer.length)
  {
    data.copy(this.buffer, this.bufferOffset + this.bufferLength, from, from+size);
    this.bufferLength+=size;
  } else {
    destLen = size + this.bufferLength;
    newLen = this.buffer.length;
    while(newLen < destLen * multiplierBuffer)
      newLen *= multiplierBuffer;
    newBuffer = utils.createBuffer(newLen);
    this.buffer.copy(newBuffer, 0, this.bufferOffset, this.bufferOffset+this.bufferLength);
    data.copy(newBuffer, this.bufferLength, from, from+size);
    this.buffer = newBuffer;
    this.bufferOffset = 0;
    this.bufferLength = destLen;
  }
};

module.exports = SliderBuffer;