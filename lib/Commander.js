const { createHash } = require('crypto');
const {
    KeysCode,
    RequestCode,
    IteratorsType,
    Iterators,
    passEnter,
    symbols: {
        streamId: streamIdSym,
        bypassOfflineQueue: bypassOfflineQueueSym,
        begin: beginSym,
        commit: commitSym,
        rollback: rollbackSym
    }
} = require('./const');
const { TarantoolError } = require('./errors');
const { deprecate } = require('node:util');
const PreparedStatement = require('./PreparedStatement');
const SliderBuffer = require('./utils/SliderBuffer');

const bufferCache = new Map();
const maxSmi = 2147483647; // max 32-bit integer

const schemaFetchOptions = {
    tupleToObject: false,
    autoPipeline: false,
    [bypassOfflineQueueSym]: true
};

/**
 * Helper function to handle parameter validation with callback
 * @private
 * @param {*} parameter - The parameter to check (typically a spaceId or indexId)
 * @param {Function} [cb] - Callback function
 * @returns {*|false|Promise} Returns the parameter value, false if error was handled via callback, or rejects promise with the error
 */
const checkParameterError = (parameter, cb) => {
    if (parameter instanceof TarantoolError) {
        if (cb) {
            cb(parameter, null);
            return false; // Signal that error was handled and function should stop execution
        } else {
            return Promise.reject(parameter);
        }
    }
    return parameter;
};

let shouldSetImmediate = true;
/**
 * Clears the msgpack buffer cache after the current event loop iteration
 * to free up memory and prevent a possible OOM error
 * @private
 */
const clearCacheAfterEventLoop = () => {
    if (shouldSetImmediate) {
        shouldSetImmediate = false;
        setImmediate(() => {
            bufferCache.clear();
            shouldSetImmediate = true;
        });
    }
};

const ERR_SCHEMA_NOT_FETCHED = new TarantoolError(
    'Space schema was not fetched, so you cannot specify space or index by their corresponding name. Call \'fetchSchema()\' or set \'prefetchSchema\' option to \'true\''
);

