var utils = require('./utils');

function SliderBuffer(){
  this.bufferOffset = 0;
  this.bufferLength = 0;
  this.buffer = utils.createBuffer(1024*10);
}

SliderBuffer.prototype.add = function(data, from, size){
  var multiplierBuffer = 2;
  var newBuffer;
  var destLen;
  var newLen;
  if (typeof from !== 'undefined' && typeof size !== 'undefined')
  {
    if (this.bufferOffset + this.bufferLength + size < this.buffer.length)
    {
      data.copy(this.buffer, this.bufferOffset + this.bufferLength, from, from+size);
      this.bufferLength+=size;
    }
    else
    {
      destLen = size + this.bufferLength;
      if (this.buffer.length > destLen)
      {
        newBuffer = utils.createBuffer(this.buffer.length * multiplierBuffer);
        this.buffer.copy(newBuffer, 0, this.bufferOffset, this.bufferOffset+this.bufferLength);
        data.copy(newBuffer, this.bufferLength, from, from+size);
        this.buffer = newBuffer;
      }
      else
      {
        newLen = this.buffer.length*multiplierBuffer;
        while(newLen < destLen)
          newLen *= multiplierBuffer;
        newBuffer = utils.createBuffer(newLen);
        this.buffer.copy(newBuffer, 0, this.bufferOffset, this.bufferOffset+this.bufferLength);
        data.copy(newBuffer, this.bufferLength, from, from+size);
        this.buffer = newBuffer;
      }
      this.bufferOffset = 0;
      this.bufferLength = destLen;
    }
  }
  else
  {
    if (this.bufferOffset + this.bufferLength + data.length < this.buffer.length)
    {
      data.copy(this.buffer, this.bufferOffset + this.bufferLength);
      this.bufferLength+=data.length;
    }
    else
    {
      destLen = data.length + this.bufferLength;
      if (this.buffer.length > destLen)
      {
        newBuffer = utils.createBuffer(this.buffer.length * multiplierBuffer);
        this.buffer.copy(newBuffer, 0, this.bufferOffset, this.bufferOffset+this.bufferLength);
        data.copy(newBuffer, this.bufferLength);
        this.buffer = newBuffer;
      }
      else
      {
        newLen = this.buffer.length*multiplierBuffer;
        while(newLen < destLen)
          newLen *= multiplierBuffer;
        newBuffer = utils.createBuffer(newLen);
        this.buffer.copy(newBuffer, 0, this.bufferOffset, this.bufferOffset+this.bufferLength);
        data.copy(newBuffer, this.bufferLength);
        this.buffer = newBuffer;
      }
      this.bufferOffset = 0;
      this.bufferLength = destLen;
    }
  }
};

module.exports = SliderBuffer;