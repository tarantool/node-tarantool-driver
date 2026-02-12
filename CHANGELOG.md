## 4.0.0

### <b>BREAKING</b>
- `nonWritableHostPolicy` is deprecated and no more supported due to the overhead, low-frequency usability and complexity. Finally, it may be better to handle the connection's 'close' errors by developer and reconnect.
- For a syntax clearance and new features you should pass parameters of `eval` and `call` methods as an array, e.g.:
    ```javascript 
    tarantool.eval('return ...', [a, b])
    ``` 
    instead of the previous:
    ```javascript 
    tarantool.eval('return ...', a, b)
    ```
- Dropping support for old Node.JS versions:
    now this module is guaranteed to work on a `Maintenance`, `Active` and `Current` [versions](https://nodejs.org/en/about/previous-releases#release-schedule) in order to introduce new features and stability.
- `selectCb()` method is deprecated. This (`.select()`) and all other commands now can be invoked in a callback style (but `then/catch`-style is also supported, just don't specify the `cb` parameter and the function will return a Promise):
    ```javascript
    tarantool.select(
        spaceId, 
        indexId, 
        limit, 
        offset, 
        iterator, 
        key, 
        opts, 
        (error, success) => { 
            // process the result as usual
        }
    )
    ```

### Bug fixes
- Fixed bug of a buffer reuse approach
- Fixed use of keepAlive and noDelay
- Fixed use of Transactions if connection is not inited yet
- Fixed memory leak of 'connect' / 'close' events (appeared during many reconnects)

### Improvements
- Optimized offline queue
- New option `tupleToObject`, which allows you to receive an array of objects instead of array of arrays: 
    - Keys are similar to the Tarantool space's key names, and value is a corresponding value from the tuple
    - Note that there is an extra overhead of converting array to object
    - This option is usable only for the following request types: `select`, `update`, `delete`, `insert`, `replace`
- Introduced 2 custom error classes, which are exported on the connector class. They are useful for a better development experience when you can handle errors more properly:
    - ReplyError: errors created by the Tarantool server in a similar [format](https://www.tarantool.io/ru/doc/latest/reference/internals/msgpack_extensions/#the-error-type)
    - TarantoolError: general errors thrown by the driver
- New option `commandTimeout` to define the max execution time of the sent request. Can be configured on the class globally or per each command
- `packDecimal()` function now also accepts BigInt
- Improved performance of the built-in MsgPack extensions (used in a `packDecimal()`, `packUuid()`, etc)
- Improved compression of the 'update' / 'upsert' operations by converting a string field names to their corresponding ID's
- New iterators: OVERLAPS and NEIGHBOR
- Extended tests (with help of a native `node:test` and `node:assert`) 
- Updated benchmarks, README, eslint config 
- New guides
- Even better performance
- New `.quit()` method - awaits for the sent commands to become fullfilled before the connection closes
- Pipeline response is now an instance of `PipelineResponse` with 2 additional methods: `findPipelineError()` and `findPipelineErrors()`

## 3.2.0

- Now supports [prepared](https://www.tarantool.io/en/doc/latest/reference/reference_lua/box_sql/prepare/#box-sql-box-prepare) SQL statements.
- Huge rewrite of the codebase, which improved the performance:
    - Now using 'msgpackr' instead of 'msgpack-lite'
    - Buffer reuse
    - Decreased memory consumption
- New AutoPipelining mode: optimise performance with no need to rewrite your existing code. Benchmark showed x4 performance for the `select` requests: 
    - 350k/sec without AutoPipelining
    - 1400k/sec with AutoPipelining feature enabled
- [IPROTO_ID](https://www.tarantool.io/en/doc/latest/reference/internals/iproto/requests/#iproto-id) can be invoked as 'conn.id()' function.
- [Streams](https://www.tarantool.io/en/doc/latest/platform/atomic/txn_mode_mvcc/#streams-and-interactive-transactions) support.

## 3.1.0

- Added 3 new msgpack extensions: UUID, Datetime, Decimal.
- Connection object now accepts all options of `net.createConnection()`, including Unix socket path.
- New `nonWritableHostPolicy` and related options, which improves a high availability capabilities without any 3rd parties.
- Ability to disable the offline queue.
- Fixed [bug with int32](https://github.com/tarantool/node-tarantool-driver/issues/48) numbers when it was encoded as floating. Use method `packInteger()` to solve this.
- `selectCb()` now also accepts `spaceId` and `indexId` as their String names, not only their IDs.
- Some performance improvements by caching internal values.
- TLS (SSL) support.
- New `pipeline()`+`exec()` methods kindly borrowed from the [ioredis](https://github.com/redis/ioredis?tab=readme-ov-file#pipelining), which lets you to queue some commands in memory and then send them simultaneously to the server in a single (or several, if request body is too big) network call(s). Thanks to the Tarantool, which [made this possible](https://www.tarantool.io/en/doc/latest/dev_guide/internals/iproto/format/#packet-structure).
This way the performance is significantly improved by 500-1600% - you can check it yourself by running `npm run benchmark-read` or `npm run benchmark-write`.
Note that this feature doesn't replaces the Transaction model, which has some level of isolation.
- Changed `const` declaration to `var` in order to support old Node.JS versions.

## 3.0.7

Fix in header decoding to support latest Tarantool versions. Update to tests to support latest Tarantool versions.

## 3.0.6

Remove let for support old nodejs version

## 3.0.5

Add support SQL

## 3.0.4

Fix eval and call

## 3.0.3

Increase request id limit to SMI Maximum

## 3.0.2

Fix parser thx @tommiv

## 3.0.0

New version with reconnect in alpha.

## 1.0.0

Fix test for call changes and remove unuse upsert parameter (critical change API for upsert)

## 0.4.1

Add clear schema cache on change schema id

## 0.4.0

Change msgpack5 to msgpack-lite(thx to @arusakov).
Add msgpack as option for connection.
Bump msgpack5 for work at new version.

## 0.3.0
Add upsert operation.
Key is now can be just a number.