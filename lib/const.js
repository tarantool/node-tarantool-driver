const MsgPack = require('./MsgPack');
const StandaloneConnector = require('./StandaloneConnector');

module.exports.RequestCode = {
    rqSelect: 0x01,
    rqInsert: 0x02,
    rqReplace: 0x03,
    rqUpdate: 0x04,
    rqDelete: 0x05,
    rqCall: 0x06,
    rqAuth: 0x07,
    rqEval: 0x08,
    rqUpsert: 0x09,
    rqRollback: 0x10,
    rqCallNew: 0x0a,
    rqExecute: 0x0b,
    rqPrepare: 0x0d,
    rqBegin: 0x0e,
    rqCommit: 0x0f,
    rqPing: 0x40,
    rqId: 0x49
};

module.exports.KeysCode = {
    code: 0x00,
    sync: 0x01,
    schema_version: 0x05,
    space_id: 0x10,
    index_id: 0x11,
    limit: 0x12,
    offset: 0x13,
    iterator: 0x14,
    key: 0x20,
    tuple: 0x21,
    function_name: 0x22,
    username: 0x23,
    expression: 0x27,
    def_tuple: 0x28,
    data: 0x30,
    iproto_error_24: 0x31,
    metadata: 0x32,
    bind_metadata: 0x33,
    sql_text: 0x40,
    sql_bind: 0x41,
    sql_info: 0x42,
    stmt_id: 0x43,
    iproto_error: 0x52,
    iproto_version: 0x54,
    iproto_features: 0x55,
    iproto_timeout: 0x56,
    iproto_txn_isolation: 0x59,
    iproto_stream_id: 0x0a,
    iproto_auth_type: 0x5b
};

module.exports.Iterators = {
    EQ: 'eq',
    REQ: 'req',
    ALL: 'all',
    LT: 'lt',
    LE: 'le',
    GE: 'ge',
    GT: 'gt',
    BITS_ALL_SET: 'bitsAllSet',
    BITS_ANY_SET: 'bitsAnySet',
    BITS_ALL_NOT_SET: 'bitsAllNotSet',
    OVERLAPS: 'overlaps',
    NEIGHBOR: 'neighbor'
};

// https://www.tarantool.io/ru/doc/latest/reference/internals/iproto/keys/#iproto-iterator
module.exports.IteratorsType = {
    eq: 0,
    req: 1,
    all: 2,
    lt: 3,
    le: 4,
    ge: 5,
    gt: 6,
    bitsAllSet: 7,
    bitsAnySet: 8,
    bitsAllNotSet: 9,
    overlaps: 10,
    neighbor: 11
};

module.exports.Space = {
    schema: 272,
    space: 281,
    index: 289,
    func: 296,
    user: 304,
    priv: 312,
    cluster: 320
};

module.exports.IndexSpace = {
    id: 0,
    name: 2,
    format: 6
};

module.exports.states = {
    CONNECTING: 0,
    // CONNECTED: 1,
    // AWAITING: 2,
    INITED: 4,
    // PREHELLO: 8,
    // AWAITING_LENGTH: 16,
    END: 32,
    RECONNECTING: 64,
    AUTH: 128,
    CONNECT: 256
};

module.exports.revertStates = Object.fromEntries(
    Object.entries(module.exports.states).map((arr) => [
        arr[1],
        arr[0].toLowerCase()
    ])
);

module.exports.passEnter = Buffer.from('a9636861702d73686131', 'hex'); /* from msgpack.encode('chap-sha1') */

module.exports.defaultOptions = {
    host: 'localhost',
    port: 3301,
    path: null, // UNIX-path
    username: null,
    password: null,
    reserveHosts: [], // array of strings(e.g. UNIX-path or connection string)/objects/numbers(ports)
    beforeReserve: 2, // Number of attempts to reconnect before connecting to next host from the 'reserveHosts'
    timeout: 10000, // do never set this to near-zero values to prevent unexpected behavior of connect/disconnect methods
    noDelay: true, // 'net' module option
    commandTimeout: null, // how many milliseconds to wait for command execution before throwing an error to callback/promise. Recommended values are 500+
    keepAlive: true, // 'net' module option
    tupleToObject: false, // convert array-of-arrays (default) response to array-of-objects
    enableOfflineQueue: true,
    retryStrategy: function (times) {
        return Math.min(times * 50, 2000);
    },
    lazyConnect: false, // set to true if you wish to connect later manually
    enableAutoPipelining: false, // set to true if you want to increase performance (200%+) with a trade-off in the form of a bit increased query execution time.
    sliderBufferInitialSize: Buffer.poolSize * 10, // increase for better performance on high-load, decrease on weak systems
    prefetchSchema: true, // load space schema on connect
    connectRetryAttempts: 10, // how many attempts to make trying to connect (including reserve hosts) before throwing error on '.connect()' promise
    MsgPack, // Custom MsgPack class can be provided as option
    Connector: StandaloneConnector // Custom Connector class can be provided as option
};

module.exports.nullishOpts = Object.fromEntries(
    Object.entries(module.exports.defaultOptions).map((arr) => [
        arr[0],
        undefined
    ])
);

module.exports.symbols = {
    streamId: Symbol('streamId'),
    bypassOfflineQueue: Symbol('bypassOfflineQueue'),
    pipelined: Symbol('pipelined'),
    begin: Symbol('begin'),
    rollback: Symbol('rollback'),
    commit: Symbol('commit')
};
