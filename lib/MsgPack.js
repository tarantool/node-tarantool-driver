const { Packr, Unpackr, UnpackrStream, addExtension } = require('msgpackr');
const { parse: uuidParse, stringify: uuidStringify } = require('uuid');

const encoder = new Packr({
    variableMapSize: true,
    useRecords: false,
    encodeUndefinedAsNil: true
});

const decoder = new Unpackr({
    mapsAsObjects: true,
    int64AsType: 'auto'
});

/**
 * Packs an integer value, ensuring it's encoded correctly
 * @public
 * @param {number} value - Integer value to pack
 * @returns {number|bigint} Packed integer
 * @throws {TypeError} If value is not an integer
 */
const packInteger = (value) => {
    if (!Number.isInteger(value)) {throw new TypeError('Passed value is not an integer');}

    if ((value >>> 0 !== value) && (value >> 0 !== value)) {return BigInt(value);}

    return value;
};

/**
 * Packs a UUID value
 * @public
 * @param {string} value - UUID string to pack
 * @returns {packUuid} Packed UUID object
 */
function packUuid(value) {
    if (!(this instanceof packUuid)) {
        return new packUuid(value);
    }

    this.value = uuidParse(value);
}

addExtension({
    Class: packUuid,
    type: 0x02,
    pack(instance) {
        return instance.value;
    },
    unpack(buffer) {
        return uuidStringify(buffer);
    }
});

/**
 * Checks if a number is a float
 * @private
 * @param {number} n - Number to check
 * @returns {boolean} True if number is a float
 */
const isFloat = (n) => Number(n) === n && n % 1 !== 0;

/**
 * Packs a decimal value
 * @public
 * @param {number|BigInt} value - Numeric value to pack as decimal
 * @returns {packDecimal} Packed decimal object
 * @throws {TypeError} If value cannot be packed as decimal
 */
function packDecimal(value) {
    if (!(this instanceof packDecimal)) {
        return new packDecimal(value);
    }

    if (
        !(
            Number.isInteger(value) ||
            isFloat(value) ||
            typeof value === 'bigint'
        )
    ) {
        throw new TypeError(
            'Passed value cannot be packed as decimal: expected integer, floating number or BigInt instance'
        );
    }

    let str = value.toString();

    // process values like '1e-7'
    if (str.includes('e')) {
    // 20 should be enough
    // not using dynamic value in order to lower the overhead
        str = value.toFixed(20).replace(/0+$/, '');
    }

    let scale = 0;
    if (str.includes('.')) {
        const parts = str.split('.');
        scale = parts[1].length;
        str = parts[0] + parts[1]; // remove the dot
    }

    let isNegative = false;
    if (str.startsWith('-')) {
        isNegative = true;
        str = str.substring(1);
    }

    const signNibble = isNegative ? 'd' : 'c';
    let hexString = str + signNibble;

    // check if is odd and add a nibble
    if (hexString.length % 2 !== 0) {
        hexString = '0' + hexString;
    }

    const bcdBuf = Buffer.from(hexString, 'hex');
    const scaleBuf = Buffer.from([scale]);

    this.value = Buffer.concat([scaleBuf, bcdBuf]);
}

addExtension({
    Class: packDecimal,
    type: 0x01,
    pack(instance) {
        return instance.value;
    },
    unpack(buffer) {
        const scale = buffer.readInt8(0);

        const hex = buffer.toString('hex', 1);

        const signNibble = hex[hex.length - 1].toLowerCase();
        const digits = hex.slice(0, -1);

        const isNegative = signNibble === 'd' || signNibble === 'b';

        // get number without trailing digits like 0.10000000
        let cleanDigits = digits.replace(/^0+/, '');
        // if number is equal to zero
        if (cleanDigits === '') {cleanDigits = '0';}

        if (scale === 0) {
            const bigVal = BigInt(cleanDigits);
            const signedBigVal = isNegative ? -bigVal : bigVal;

            if (
                signedBigVal <= BigInt(Number.MAX_SAFE_INTEGER) &&
                signedBigVal >= BigInt(Number.MIN_SAFE_INTEGER)
            ) {
                return Number(signedBigVal);
            }
            return signedBigVal;
        }

        // if scale is not a zero
        let resultStr;
        if (cleanDigits.length <= scale) {
            // .001
            resultStr = '0.' + cleanDigits.padStart(scale, '0');
        } else {
            const dotPos = cleanDigits.length - scale;
            resultStr =
                cleanDigits.slice(0, dotPos) + '.' + cleanDigits.slice(dotPos);
        }

        if (isNegative) {resultStr = '-' + resultStr;}

        // the result may be inaccurate if the are more than 15 digits, so return as a string?
        // JS-specific
        if (cleanDigits.length > 15) {
            return resultStr;
        }

        return Number(resultStr);
    }
});

