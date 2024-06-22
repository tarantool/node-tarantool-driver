var { createCodec: msgpackCreateCodec} = require('msgpack-lite');
var { createBuffer } = require('./utils');
var { TarantoolError } = require('./utils');
var {
  parse: uuidParse,
  stringify: uuidStringify
} = require('uuid');
var {
  Uint64BE,
  Int64BE
} = require("int64-buffer");

var packAs = {}
var codec = msgpackCreateCodec();

// Pack big integers correctly (fix for https://github.com/tarantool/node-tarantool-driver/issues/48)
packAs.Integer = function (value) {
  if (!Number.isInteger(value)) throw new TarantoolError("Passed value doesn't seems to be an integer")

  if (value > 2147483647) return Uint64BE(value)
  if (value < -2147483648) return Int64BE(value)

  return value
}

// UUID extension
packAs.Uuid = function TarantoolUuidExt (value) {
  if (!(this instanceof TarantoolUuidExt)) {
    return new TarantoolUuidExt(value)
  }

  this.value = value
}

codec.addExtPacker(0x02, packAs.Uuid, (data) => {
	return uuidParse(data.value);
});

codec.addExtUnpacker(0x02, (buffer) => {
  return uuidStringify(buffer)
});

// Decimal extension
function isFloat(n){
  return Number(n) === n && n % 1 !== 0;
}

packAs.Decimal = function TarantoolDecimalExt (value) {
  if (!(this instanceof TarantoolDecimalExt)) {
    return new TarantoolDecimalExt(value)
  }

  if (!(Number.isInteger(value) || isFloat(value))) {
    throw new TarantoolError('Passed value cannot be packed as decimal: expected integer or floating number')
  }

  this.value = value
}

function isOdd (number) {
  return number % 2 !== 0;
}

codec.addExtPacker(0x01, packAs.Decimal, (data) => {
	var strNum = data.value.toString()
	var rawNum = strNum.replace('-', '')
	var scaleBuffer = Buffer.allocUnsafe(1)
  var rawNumSplitted1 = rawNum.split('.')[1]
	scaleBuffer.writeInt8(rawNumSplitted1 && rawNum.split('.')[1].length || 0)
	var bufHexed = scaleBuffer.toString('hex')
    + rawNum.replace('.', '') 
    + (strNum.startsWith('-') ? 'b' : 'a')

  if (isOdd(bufHexed.length)) {
    bufHexed = bufHexed.slice(0, 2) + '0' + bufHexed.slice(2)
	}

  return Buffer.from(bufHexed, 'hex')
});

codec.addExtUnpacker(0x01, (buffer) => {
    var scale = buffer.readIntBE(0, 1)
    var hex = buffer.toString('hex')

    var sign = ['b', 'd'].includes(hex.slice(-1)) ? '-' : '+'
    var slicedValue = hex.slice(2).slice(0, -1)

    if (scale > 0) {
      var nScale = scale * -1
      slicedValue = slicedValue.slice(0, nScale) + '.' + slicedValue.slice(nScale)
    }

    return parseFloat(sign + slicedValue)
});

// Datetime extension
codec.addExtPacker(0x04, Date, (date) => {
  var seconds = date.getTime() / 1000 | 0
  var nanoseconds = date.getMilliseconds() * 1000

	var buffer = createBuffer(16)
	buffer.writeBigUInt64LE(BigInt(seconds))
	buffer.writeUInt32LE(nanoseconds, 8)
	buffer.writeUInt32LE(0, 12)
  /* 
    Node.Js 'Date' doesn't provide nanoseconds, so just using milliseconds.
    tzoffset is set to UTC, and tzindex is omitted.
  */

	return buffer;
});

codec.addExtUnpacker(0x04, (buffer) => {
  var time = new Date(parseInt(buffer.readBigUInt64LE(0)) * 1000)

  if (buffer.length > 8) {
    var milliseconds = (buffer.readUInt32LE(8) / 1000 | 0)
    time.setMilliseconds(milliseconds)
  }

  return time
})

exports.packAs = packAs
exports.codec = codec