module.exports = class Commander {
    schemaFetched = false;
    namespace = {};
    _id = [1];

    /**
     * Creates an instance of Commander
     * @param {Object} opts - Configuration options
     */
    constructor(opts) {
        this.options = opts || {};
        this.bufferPool = new SliderBuffer(this.options.sliderBufferInitialSize || Buffer.poolSize);
    }

    /**
     * Creates a buffer from the buffer pool
     * @private
     * @param {number} size - Size of the buffer to create
     * @returns {Buffer} A buffer of specified size
     */
    _createBuffer(size) {
        return this.bufferPool.getBuffer(size);
    }

    /**
     * Gets a cached msgpack buffer for a given value
     * @private
     * @param {*} value - Value to encode
     * @returns {Buffer} Encoded msgpack buffer
     */
    getCachedMsgpackBuffer(value) {
        const search = bufferCache.get(value);
        if (search) {
            return search;
        } else {
            const encoded = this.msgpacker.encode(value);
            bufferCache.set(value, encoded);
            clearCacheAfterEventLoop();
            return encoded;
        }
    }

    /**
     * @public
     * Fetches the database schema (spaces and indexes)
     * @returns {Promise<Object>} Namespace with spaces and indexes information
     */
    fetchSchema() {
        return this.fetchSpaces()
            .then(() => this.fetchIndexes())
            .then(() => {
                this.schemaFetched = true;
                return this.namespace;
            });
    }

    /**
     * Fetches spaces from the database
     * @private
     * @returns {Promise<Object>} Namespace with space information
     */
    fetchSpaces() {
        return this.pendingPromises.fetchSpaces ||= this.select(281, 0, 99999, 0, 'all', [], schemaFetchOptions)
            .then((result) => {
                result.map((arr) => {
                    const id = arr[0];
                    const name = arr[2];
                    const format = arr[6];
                    const tupleFields = {};
                    let n = 0;
                    format.map((obj) => {
                        tupleFields[n] = tupleFields[obj.name] = {
                            type: obj.type,
                            name: obj.name,
                            id: n
                        };
                        n++;
                    });

                    this.namespace[name] = this.namespace[id] = {
                        id,
                        name,
                        engine: arr[3],
                        tupleKeys: format.map((obj) => obj.name),
                        indexes: {},
                        fields: tupleFields
                    };
                });

                return this.namespace;
            })
            .finally(() => {
                this.pendingPromises.fetchSpaces = null;
            });
    }

    /**
     * Fetches indexes from the database
     * @private
     * @returns {Promise<Object>} Namespace with index information
     */
    fetchIndexes() {
        return this.pendingPromises.fetchIndexes ||= this.select(289, 0, 99999, 0, 'all', [], schemaFetchOptions)
            .then((result) => {
                result.map((arr) => {
                    const spaceId = arr[0];
                    const indexId = arr[1];
                    const name = arr[2];
                    this.namespace[spaceId].indexes[indexId] = name;
                    this.namespace[spaceId].indexes[name] = indexId;
                });

                this.pendingPromises.fetchIndexes = null;

                return this.namespace;
            })
            .finally(() => {
                this.pendingPromises.fetchIndexes = null;
            });
    }

    /**
     * Gets the space ID from the namespace by name
     * @private
     * @param {string|number} name - Space name or ID
     * @returns {number|TarantoolError} Space ID or error object if space is not found
     */
    _getSpaceId(name) {
        if (this.offlineQueue.enabled) {return name;} // bypass temporary
        if (!this.schemaFetched) {return ERR_SCHEMA_NOT_FETCHED;}
        if (!this.namespace?.[name]) {return new TarantoolError(`Space "${name}" does not exist or user has no "read" permission`);}

        return this.namespace[name].id;
    }

    /**
     * Gets the index ID from the namespace by space and index name
     * @private
     * @param {number} space - Space ID
     * @param {string|number} index - Index name or ID
     * @returns {number|TarantoolError} Index ID or error object if index is not found
     */
    _getIndexId(space, index) {
        if (this.offlineQueue.enabled) {return index;} // bypass temporary
        if (!this.schemaFetched) {return ERR_SCHEMA_NOT_FETCHED;}
        if (!(index in this.namespace[space].indexes)) {
            return new TarantoolError(
                `Index "${index}" does not exist in space with id №${space} or user does not have "read" permission`
            );
        }

        return this.namespace[space].indexes[index];
    }

    /**
     * Gets the next request ID
     * @private
     * @returns {number} Request ID
     */
    _getRequestId() {
        const _id = this._id;
        if (_id[0] > maxSmi) {_id[0] = 0;}
        return _id[0]++;
    }

    /**
     * Performs a SELECT query on the database
     * @public
     * @param {number|string} spaceId - Space ID or name
     * @param {number|string} indexId - Index ID or name
     * @param {number} limit - Maximum number of records to return
     * @param {number} [offset=0] - Number of records to skip
     * @param {string} [iterator='eq'] - Iterator type
     * @param {Array} [key] - Search key
     * @param {Object} [opts={}] - Options
     * @param {Function} [cb] - Callback function (error, result). Receives two arguments: error (or null) and result (or null)
     * @returns {Promise<Array>|undefined} Selected records wrapped in a Promise if no callback provided. Returns undefined when callback is provided
     */
    select(
        spaceId,
        indexId,
        limit,
        offset,
        iterator,
        key,
        opts,
        cb
    ) {
        limit ||= 1; // consider there will be no practical usage to select zero records, so setting the default to 1 in order to prevent developer's mistakes :)
        offset ||= 0; // consider using 'logical OR assignment' instead of default function parameters (https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Functions/Default_parameters) because the last one replaces value only if it set to 'undefined' (despite the fact that there can also be passed falsy values like '0', 'null', 'false')
        iterator ||= Iterators.EQ;
        opts ||= {};
        if (typeof spaceId == 'string') {spaceId = this._getSpaceId(spaceId);}
        // Check for errors using helper function to avoid code duplication
        spaceId = checkParameterError(spaceId, cb);
        if (spaceId === false || spaceId instanceof Promise) {return spaceId;} // false = error handled via callback, Promise = Promise.reject()
        if (typeof indexId == 'string') {indexId = this._getIndexId(spaceId, indexId);}
        indexId = checkParameterError(indexId, cb);
        if (indexId === false || indexId instanceof Promise) {return indexId;}

        if (iterator == Iterators.ALL) {key = [];}
        if (!Array.isArray(key)) {key = [key];}

        const bufKey = this.msgpacker.encode(key);
        const len = 37 + bufKey.length;
        const buffer = this._createBuffer(len + 5, opts);

        const reqId = this._getRequestId();

        buffer[0] = 0xce;
        buffer.writeUInt32BE(len, 1);
        buffer[5] = 0x83;
        buffer[6] = KeysCode.code;
        buffer[7] = RequestCode.rqSelect;
        buffer[8] = KeysCode.sync;
        buffer[9] = 0xce;
        buffer.writeUInt32BE(reqId, 10);
        buffer[14] = KeysCode.iproto_stream_id;
        buffer[15] = 0xce;
        buffer.writeUInt32BE(opts[streamIdSym] || 0, 16);
        buffer[20] = 0x86;
        buffer[21] = KeysCode.space_id;
        buffer[22] = 0xcd;
        buffer.writeUInt16BE(spaceId, 23);
        buffer[25] = KeysCode.index_id;
        buffer.writeUInt8(indexId, 26);
        buffer[27] = KeysCode.limit;
        buffer[28] = 0xce;
        buffer.writeUInt32BE(limit, 29);
        buffer[33] = KeysCode.offset;
        buffer[34] = 0xce;
        buffer.writeUInt32BE(offset, 35);
        buffer[39] = KeysCode.iterator;
        buffer.writeUInt8(IteratorsType[iterator], 40);
        buffer[41] = KeysCode.key;
        bufKey.copy(buffer, 42);

        return this.sendCommand(
            RequestCode.rqSelect,
            reqId,
            buffer,
            cb,
            arguments
        );
    }

    /**
     * Performs a SELECT query with callback style
     * @public
     * @deprecated Use select() with callback parameter instead
     * @param {number|string} spaceId - Space ID or name
     * @param {number|string} indexId - Index ID or name
     * @param {number} limit - Maximum number of records to return
     * @param {number} [offset=0] - Number of records to skip
     * @param {string} [iterator='eq'] - Iterator type
     * @param {Array} [key] - Search key
     * @param {Function} successCb - Success callback
     * @param {Function} errorCb - Error callback
     * @param {Object} [opts={}] - Options
     * @returns {undefined}
     */
    selectCb(
        spaceId,
        indexId,
        limit,
        offset,
        iterator,
        key,
        successCb,
        errorCb,
        opts
    ) {
        offset ||= 0;
        iterator ||= Iterators.EQ;
        opts ||= {};
        return this.select(
            spaceId,
            indexId,
            limit,
            offset,
            iterator,
            key,
            opts,
            (error, success) => {
                if (error) {return errorCb(error);}

                return successCb(success);
            }
        );
    }

    /**
     * Sends a PING command to the server
     * @public
     * @param {Object} [opts={}] - Options
     * @param {Function} [cb] - Callback function (error, result). Receives two arguments: error (or null) and result (or null)
     * @returns {Promise<Boolean>|undefined} Server response wrapped in a Promise if no callback provided. Returns undefined when callback is provided
     */
    ping(opts, cb) {
        opts ||= {};
        const reqId = this._getRequestId();
        const len = 9;
        const buffer = this._createBuffer(len + 5, opts);

        buffer[0] = 0xce;
        buffer.writeUInt32BE(len, 1);
        buffer[5] = 0x82;
        buffer[6] = KeysCode.code;
        buffer[7] = RequestCode.rqPing;
        buffer[8] = KeysCode.sync;
        buffer[9] = 0xce;
        buffer.writeUInt32BE(reqId, 10);

        return this.sendCommand(
            RequestCode.rqPing,
            reqId,
            buffer,
            cb,
            arguments
        );
    }

    /**
     * Begins a transaction
     * @public
     * @param {number} [transTimeoutSec=60] - Transaction timeout in seconds
     * @param {number} [isolationLevel=0] - Transaction isolation level
     * @param {Object} [opts={}] - Options
     * @param {Function} [cb] - Callback function
     * @returns {Promise}
     */
    [beginSym](transTimeoutSec, isolationLevel, opts, cb) {
        transTimeoutSec ||= 60;
        isolationLevel ||= 0;
        opts ||= {};

        const reqId = this._getRequestId();
        // transTimeoutSec should be decimal number in order to be properly encoded by msgpacker
        if (Number.isInteger(transTimeoutSec)) {transTimeoutSec += 0.1;}
        const transTimeoutBuf = this.msgpacker.encode(transTimeoutSec);

        const len = 19 + transTimeoutBuf.length;
        const buffer = this._createBuffer(5 + len, opts);

        buffer[0] = 0xce;
        buffer.writeUInt32BE(len, 1);
        buffer[5] = 0x83;
        buffer[6] = KeysCode.code;
        buffer[7] = RequestCode.rqBegin;
        buffer[8] = KeysCode.sync;
        buffer[9] = 0xce;
        buffer.writeUInt32BE(reqId, 10);
        buffer[14] = KeysCode.iproto_stream_id;
        buffer[15] = 0xce;
        buffer.writeUInt32BE(opts[streamIdSym] || 0, 16);
        buffer[20] = 0x82;
        buffer[21] = KeysCode.iproto_txn_isolation;
        buffer.writeUInt8(isolationLevel, 22);
        buffer[23] = KeysCode.iproto_timeout;
        transTimeoutBuf.copy(buffer, 24);

        return this.sendCommand(
            RequestCode.rqBegin,
            reqId,
            buffer,
            cb,
            arguments
        );
    }

    /**
     * Commits a transaction
     * @public
     * @param {Object} [opts={}] - Options
     * @param {Function} [cb] - Callback function
     * @returns {Promise}
     */
    [commitSym](opts, cb) {
        opts ||= {};
        const reqId = this._getRequestId();

        const len = 15;
        const buffer = this._createBuffer(5 + len, opts);

        buffer[0] = 0xce;
        buffer.writeUInt32BE(len, 1);
        buffer[5] = 0x83;
        buffer[6] = KeysCode.code;
        buffer[7] = RequestCode.rqCommit;
        buffer[8] = KeysCode.sync;
        buffer[9] = 0xce;
        buffer.writeUInt32BE(reqId, 10);
        buffer[14] = KeysCode.iproto_stream_id;
        buffer[15] = 0xce;
        buffer.writeUInt32BE(opts[streamIdSym] || 0, 16);

        return this.sendCommand(
            RequestCode.rqCommit,
            reqId,
            buffer,
            cb,
            arguments
        );
    }

    /**
     * Rolls back a transaction
     * @public
     * @param {Object} [opts={}] - Options
     * @param {Function} [cb] - Callback function
     * @returns {Promise}
     */
    [rollbackSym](opts, cb) {
        opts ||= {};
        const reqId = this._getRequestId();

        const len = 15;
        const buffer = this._createBuffer(5 + len, opts);

        buffer[0] = 0xce;
        buffer.writeUInt32BE(len, 1);
        buffer[5] = 0x83;
        buffer[6] = KeysCode.code;
        buffer[7] = RequestCode.rqRollback;
        buffer[8] = KeysCode.sync;
        buffer[9] = 0xce;
        buffer.writeUInt32BE(reqId, 10);
        buffer[14] = KeysCode.iproto_stream_id;
        buffer[15] = 0xce;
        buffer.writeUInt32BE(opts[streamIdSym], 16);

        return this.sendCommand(
            RequestCode.rqRollback,
            reqId,
            buffer,
            cb,
            arguments
        );
    }

    /**
     * Deletes a tuple from the database
     * @public
     * @param {number|string} spaceId - Space ID or name
     * @param {number|string} indexId - Index ID or name
     * @param {Array} key - Delete key
     * @param {Object} [opts={}] - Options
     * @param {Function} [cb] - Callback function (error, result). Receives two arguments: error (or null) and deleted tuple (or null)
     * @returns {Promise<Array>|undefined} Deleted tuple wrapped in a Promise if no callback provided. Returns undefined when callback is provided
     */
    delete(spaceId, indexId, key, opts, cb) {
        opts ||= {};
        if (typeof spaceId == 'string') {spaceId = this._getSpaceId(spaceId);}
        spaceId = checkParameterError(spaceId, cb);
        if (spaceId === false || spaceId instanceof Promise) {return spaceId;}

        if (typeof indexId == 'string') {indexId = this._getIndexId(spaceId, indexId);}
        indexId = checkParameterError(indexId, cb);
        if (indexId === false || indexId instanceof Promise) {return indexId;}

        const reqId = this._getRequestId();
        const bufKey = this.msgpacker.encode(key);

        const len = 23 + bufKey.length;
        const buffer = this._createBuffer(5 + len, opts);

        buffer[0] = 0xce;
        buffer.writeUInt32BE(len, 1);
        buffer[5] = 0x83;
        buffer[6] = KeysCode.code;
        buffer[7] = RequestCode.rqDelete;
        buffer[8] = KeysCode.sync;
        buffer[9] = 0xce;
        buffer.writeUInt32BE(reqId, 10);
        buffer[14] = KeysCode.iproto_stream_id;
        buffer[15] = 0xce;
        buffer.writeUInt32BE(opts[streamIdSym] || 0, 16);
        buffer[20] = 0x83;
        buffer.writeUInt8(KeysCode.space_id, 21);
        buffer[22] = 0xcd;
        buffer.writeUInt16BE(spaceId, 23);
        buffer[25] = KeysCode.index_id;
        buffer.writeUInt8(indexId, 26);
        buffer[27] = KeysCode.key;
        bufKey.copy(buffer, 28);

        return this.sendCommand(
            RequestCode.rqDelete,
            reqId,
            buffer,
            cb,
            arguments
        );
    }

    /**
     * Formats operations array by converting field names to their corresponding IDs
     * Makes msgpack buffers even more compact
     * @private
     * @param {Array} arr - Operations array
     * @param {number} spaceId - Space ID
     * @returns {Array} Formatted operations array
     */
    #formatOpsArr = (arr, spaceId) => {
        return arr.map((value) => {
            const name = value[1];
            const id = this.namespace[spaceId].fields[name]?.id;
            if (typeof name === 'string' && id) {
                value[1] = id;
            }

            return value;
        });
    };

    /**
     * Updates tuple in the database
     * @public
     * @param {number|string} spaceId - Space ID or name
     * @param {number|string} indexId - Index ID or name
     * @param {Array} key - Index value
     * @param {Array} ops - Update operations
     * @param {Object} [opts={}] - Options
     * @param {Function} [cb] - Callback function (error, result). Receives two arguments: error (or null) and updated tuple (or null)
     * @returns {Promise<Array>|undefined} Updated tuple wrapped in a Promise if no callback provided. Returns undefined when callback is provided
     */
    update(spaceId, indexId, key, ops, opts, cb) {
        opts ||= {};
        if (typeof spaceId == 'string') {spaceId = this._getSpaceId(spaceId);}
        spaceId = checkParameterError(spaceId, cb);
        if (spaceId === false || spaceId instanceof Promise) {return spaceId;}

        if (typeof indexId == 'string') {indexId = this._getIndexId(spaceId, indexId);}
        indexId = checkParameterError(indexId, cb);
        if (indexId === false || indexId instanceof Promise) {return indexId;}

        const reqId = this._getRequestId();
        const bufKey = this.msgpacker.encode(key);
        ops = this.#formatOpsArr(ops, spaceId);
        const bufOps = this.msgpacker.encode(ops);

        const len = 24 + bufKey.length + bufOps.length;
        const buffer = this._createBuffer(len + 5, opts);

        buffer[0] = 0xce;
        buffer.writeUInt32BE(len, 1);
        buffer[5] = 0x83;
        buffer[6] = KeysCode.code;
        buffer[7] = RequestCode.rqUpdate;
        buffer[8] = KeysCode.sync;
        buffer[9] = 0xce;
        buffer.writeUInt32BE(reqId, 10);
        buffer[14] = KeysCode.iproto_stream_id;
        buffer[15] = 0xce;
        buffer.writeUInt32BE(opts[streamIdSym] || 0, 16);
        buffer[20] = 0x84;
        buffer.writeUInt8(KeysCode.space_id, 21);
        buffer[22] = 0xcd;
        buffer.writeUInt16BE(spaceId, 23);
        buffer[25] = KeysCode.index_id;
        buffer.writeUInt8(indexId, 26);
        buffer[27] = KeysCode.key;
        bufKey.copy(buffer, 28);
        buffer[28 + bufKey.length] = KeysCode.tuple;
        bufOps.copy(buffer, 29 + bufKey.length);

        return this.sendCommand(
            RequestCode.rqUpdate,
            reqId,
            buffer,
            cb,
            arguments
        );
    }

    /**
     * Performs an upsert operation (update or insert)
     * @public
     * @param {number|string} spaceId - Space ID or name
     * @param {Array} ops - Update operations
     * @param {Array} tuple - Tuple to insert if update fails
     * @param {Object} [opts={}] - Options
     * @param {Function} [cb] - Callback function (error, result). Receives two arguments: error (or null) and result tuple (or null)
     * @returns {Promise<Array>|undefined} Result tuple wrapped in a Promise if no callback provided. Returns undefined when callback is provided
     */
    upsert(spaceId, ops, tuple, opts, cb) {
        opts ||= {};
        if (typeof spaceId == 'string') {spaceId = this._getSpaceId(spaceId);}
        spaceId = checkParameterError(spaceId, cb);
        if (spaceId === false || spaceId instanceof Promise) {return spaceId;}

        const reqId = this._getRequestId();
        const bufTuple = this.msgpacker.encode(tuple);
        ops = this.#formatOpsArr(ops, spaceId);
        const bufOps = this.msgpacker.encode(ops);

        const len = 22 + bufTuple.length + bufOps.length;
        const buffer = this._createBuffer(len + 5, opts);

        buffer[0] = 0xce;
        buffer.writeUInt32BE(len, 1);
        buffer[5] = 0x83;
        buffer[6] = KeysCode.code;
        buffer[7] = RequestCode.rqUpsert;
        buffer[8] = KeysCode.sync;
        buffer[9] = 0xce;
        buffer.writeUInt32BE(reqId, 10);
        buffer[14] = KeysCode.iproto_stream_id;
        buffer[15] = 0xce;
        buffer.writeUInt32BE(opts[streamIdSym] || 0, 16);
        buffer[20] = 0x83;
        buffer.writeUInt8(KeysCode.space_id, 21);
        buffer[22] = 0xcd;
        buffer.writeUInt16BE(spaceId, 23);
        buffer[25] = KeysCode.tuple;
        bufTuple.copy(buffer, 26);
        buffer[26 + bufTuple.length] = KeysCode.def_tuple;
        bufOps.copy(buffer, 27 + bufTuple.length);

        return this.sendCommand(
            RequestCode.rqUpsert,
            reqId,
            buffer,
            cb,
            arguments
        );
    }

    /**
     * Evaluates a Lua expression on the server
     * @public
     * @param {string} expression - Lua expression to evaluate
     * @param {Array} [args=[]] - Arguments to pass to the expression
     * @param {Object} [opts={}] - Options
     * @param {Function} [cb] - Callback function (error, result). Receives two arguments: error (or null) and expression result (or null)
     * @returns {Promise<*>|undefined} Result of the expression wrapped in a Promise if no callback provided. Returns undefined when callback is provided
     */
    eval(expression, tuple, opts, cb) {
        tuple ||= [];
        opts ||= {};
        const reqId = this._getRequestId();
        const bufExp = this.getCachedMsgpackBuffer(expression);
        const bufTuple = this.msgpacker.encode(tuple);
        const len = 18 + bufExp.length + bufTuple.length;
        const buffer = this._createBuffer(len + 5, opts);

        buffer[0] = 0xce;
        buffer.writeUInt32BE(len, 1);
        buffer[5] = 0x83;
        buffer[6] = KeysCode.code;
        buffer[7] = RequestCode.rqEval;
        buffer[8] = KeysCode.sync;
        buffer[9] = 0xce;
        buffer.writeUInt32BE(reqId, 10);
        buffer[14] = KeysCode.iproto_stream_id;
        buffer[15] = 0xce;
        buffer.writeUInt32BE(opts[streamIdSym] || 0, 16);
        buffer[20] = 0x82;
        buffer.writeUInt8(KeysCode.expression, 21);
        bufExp.copy(buffer, 22);
        buffer[22 + bufExp.length] = KeysCode.tuple;
        bufTuple.copy(buffer, 23 + bufExp.length);

        return this.sendCommand(
            RequestCode.rqEval,
            reqId,
            buffer,
            cb,
            arguments
        );
    }

    /**
     * Calls a stored procedure on the server
     * @public
     * @param {string} functionName - Function name to call
     * @param {Array} [tuple=[]] - Arguments to pass to the function
     * @param {Object} [opts={}] - Options
     * @param {Function} [cb] - Callback function (error, result). Receives two arguments: error (or null) and function result (or null)
     * @returns {Promise<*>|undefined} Result of the function wrapped in a Promise if no callback provided. Returns undefined when callback is provided
     */
    call(functionName, tuple, opts, cb) {
        tuple ||= [];
        opts ||= {};
        const reqId = this._getRequestId();
        const bufName = this.getCachedMsgpackBuffer(functionName);
        const bufTuple = this.msgpacker.encode(tuple);
        const len = 18 + bufName.length + bufTuple.length;
        const buffer = this._createBuffer(len + 5, opts);

        buffer[0] = 0xce;
        buffer.writeUInt32BE(len, 1);
        buffer[5] = 0x83;
        buffer[6] = KeysCode.code;
        buffer[7] = RequestCode.rqCall;
        buffer[8] = KeysCode.sync;
        buffer[9] = 0xce;
        buffer.writeUInt32BE(reqId, 10);
        buffer[14] = KeysCode.iproto_stream_id;
        buffer[15] = 0xce;
        buffer.writeUInt32BE(opts[streamIdSym] || 0, 16);
        buffer[20] = 0x82;
        buffer.writeUInt8(KeysCode.function_name, 21);
        bufName.copy(buffer, 22);
        buffer[22 + bufName.length] = KeysCode.tuple;
        bufTuple.copy(buffer, 23 + bufName.length);

        return this.sendCommand(
            RequestCode.rqCall,
            reqId,
            buffer,
            cb,
            arguments
        );
    }

    /**
     * Executes an SQL query
     * @public
     * @param {string|PreparedStatement} query - SQL query or prepared statement
     * @param {Array} [bindParams=[]] - Bind parameters for prepared statements
     * @param {Object} [opts={}] - Options
     * @param {Function} [cb] - Callback function (error, result). Receives two arguments: error (or null) and query result (or null)
     * @returns {Promise<Array>|undefined} Query result wrapped in a Promise if no callback provided. Returns undefined when callback is provided
     */
    sql(query, bindParams, opts, cb) {
        bindParams ||= [];
        opts ||= {};
        const reqId = this._getRequestId();
        const bufParams = this.msgpacker.encode(bindParams);
        const isPreparedStatement = query instanceof PreparedStatement;
        const bufQuery = isPreparedStatement
            ? this.getCachedMsgpackBuffer(query.stmt_id)
            : this.msgpacker.encode(query); // cache only prepared queries, considering them to be frequently used

        const len = 18 + bufQuery.length + bufParams.length;
        const buffer = this._createBuffer(len + 5, opts);

        buffer[0] = 0xce;
        buffer.writeUInt32BE(len, 1);
        buffer[5] = 0x83;
        buffer[6] = KeysCode.code;
        buffer[7] = RequestCode.rqExecute;
        buffer[8] = KeysCode.sync;
        buffer[9] = 0xce;
        buffer.writeUInt32BE(reqId, 10);
        buffer[14] = KeysCode.iproto_stream_id;
        buffer[15] = 0xce;
        buffer.writeUInt32BE(opts[streamIdSym] || 0, 16);
        buffer[20] = 0x82;
        buffer.writeUInt8(
            isPreparedStatement ? KeysCode.stmt_id : KeysCode.sql_text,
            21
        );
        bufQuery.copy(buffer, 22);
        buffer[22 + bufQuery.length] = KeysCode.sql_bind;
        bufParams.copy(buffer, 23 + bufQuery.length);

        return this.sendCommand(
            RequestCode.rqExecute,
            reqId,
            buffer,
            cb,
            arguments
        );
    }

    /**
     * Prepares an SQL statement
     * @public
     * @param {string} query - SQL query to prepare
     * @param {Object} [opts={}] - Options
     * @param {Function} [cb] - Callback function (error, result). Receives two arguments: error (or null) and prepared statement (or null)
     * @returns {Promise<PreparedStatement>|undefined} Prepared statement wrapped in a Promise if no callback provided. Returns undefined when callback is provided
     */
    prepare(query, opts, cb) {
        opts ||= {};
        const reqId = this._getRequestId();
        const bufQuery = this.msgpacker.encode(query);

        const len = 13 + bufQuery.length;
        const buffer = this._createBuffer(len + 5, opts);

        buffer[0] = 0xce;
        buffer.writeUInt32BE(len, 1);
        buffer[5] = 0x82;
        buffer[6] = KeysCode.code;
        buffer[7] = RequestCode.rqPrepare;
        buffer[8] = KeysCode.sync;
        buffer[9] = 0xce;
        buffer.writeUInt32BE(reqId, 10);
        buffer[14] = 0x82;
        buffer.writeUInt8(KeysCode.sql_text, 15);
        bufQuery.copy(buffer, 16);

        return this.sendCommand(
            RequestCode.rqPrepare,
            reqId,
            buffer,
            cb,
            arguments
        );
    }

    /**
     * Sends an ID (handshake) command to negotiate protocol version and features
     * @public
     * @param {number} [version=3] - Protocol version
     * @param {Array} [features=[1]] - Supported features
     * @param {string} [auth_type='chap-sha1'] - Authentication type
     * @param {Object} [opts={}] - Options
     * @param {Function} [cb] - Callback function (error, result). Receives two arguments: error (or null) and server response (or null)
     * @returns {Promise<Object>|undefined} Server response wrapped in a Promise if no callback provided. Returns undefined when callback is provided
     */
    id(version, features, auth_type, opts, cb) {
        version ||= 3;
        features ||= [1];
        auth_type ||= 'chap-sha1';
        // eslint-disable-next-line no-useless-assignment
        opts ||= {};
        const reqId = this._getRequestId();

        const headersMap = new Map();
        headersMap.set(KeysCode.code, RequestCode.rqId);
        headersMap.set(KeysCode.sync, reqId);
        const headersBuffer = this.msgpacker.encode(headersMap);

        const bodyMap = new Map();
        bodyMap.set(KeysCode.iproto_version, version);
        bodyMap.set(KeysCode.iproto_features, features);
        bodyMap.set(KeysCode.iproto_auth_type, auth_type);
        const bodyBuffer = this.msgpacker.encode(bodyMap);

        const dataLengthBuffer = this.msgpacker.encode(
            headersBuffer.length + bodyBuffer.length
        );
        const concatenatedBuffers = Buffer.concat([
            dataLengthBuffer,
            headersBuffer,
            bodyBuffer
        ]);

        return this.sendCommand(
            RequestCode.rqId,
            reqId,
            concatenatedBuffers,
            cb,
            arguments
        );
    }

    /**
     * Inserts a tuple into the database
     * @public
     * @param {number|string} spaceId - Space ID or name
     * @param {Array} tuple - Tuple to insert
     * @param {Object} [opts={}] - Options
     * @param {Function} [cb] - Callback function (error, result). Receives two arguments: error (or null) and inserted record (or null)
     * @returns {Promise<Array>|undefined} Inserted record wrapped in a Promise if no callback provided. Returns undefined when callback is provided
     */
    insert(spaceId, tuple, opts, cb) {
        opts ||= {};
        if (typeof spaceId == 'string') {spaceId = this._getSpaceId(spaceId);}
        spaceId = checkParameterError(spaceId, cb);
        if (spaceId === false || spaceId instanceof Promise) {return spaceId;}

        const reqId = this._getRequestId();
        const bufTuple = this.msgpacker.encode(tuple);
        const len = 21 + bufTuple.length;
        const buffer = this._createBuffer(len + 5, opts);

        buffer[0] = 0xce;
        buffer.writeUInt32BE(len, 1);
        buffer[5] = 0x83;
        buffer[6] = KeysCode.code;
        buffer[7] = RequestCode.rqInsert;
        buffer[8] = KeysCode.sync;
        buffer[9] = 0xce;
        buffer.writeUInt32BE(reqId, 10);
        buffer[14] = KeysCode.iproto_stream_id;
        buffer[15] = 0xce;
        buffer.writeUInt32BE(opts[streamIdSym] || 0, 16);
        buffer[20] = 0x82;
        buffer.writeUInt8(KeysCode.space_id, 21);
        buffer[22] = 0xcd;
        buffer.writeUInt16BE(spaceId, 23);
        buffer[25] = KeysCode.tuple;
        bufTuple.copy(buffer, 26);

        return this.sendCommand(
            RequestCode.rqInsert,
            reqId,
            buffer,
            cb,
            arguments
        );
    }

    /**
     * Replaces a record in the database
     * @public
     * @param {number|string} spaceId - Space ID or name
     * @param {Array} tuple - Tuple to replace
     * @param {Object} [opts={}] - Options
     * @param {Function} [cb] - Callback function (error, result). Receives two arguments: error (or null) and replaced record (or null)
     * @returns {Promise<Array>|undefined} Replaced record wrapped in a Promise if no callback provided. Returns undefined when callback is provided
     */
    replace(spaceId, tuple, opts, cb) {
        opts ||= {};
        if (typeof spaceId == 'string') {spaceId = this._getSpaceId(spaceId);}
        spaceId = checkParameterError(spaceId, cb);
        if (spaceId === false || spaceId instanceof Promise) {return spaceId;}

        const reqId = this._getRequestId();
        const bufTuple = this.msgpacker.encode(tuple);
        const len = 21 + bufTuple.length;
        const buffer = this._createBuffer(len + 5, opts);

        buffer[0] = 0xce;
        buffer.writeUInt32BE(len, 1);
        buffer[5] = 0x83;
        buffer[6] = KeysCode.code;
        buffer[7] = RequestCode.rqReplace;
        buffer[8] = KeysCode.sync;
        buffer[9] = 0xce;
        buffer.writeUInt32BE(reqId, 10);
        buffer[14] = KeysCode.iproto_stream_id;
        buffer[15] = 0xce;
        buffer.writeUInt32BE(opts[streamIdSym] || 0, 16);
        buffer[20] = 0x82;
        buffer.writeUInt8(KeysCode.space_id, 21);
        buffer[22] = 0xcd;
        buffer.writeUInt16BE(spaceId, 23);
        buffer[25] = KeysCode.tuple;
        bufTuple.copy(buffer, 26);

        return this.sendCommand(
            RequestCode.rqReplace,
            reqId,
            buffer,
            cb,
            arguments
        );
    }

    /**
     * Authenticates with the database server
     * @public
     * @param {string} username - Username
     * @param {string} password - Password
     * @param {Object} [opts={}] - Options
     * @param {Function} [cb] - Callback function
     * @returns {Promise<Boolean>}
     */
    _auth(username, password, opts, cb) {
        opts ||= {};
        const reqId = this._getRequestId();

        const user = this.msgpacker.encode(username);
        const scrambled = scramble(password, this.salt);
        const len = 44 + user.length;
        const buffer = this._createBuffer(len + 5, opts);

        buffer[0] = 0xce;
        buffer.writeUInt32BE(len, 1);
        buffer[5] = 0x82;
        buffer[6] = KeysCode.code;
        buffer[7] = RequestCode.rqAuth;
        buffer[8] = KeysCode.sync;
        buffer[9] = 0xce;
        buffer.writeUInt32BE(reqId, 10);
        buffer[14] = 0x82;
        buffer.writeUInt8(KeysCode.username, 15);
        user.copy(buffer, 16);
        buffer[16 + user.length] = KeysCode.tuple;
        buffer[17 + user.length] = 0x92;
        passEnter.copy(buffer, 18 + user.length);
        buffer[28 + user.length] = 0xb4;
        scrambled.copy(buffer, 29 + user.length);

        return this.sendCommand(
            RequestCode.rqAuth,
            reqId,
            buffer,
            cb,
            arguments
        );
    }
};

