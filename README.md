# Node.js driver for Tarantool 1.7+ ⚡

[![Build Status](https://travis-ci.org/tarantool/node-tarantool-driver.svg)](https://travis-ci.org/tarantool/node-tarantool-driver)

High-performance Node.js driver for Tarantool 1.7+ with support for Node.js v20+.

Based on [go-tarantool](https://github.com/tarantool/go-tarantool) and implements [Tarantool's binary protocol](http://tarantool.org/doc/dev_guide/box-protocol.html). Code architecture and performance features in version 4 borrowed from [ioredis](https://github.com/luin/ioredis).

Uses [msgpackr](https://github.com/kriszyp/msgpackr) as the high-performance MsgPack encoder/decoder by default.

⚠️ **Note**: Connection failures result in connection destruction. Subscribe to `TarantoolConnection.socket.on('close')` for closure notifications or handle rejected promise errors.

## Table of Contents

- 📦 [Installation](#installation)
- ⚙️ [Configuration](#configuration)
- 📝 [Usage Example](#usage-example)
- 📚 [API Reference](#api-reference)
  - [Connection Methods](#connection-methods)
  - [Data Query Methods](#data-query-methods)
  - [Transaction Methods](#transaction-methods)
  - [Server Methods](#server-methods)
  - [Pipelining Methods](#pipelining-methods)
  - [Utility Methods](#utility-methods)
- 🔍 [Debugging](#debugging)
- 📖 [Related Documentation](#related-documentation)
  - [Performance Guide](./PERFORMANCE.md) - Optimization tips for maximum throughput 🚀
  - [Benchmarks](./BENCHMARK.md) - Performance comparisons and results 📊
  - [Changelog](./CHANGELOG.md) - Release notes and version history 📋
- 🤝 [Contributions](#contributions)

## Installation

```bash
npm install --save tarantool-driver
```

## Configuration

### Constructor

```javascript
new Tarantool([port], [host], [options])
```

Creates a Tarantool instance, extends [EventEmitter](http://nodejs.org/api/events.html#events_class_events_eventemitter).

**Connection Events:**
- `reconnecting` - Emitted when the client attempts to reconnect; first argument is retry delay in milliseconds
- `connect` - Emitted when successfully connected and authenticated (if credentials provided); first argument is an object with `host` and `port` of the Tarantool server

### Options

| Option | Type | Default | Description |
| --- | --- | --- | --- |
| `port` | `number` \| `string` \| `Object` | `3301` | Port of the Tarantool server, or a URI string (see [Tarantool configuration docs](https://tarantool.org/en/doc/reference/configuration/index.html#uri)), or options object |
| `host` | `string` \| `Object` | `"localhost"` | Host of the Tarantool server; when first argument is a URL string, this argument becomes the options object |
| `path` | `string` | `null` | Unix socket path of the Tarantool server (overrides host/port) |
| `username` | `string` | `null` | Username for authentication when connected |
| `password` | `string` | `null` | Password for authentication when connected |
| `timeout` | `number` | `10000` | Milliseconds before timeout during initial connection or `.disconnect()` call |
| `tls` | `Object` | `null` | If specified, uses TLS instead of plain TCP. Accepts any options from [tls.createSecureContext()](https://nodejs.org/api/tls.html#tlscreatesecurecontextoptions) |
| `keepAlive` | `boolean` | `true` | Enables TCP keep-alive functionality (recommended) |
| `noDelay` | `boolean` | `true` | Disables Nagle's algorithm (recommended for lower latency) |
| `lazyConnect` | `boolean` | `false` | If `true`, delays automatic connection until first command is called |
| `tupleToObject` | `boolean` | `false` | Converts response tuples from arrays to objects with field names as keys |
| `enableAutoPipelining` | `boolean` | `false` | 🚀 Auto-pipelines all commands during event loop iteration (improves throughput 2-4x with slight latency trade-off) |
| `enableOfflineQueue` | `boolean` | `true` | If `false`, rejects commands when not connected instead of queuing them |
| `commandTimeout` | `number` | `null` | Maximum execution time in milliseconds before rejecting the command (recommended: 500+) |
| `sliderBufferInitialSize` | `number` | `Buffer.poolSize * 10` | Initial size of buffer pool; increase for high-load scenarios, decrease for resource-constrained systems |
| `prefetchSchema` | `boolean` | `true` | Automatically loads space schema on connection |
| `reserveHosts` | `array` | `[]` | Array of fallback hosts for failover (as connection strings, objects, or port numbers) |
| `beforeReserve` | `number` | `2` | Number of reconnection attempts before trying next reserve host |
| `connectRetryAttempts` | `number` | `10` | Maximum connection attempts (including reserve hosts) before rejecting `.connect()` promise |
| `retryStrategy` | `function` | See below | Custom retry delay calculation function |
| `MsgPack` | `Class` | `MsgPack` | Custom MsgPack encoder/decoder implementation |
| `Connector` | `Class` | `StandaloneConnector` | Custom connection implementation |

### Retry Strategy

By default, the driver automatically reconnects when the connection is lost (except after manual `.disconnect()` or `.quit()`).

Control reconnection timing with the `retryStrategy` option:

```javascript
const tarantool = new Tarantool({
  // Default implementation
  retryStrategy: function (times) {
    return Math.min(times * 50, 2000);
  }
});
```

The function receives `times` (nth reconnection attempt) and returns milliseconds to wait before next attempt. Return a non-numeric value to stop retrying; manually call `.connect()` to resume.

*This feature is inspired by [ioredis](https://github.com/luin/ioredis)*

### Reserve Hosts Example

```javascript
const connection = new Tarantool({
    host: 'primary.example.com',
    port: 3301,
    username: 'user',
    password: 'secret',
    reserveHosts: [
        'user:pass@secondary.example.com:3301',
        '/var/run/tarantool.sock',
        '127.0.0.1:3301'
    ],
    beforeReserve: 1
});
// Attempts: primary → secondary → localhost → primary (cycle repeats)
```

## Usage Example

```javascript
const Tarantool = require('tarantool-driver');
const conn = new Tarantool('user:password@localhost:3301');

// Select data
conn.select(512, 0, 10, 0, 'eq', [50])
    .then(results => {
        console.log('Results:', results);
    })
    .catch(err => {
        console.error('Error:', err);
    });

// Simple callback style
conn.select(512, 0, 10, 0, 'eq', [50], {}, (err, results) => {
    if (err) {
        console.error('Error:', err);
    } else {
        console.log('Results:', results);
    }
});
```

## API Reference

### 🔗 Connection Methods

#### tarantool.connect() ⇒ `Promise<void>`

Establishes connection to the Tarantool server.

**Returns:** Promise that resolves when connected and authenticated, rejects on error.

```javascript
await conn.connect();
```

#### tarantool.disconnect() ⇒ `undefined`

Closes the connection immediately. Pending commands may be lost.

**Returns:** `undefined`

```javascript
conn.disconnect();
```

#### tarantool.quit() ⇒ `Promise<void>`

Gracefully closes the connection after all sent commands complete.

**Returns:** Promise that resolves after all pending commands finish and connection closes.

```javascript
await conn.quit();
```

#### tarantool._auth(login: `string`, password: `string`) ⇒ `Promise<void>`

**Internal method.** Authenticates with Tarantool using CHAP-SHA1 mechanism.

**Note:** Called automatically during connection if credentials are provided.

See [Tarantool authentication docs](http://tarantool.org/doc/book/box/authentication.html) for details.

---

### 📊 Data Query Methods

#### tarantool.select(spaceId, indexId, limit, offset, iterator, key, [opts], [cb]) ⇒ `Promise<Array>`

Performs a SELECT query on the database.

**Parameters:**
- `spaceId` (`number` | `string`) - Space ID or name
- `indexId` (`number` | `string`) - Index ID or name
- `limit` (`number`) - Maximum records to return
- `offset` (`number`, default: `0`) - Number of records to skip
- `iterator` (`string`, default: `'eq'`) - Iterator type: `'eq'`, `'req'`, `'all'`, `'lt'`, `'le'`, `'ge'`, `'gt'`, `'bitsAllSet'`, `'bitsAnySet'`, `'bitsAllNotSet'`, `'overlaps'`, `'neighbor'`
- `key` (`Array`) - Search key tuple
- `opts` (`Object`, optional) - Options object
- `cb` (`Function`, optional) - Callback function `(error, results)`

**Returns:** Promise resolving to array of tuples. If callback provided, returns `undefined`.

**Examples:**

```javascript
// By space/index ID
const results = await conn.select(512, 0, 10, 0, 'eq', [50]);

// By space/index name
const results = await conn.select('users', 'primary', 10, 0, 'eq', [50]);

// With callback
conn.select(512, 0, 10, 0, 'eq', [50], {}, (err, results) => {
    if (err) console.error(err);
    else console.log(results);
});

// With UUID
const results = await conn.select(
    'users', 'id', 1, 0, 'eq',
    [conn.packUuid('550e8400-e29b-41d4-a716-446655440000')]
);
```

#### tarantool.selectCb(spaceId, indexId, limit, offset, iterator, key, successCb, errorCb, [opts]) ⇒ `undefined`

**Deprecated.** Use `.select()` with callback parameter instead.

Legacy callback-style select. Parameters order differs from `.select()`.

```javascript
conn.selectCb(512, 0, 10, 0, 'eq', [50],
    (results) => console.log(results),
    (error) => console.error(error)
);
```

#### tarantool.insert(spaceId, tuple, [opts], [cb]) ⇒ `Promise<Array>`

Inserts a tuple into the database.

**Parameters:**
- `spaceId` (`number` | `string`) - Space ID or name
- `tuple` (`Array`) - Data tuple to insert
- `opts` (`Object`, optional) - Options object
- `cb` (`Function`, optional) - Callback function `(error, result)`

**Returns:** Promise resolving to the inserted tuple.

```javascript
const result = await conn.insert('users', [1, 'Alice', 'alice@example.com']);
```

#### tarantool.replace(spaceId, tuple, [opts], [cb]) ⇒ `Promise<Array>`

Replaces a tuple in the database (inserts if not exists).

**Parameters:**
- `spaceId` (`number` | `string`) - Space ID or name
- `tuple` (`Array`) - Data tuple to replace
- `opts` (`Object`, optional) - Options object
- `cb` (`Function`, optional) - Callback function `(error, result)`

**Returns:** Promise resolving to the replaced or inserted tuple.

See [Tarantool replace docs](https://tarantool.org/doc/book/box/box_space.html#lua-function.space_object.replace).

```javascript
const result = await conn.replace('users', [1, 'Alice Updated', 'alice.new@example.com']);
```

#### tarantool.update(spaceId, indexId, key, ops, [opts], [cb]) ⇒ `Promise<Array>`

Updates a tuple in the database.

**Parameters:**
- `spaceId` (`number` | `string`) - Space ID or name
- `indexId` (`number` | `string`) - Index ID or name
- `key` (`Array`) - Key tuple to identify record
- `ops` (`Array<Array>`) - Update operations: `[operator, fieldId/fieldName, value]`
- `opts` (`Object`, optional) - Options object
- `cb` (`Function`, optional) - Callback function `(error, result)`

**Returns:** Promise resolving to the updated tuple.

**Operators:** `'='`, `'+'`, `'-'`, `'&'`, `'|'`, `'^'`, `':'`, `'!'`, `'#'`, `'%'` - see [Tarantool update docs](https://tarantool.org/doc/book/box/box_space.html#lua-function.space_object.update).

```javascript
// Update field 2 to new value
const result = await conn.update('users', 'primary', [1], [['=', 2, 'New Name']]);

// Increment field by 1
const result = await conn.update('users', 'primary', [1], [['+', 'counter', 1]]);
```

#### tarantool.delete(spaceId, indexId, key, [opts], [cb]) ⇒ `Promise<Array>`

Deletes a tuple from the database.

**Parameters:**
- `spaceId` (`number` | `string`) - Space ID or name
- `indexId` (`number` | `string`) - Index ID or name
- `key` (`Array`) - Key tuple to identify record
- `opts` (`Object`, optional) - Options object
- `cb` (`Function`, optional) - Callback function `(error, result)`

**Returns:** Promise resolving to the deleted tuple.

```javascript
const deleted = await conn.delete('users', 'primary', [1]);
```

#### tarantool.upsert(spaceId, tuple, ops, [opts], [cb]) ⇒ `Promise<void>`

Updates or inserts a tuple (insert if not exists, update if exists).

**Parameters:**
- `spaceId` (`number` | `string`) - Space ID or name
- `tuple` (`Array`) - Tuple to insert if key not found
- `ops` (`Array<Array>`) - Update operations if key exists
- `opts` (`Object`, optional) - Options object
- `cb` (`Function`, optional) - Callback function `(error, result)`

**Returns:** Promise that resolves (typically with no value).

See [Tarantool upsert docs](http://tarantool.org/doc/book/box/box_space.html#lua-function.space_object.upsert).

```javascript
await conn.upsert('users', [1, 'Alice', 'alice@example.com'], [['+', 'counter', 1]]);
```

---

### 🔄 Transaction Methods

Transactions use streams to maintain isolation. Use within `connection.transaction()` context.

#### tarantool.transaction() ⇒ `Transaction`

Creates a new transaction context for executing commands.

**Returns:** Transaction object that routes commands to same stream.

```javascript
const txn = conn.transaction();
await txn.insert('users', [1, 'Alice']);
await txn.begin();
await txn.update('users', 'primary', [1], [['=', 2, 'Alice Updated']]);
await txn.commit();
```

#### transaction.begin([transTimeoutSec], [isolationLevel], [opts], [cb]) ⇒ `Promise<void>`

Starts a transaction.

**Parameters:**
- `transTimeoutSec` (`number`, default: `60`) - Transaction timeout in seconds
- `isolationLevel` (`number`, default: `0`) - Isolation level (0 = default)
- `opts` (`Object`, optional) - Options object
- `cb` (`Function`, optional) - Callback function `(error, result)`

**Returns:** Promise that resolves when transaction begins.

```javascript
const txn = conn.transaction();
await txn.begin(120, 0);

try {
    await txn.insert('users', [1, 'Alice']);
    await txn.insert('logs', ['INSERT user 1']);
    await txn.commit();
} catch (err) {
    await txn.rollback();
    throw err;
}
```

#### transaction.commit([opts], [cb]) ⇒ `Promise<void>`

Commits the transaction.

**Parameters:**
- `opts` (`Object`, optional) - Options object
- `cb` (`Function`, optional) - Callback function `(error, result)`

**Returns:** Promise that resolves when transaction commits.

#### transaction.rollback([opts], [cb]) ⇒ `Promise<void>`

Rolls back the transaction.

**Parameters:**
- `opts` (`Object`, optional) - Options object
- `cb` (`Function`, optional) - Callback function `(error, result)`

**Returns:** Promise that resolves when transaction rolls back.

---

### 🔧 Server Methods

#### tarantool.call(functionName, [args], [opts], [cb]) ⇒ `Promise<any>`

Calls a Lua function on the server.

**Parameters:**
- `functionName` (`string`) - Name of the function to call
- `args` (`Array`, optional) - Function arguments passed as array
- `opts` (`Object`, optional) - Options object
- `cb` (`Function`, optional) - Callback function `(error, result)`

**Returns:** Promise resolving to function result (typically array for multiple returns).

**Note:** Arguments must be passed as array since v4.0.0.

```javascript
// Server-side function
// box.schema.func.create('get_user', {if_not_exists = true})
// function get_user(id) return box.space.users:select{id} end

const results = await conn.call('get_user', [42]);
```

#### tarantool.eval(expression, [args], [opts], [cb]) ⇒ `Promise<any>`

Evaluates Lua code on the server.

**Parameters:**
- `expression` (`string`) - Lua code to evaluate
- `args` (`Array`, optional) - Variables passed to Lua code
- `opts` (`Object`, optional) - Options object
- `cb` (`Function`, optional) - Callback function `(error, result)`

**Returns:** Promise resolving to evaluation result.

```javascript
const userId = await conn.eval('return box.session.user()', []);

const customResult = await conn.eval(
    'return select(1, ...)',
    [1, 2, 3, 4, 5]
);
```

#### tarantool.sql(sqlQuery, [bindParams], [opts], [cb]) ⇒ `Promise<Array>`

Executes SQL query on the server (Tarantool 2.1+).

**Parameters:**
- `sqlQuery` (`string` | `PreparedStatement`) - SQL query string or prepared statement instance
- `bindParams` (`Array`, optional) - Bind parameters
- `opts` (`Object`, optional) - Options object
- `cb` (`Function`, optional) - Callback function `(error, result)`

**Returns:** Promise resolving to query results.

⚠️ **Note:** For spaces with lowercase names, use double quotes: `"space_name"`

See [Tarantool SQL tutorial](https://www.tarantool.io/en/doc/2.1/tutorials/sql_tutorial/).

```javascript
await conn.sql('INSERT INTO tags VALUES (?, ?)', ['tag_1', 1]);
const prepStmt = await conn.prepare('INSERT INTO tags VALUES (?, ?)');
await conn.sql(prepStmt, ['tag_2', 50]);

const results = await conn.sql('SELECT * FROM "tags"');
```

#### tarantool.prepare(sqlQuery, [opts], [cb]) ⇒ `Promise<PreparedStatement>`

Prepares an SQL statement for repeated execution.

**Parameters:**
- `sqlQuery` (`string`) - SQL query string
- `opts` (`Object`, optional) - Options object
- `cb` (`Function`, optional) - Callback function `(error, result)`

**Returns:** Promise resolving to PreparedStatement object which can be passed later as `.sql(prepStmtObj, ...)` parameter.

```javascript
const stmt = await conn.prepare('SELECT * FROM users WHERE id = ?');
const results = await conn.sql(stmt, [1]);
```

#### tarantool.ping([opts], [cb]) ⇒ `Promise<boolean>`

Sends a PING command to the server.

**Parameters:**
- `opts` (`Object`, optional) - Options object
- `cb` (`Function`, optional) - Callback function `(error, result)`

**Returns:** Promise resolving to `true` if server responds.

```javascript
const isAlive = await conn.ping();
```

#### tarantool.id([version], [features], [auth_type], [opts], [cb]) ⇒ `Promise<Object>`

Sends an ID (handshake) command to negotiate protocol version, features, and authentication type with the server.

**Parameters:**
- `version` (`number`, default: `3`) - Protocol version to use
- `features` (`Array`, default: `[1]`) - List of supported features
- `auth_type` (`string`, default: `'chap-sha1'`) - Authentication type (e.g., `'chap-sha1'`)
- `opts` (`Object`, optional) - Options object
- `cb` (`Function`, optional) - Callback function `(error, result)`

**Returns:** Promise resolving to server identity and capabilities information.

```javascript
// Basic handshake with defaults
const serverInfo = await conn.id();

// Custom protocol negotiation
const serverInfo = await conn.id(3, [1, 2], 'chap-sha1');
```

---

### ⚡ Pipelining Methods

#### tarantool.pipeline() ⇒ `Pipeline`

Starts a pipeline for batching commands. Commands are queued in memory without sending to server immediately.

**Returns:** Pipeline object for method chaining.

**Performance:** 🚀 Improves throughput by 300%+ compared to individual requests.

```javascript
const results = await conn.pipeline()
    .insert('users', [1, 'Alice'])
    .insert('users', [2, 'Bob'], null /* opts */, (error, result) => {
        // some processing logic
        // "error" and "result" arguments are corresponding exactly to this request
    })
    .select('users', 'primary', 10, 0, 'eq', [1])
    .exec();

// Results format: [[err1, res1], [err2, res2], [err3, res3]]
```

#### pipeline.exec() ⇒ `Promise<PipelineResponse>`

Executes all queued commands in a single network call.

**Returns:** Promise resolving to `PipelineResponse` instance (extends Array) containing `[error, result]` pairs for each command.

#### pipeline.flushPipelined() ⇒ `undefined`

Clears the pipelined commands queue.

**Returns:** `undefined`

**PipelineResponse Methods:**
- `findPipelineError()` - Returns the first error found in results, or `null` if all succeeded
- `findPipelineErrors()` - Returns array of all errors found, or empty array if all succeeded

```javascript
const pipeline = conn.pipeline();
pipeline.select(512, 0, 10, 0, 'eq', [1]);
pipeline.select(512, 0, 10, 0, 'eq', [2]);
pipeline.update('metadata', 'primary', ['counter'], [['+', 'value', 1]]);

const pipelineResponse = await pipeline.exec();

// Access individual results
const [selectErr1, selectRes1] = pipelineResponse[0];
const [selectErr2, selectRes2] = pipelineResponse[1];
const [updateErr, updateRes] = pipelineResponse[2];

// Find errors easily
const firstError = pipelineResponse.findPipelineError();
if (firstError) {
    console.error('First error:', firstError);
}

const allErrors = pipelineResponse.findPipelineErrors();
if (allErrors.length > 0) {
    console.error('All errors:', allErrors);
}
```

---

### 🔧 Utility Methods

#### tarantool.packUuid(uuid: `string`) ⇒ `Buffer`

Converts UUID string to Tarantool-compatible format.

**Parameters:**
- `uuid` (`string`) - UUID string (e.g., `'550e8400-e29b-41d4-a716-446655440000'`)

**Returns:** Encoded buffer for use in queries.

**Note:** Without conversion, UUIDs are sent as plain strings.

```javascript
const uuid = conn.packUuid('550e8400-e29b-41d4-a716-446655440000');
const result = await conn.select('users', 'id', 1, 0, 'eq', [uuid]);
```

#### tarantool.packDecimal(number) ⇒ `Buffer`

Converts JavaScript number to Tarantool Decimal type.

**Parameters:**
- `number` (`number` | `bigint`) - Number to convert

**Returns:** Encoded buffer for use in queries.

**Note:** Without conversion, large numbers are sent as Double/Integer.

See [Tarantool Decimal docs](https://www.tarantool.io/ru/doc/latest/concepts/data_model/value_store/#decimal).

```javascript
const decimal = conn.packDecimal(123.456);
await conn.insert('prices', [1, 'Item', decimal]);
```

#### tarantool.packInteger(number) ⇒ `Buffer`

Safely converts numbers to Tarantool integer format (up to int64).

**Parameters:**
- `number` (`number`) - Number to convert

**Returns:** Encoded buffer for use in queries.

**Note:** Without conversion, numbers > int32 are encoded as Double.

```javascript
const bigInt = conn.packInteger(9223372036854775807); // Max int64
await conn.insert('bigdata', [1, bigInt]);
```

#### tarantool.packInterval(value) ⇒ `Buffer`

Converts value to Tarantool Interval type.

**Parameters:**
- `value` (`Object` | `number`) - Interval specification

**Returns:** Encoded buffer for use in queries.

```javascript
const interval = conn.packInterval({ years: 1, months: 2, days: 3 });
```

#### tarantool.fetchSchema() ⇒ `Promise<Object>`

Fetches and caches database schema (spaces and indexes).

**Returns:** Promise resolving to namespace object with space/index metadata.

**Use case:** Required if using space/index by name instead of ID without `prefetchSchema: true`.

```javascript
await conn.fetchSchema();
const userId = conn.namespace['users'].id;
```

---

## 🔍 Debugging

Enable debug logging by setting the `DEBUG` environment variable:

```bash
DEBUG=tarantool-driver:* node app.js
```

This displays detailed information about:
- Connection state changes
- Sent requests and received responses
- Buffer operations
- Schema fetching
- Event loop handling

---

## Related Documentation

- 📖 **[Performance Guide](./PERFORMANCE.md)** — Tips and tricks for maximum throughput 🚀
  - Buffer size tuning
  - Auto-pipelining optimization
  - Unix socket advantages
  
- 📊 **[Benchmarks](./BENCHMARK.md)** — Performance measurements and comparisons
  - Read/write throughput comparisons
  - Impact of different options
  
- 📋 **[Changelog](./CHANGELOG.md)** — Version history and breaking changes
  - New features by version
  - Migration guides

---

## 🤝 Contributions

Contributions are welcome! If you have questions or suggestions:

1. Check existing [issues](https://github.com/tarantool/node-tarantool-driver/issues)
2. Create a new issue with details
3. Submit pull requests for bug fixes or features

For urgent matters, email directly: newbiecraft@gmail.com

---

**Made with ❤️ for Tarantool community**