// Datetime extension
addExtension({
    Class: Date,
    type: 0x04,
    pack(instance) {
        const seconds = (instance.getTime() / 1000) | 0;
        const nanoseconds = instance.getMilliseconds() * 1000;

        const datetimeBuffer = Buffer.allocUnsafe(16);
        datetimeBuffer.writeBigUInt64LE(BigInt(seconds));
        datetimeBuffer.writeUInt32LE(nanoseconds, 8);
        datetimeBuffer.writeUInt32LE(0, 12);
        /*
        Node.js 'Date' doesn't provide nanoseconds, so just using milliseconds.
        tzoffset is set to UTC, and tzindex is omitted.
        */

        return datetimeBuffer;
    },
    unpack(buffer) {
        const time = new Date(parseInt(buffer.readBigUInt64LE(0)) * 1000);

        if (buffer.length > 8) {
            const milliseconds = (buffer.readUInt32LE(8) / 1000) | 0;
            time.setMilliseconds(milliseconds);
        }

        return time;
    }
});

/**
 * Packs an interval value
 * @public
 * @param {Object} value - Interval object with optional fields: year, month, week, day, hour, minute, second, nanosecond, adjust
 * @returns {packInterval} Packed interval object
 * @throws {TypeError} If value is not an object
 */
function packInterval(value) {
    if (!(this instanceof packInterval)) {
        return new packInterval(value);
    }

    if (typeof value !== 'object') {throw new TypeError('Provided argument is not an object');}

    const map = new Map();
    if (value.year) {map.set(0, value.year);}
    if (value.month) {map.set(1, value.month);}
    if (value.week) {map.set(2, value.week);}
    if (value.day) {map.set(3, value.day);}
    if (value.hour) {map.set(4, value.hour);}
    if (value.minute) {map.set(5, value.minute);}
    if (value.second) {map.set(6, value.second);}
    if (value.nanosecond) {map.set(7, value.nanosecond);}
    if (value.adjust) {map.set(8, value.adjust);}

    this.value = encoder.encode(map);
    // Overwrite the byte which defines the number of fields because it has a different format
    // https://www.tarantool.io/en/doc/latest/reference/internals/msgpack_extensions/#the-interval-type
    this.value[0] = map.size;
}

addExtension({
    Class: packInterval,
    type: 0x06,
    pack(instance) {
        return instance.value;
    },
    unpack(buffer) {
        buffer.writeUint8(0x80 + buffer[0]); // to be processed as an object
        const decoded = decoder.decode(buffer);

        return {
            year: decoded[0] || 0,
            month: decoded[1] || 0,
            week: decoded[2] || 0,
            day: decoded[3] || 0,
            hour: decoded[4] || 0,
            minute: decoded[5] || 0,
            second: decoded[6] || 0,
            nanosecond: decoded[7] || 0,
            adjust: decoded[8] || 0
        };
    }
});

module.exports = class MsgPack {
    // make static methods in order to use them without creating a class
    static packInteger = packInteger;
    static packUuid = packUuid;
    static packDecimal = packDecimal;
    static packInterval = packInterval;

    packInteger = packInteger;
    packUuid = packUuid;
    packDecimal = packDecimal;
    packInterval = packInterval;

    constructor() {
        this.encode = encoder.encode;
    }

    decode(v) {
        return decoder.decode(v);
    }

    // encode(v) {
    //     return encoder.encode(v);
    // }

    useBuffer(buffer) {
        return encoder.useBuffer(buffer);
    }

    createDecoderStream() {
        return new UnpackrStream({
            mapsAsObjects: true,
            int64AsType: 'auto'
        });
    }
};
