var { createCodec: msgpackCreateCodec} = require('msgpack-lite');
var { createBuffer } = require('tarantool-driver-custom/lib/utils');
var { TarantoolError } = require('tarantool-driver-custom/lib/utils');
var {
  parse: uuidParse,
  stringify: uuidStringify,
  validate: uuidValidate
} = require('uuid');

var packAs = {}
var codec = msgpackCreateCodec();

// UUID extension
packAs.uuid = function TarantoolUuidExt (value) {
  if (!uuidValidate(value)) {
    throw new TarantoolError('Passed value is not UUID')
  }

  if (!(this instanceof TarantoolUuidExt)) {
    return new TarantoolUuidExt(value)
  }

  this.value = value
}

codec.addExtPacker(0x02, packAs.uuid, (data) => {
	return uuidParse(data.value);
});

codec.addExtUnpacker(0x02, (buffer) => {
  return uuidStringify(buffer)
});

// Decimal extension
function isFloat(n){
  return Number(n) === n && n % 1 !== 0;
}

packAs.decimal = function TarantoolDecimalExt (value) {
  if (!(Number.isInteger(value) || isFloat(value))) {
    throw new TarantoolError('Passed value cannot be packed as decimal: expected Integer or Floating number')
  }

  if (!(this instanceof TarantoolDecimalExt)) {
    return new TarantoolDecimalExt(value)
  }

  this.value = value
}

function isOdd (number) {
  return number % 2 !== 0;
}

codec.addExtPacker(0x01, packAs.decimal, (data) => {
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