module.exports.TarantoolError = class TarantoolError extends Error {
    name = 'TarantoolError';
};

// https://www.tarantool.io/ru/doc/latest/reference/internals/msgpack_extensions/#the-error-type
// https://www.tarantool.io/en/doc/latest/reference/reference_lua/errcodes/
// For a complete list of errors, refer to the Tarantool error code header file (https://github.com/tarantool/tarantool/blob/master/src/box/errcode.h)
module.exports.ReplyError = class ReplyError extends module.exports.TarantoolError {
    name = 'ReplyError';
    type = ''; // e.g. “ClientError”, “SocketError”, etc
    file = '';
    line = 0;
    errno = 0;
    fields = null;

    constructor(msg, obj) {
        super(msg, obj);

        this.type = obj.type;
        this.file = obj.file;
        this.line = obj.line;
        this.errno = obj.errno;
        this.fields = obj.fields || {};
    }
};
