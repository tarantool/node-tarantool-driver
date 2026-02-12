const { KeysCode, RequestCode } = require('./const');
const { TarantoolError } = require('./errors');
const { ReplyError } = require('./errors');
const debug = require('./utils/debug').extend('parser');
const PreparedStatement = require('./PreparedStatement');

exports.processResponse = function (headers, data) {
    const schemaId = headers[KeysCode.schema_version];
    const reqId = headers[KeysCode.sync];
    const code = headers[KeysCode.code];
    debug('processing response for request № %i; code: %i, data: %O; headers: %O', reqId, code, data, headers);

    this.schemaId ||= schemaId;
    if (this.schemaId != schemaId) {
        this.schemaId = schemaId;
        this.offlineQueue.set();
        this.fetchSchema().then(() => {
            this.offlineQueue.unset();
            this.offlineQueue.send();
        });
    }

    const task = this.sentCommands.get(reqId);
    if (!task) {
        return this.errorHandler(
            new TarantoolError(
                `Received request with id №${reqId}, but the corresponding callback was not found. Maybe a duplicate or protocol error?`
            )
        );
    }
    this.sentCommands.delete(reqId);
    const dfd = task[1];
    task[3]?.clear(); // timeoutId

    if (code === 0) {
        dfd(null, this._returnBool(task, data));
    } else {
        let error;
        if (data[KeysCode.iproto_error]) {
            const {
                0: type,
                1: file,
                2: line,
                3: message,
                5: errno,
                6: fields
            } = data[KeysCode.iproto_error][0][0];

            error = new ReplyError(message, {
                type,
                file,
                line,
                errno,
                fields
            });
        } else {
            error = new ReplyError(data[KeysCode.iproto_error_24]);
        }

        if (reqId) {return dfd(error, null);}

        this.errorHandler(
            new TarantoolError(
                'Unprocessed response with an unsuccessful response code',
                {
                    cause: error
                }
            )
        );
    }
};

exports._returnBool = function _returnBool(task, data) {
    const cmd = task[0];
    switch (cmd) {
        case RequestCode.rqAuth:
        case RequestCode.rqPing:
            return true;
        case RequestCode.rqExecute:
            if (data[KeysCode.metadata]) {
                const res = [];
                const meta = data[KeysCode.metadata];
                const rows = data[KeysCode.data];
                for (let i = 0; i < rows.length; i++) {
                    const formattedRow = {};
                    for (let j = 0; j < meta.length; j++) {
                        formattedRow[meta[j][0x00]] = rows[i][j];
                    }
                    res.push(formattedRow);
                }
                return res;
            } else {
                return (
                    'Affected row count: ' + (data[KeysCode.sql_info][0x0] || 0)
                );
            }
        case RequestCode.rqPrepare:
            return new PreparedStatement(data[KeysCode.stmt_id]);
        case RequestCode.rqId:
            return {
                version: data[KeysCode.iproto_version],
                features: data[KeysCode.iproto_features],
                auth_type: data[KeysCode.iproto_auth_type]
            };
        case RequestCode.rqSelect:
        case RequestCode.rqInsert:
        case RequestCode.rqReplace:
        case RequestCode.rqUpdate:
        case RequestCode.rqDelete:
            if (task[4].tupleToObject ?? this.options.tupleToObject) {
                return convertTupleToObject(
                    data[KeysCode.data],
                    this.namespace[task[2][0]].tupleKeys
                );
            }
            // eslint-disable-next-line no-fallthrough
        default:
            return data[KeysCode.data];
    }
};

function convertTupleToObject(rows, tupleKeys) {
    return rows.map(function (row) {
        return createObject(tupleKeys, row);
    });
}

function createObject(keys, values) {
    const obj = {};
    values.map((value, index) => {
        obj[keys[index]] = value;
    });

    return obj;
}