/**
 * Transforms password using SHA1 hash
 * @private
 * @param {string|Buffer} t - Data to hash
 * @returns {Buffer} SHA1 hash
 */
const shatransform = (t) => createHash('sha1').update(t).digest();

/**
 * XOR operation between two buffers
 * @private
 * @param {Buffer|string} a - First operand
 * @param {Buffer|string} b - Second operand
 * @returns {Buffer} Result of XOR operation
 */
const xor = (a, b) => {
    if (!Buffer.isBuffer(a)) {a = Buffer.from(a);}
    if (!Buffer.isBuffer(b)) {b = Buffer.from(b);}
    const res = [];
    let i;
    if (a.length > b.length) {
        for (i = 0; i < b.length; i++) {
            res.push(a[i] ^ b[i]);
        }
    } else {
        for (i = 0; i < a.length; i++) {
            res.push(a[i] ^ b[i]);
        }
    }
    return Buffer.from(res);
};

/**
 * Scrambles a password for authentication
 * @private
 * @param {string} password - Password to scramble
 * @param {string} salt - Salt in base64 format
 * @returns {Buffer} Scrambled password
 */
const scramble = (password, salt) => {
    const encSalt = Buffer.from(salt, 'base64');
    const step1 = shatransform(password);
    const step2 = shatransform(step1);
    const step3 = shatransform(Buffer.concat([encSalt.subarray(0, 20), step2]));
    return xor(step1, step3);
};

module.exports.prototype.selectCb = deprecate(
    module.exports.prototype.selectCb,
    `'selectCb()' method is deprecated. Use 'select(
    spaceId, 
    indexId, 
    limit, 
    offset, 
    iterator, 
    key, 
    opts, 
    (error, success) => { /* process the result as usual */ }
)' instead.`,
    'Tarantool-Driver'
);
