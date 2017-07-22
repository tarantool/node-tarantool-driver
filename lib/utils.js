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

exports._responseBufferTrack = function(buffer, length){

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
					var newBuffer = utils.createBuffer(futureLen);
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
				var newBuffer = utils.createBuffer(futureLen);
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
