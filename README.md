# Node.js driver for tarantool 1.7+

[![Build Status](https://travis-ci.org/tarantool/node-tarantool-driver.svg)](https://travis-ci.org/tarantool/node-tarantool-driver)

Node tarantool driver for 1.7+ support Node.js v.4+.

Based on [go-tarantool](https://github.com/tarantool/go-tarantool) and implements [Tarantool’s binary protocol](http://tarantool.org/doc/dev_guide/box-protocol.html), for more information you can read them or basic documentation at [Tarantool manual](http://tarantool.org/doc/).

Code architecture and some features in version 3 borrowed from the [ioTarantool](https://github.com/luin/ioTarantool).

[msgpack-lite](https://github.com/kawanet/msgpack-lite) package used as MsgPack encoder/decoder.

<!-- If you have a problem with connection it will be destroyed. You can subscribe on TarantoolConnection.socket.on('close') for retrieve information about closing connection or you can process rejected errors for you requests. -->


## Table of contents

* [Installation](#installation)
* [Configuration](#configuration)
* [Usage example](#usage-example)
* [Msgpack implementation](#msgpack-implementation)
* [API reference](#api-reference)
* [Debugging](#debugging)
* [Contributions](#contributions)
* [Changelog](#changelog)

## Installation

```Bash
npm install --save tarantool-driver
```
## Configuration

new Tarantool([port], [host], [options]) ⇐ <code>[EventEmitter](http://nodejs.org/api/events.html#events_class_events_eventemitter)</code></dt>

Creates a Tarantool instance, extends [EventEmitter](http://nodejs.org/api/events.html#events_class_events_eventemitter).

Connection related custom events:
* "reconnecting" - emitted when the client try to reconnect, first argument is retry delay in ms.
* "connect" - emitted when the client connected and auth passed (if username and password provided), first argument is an object with host and port of the Taranool server.
* "change_host" - emitted when `nonWritableHostPolicy` option is set and write error occurs, first argument is the text of error which provoked the host to be changed.

| Param | Type | Default | Description |
| --- | --- | --- | --- |
| [port] | <code>number</code> \| <code>string</code> \| <code>Object</code> | <code>3301</code> | Port of the Tarantool server, or a URI string (see the examples in [tarantool configuration doc](https://tarantool.org/en/doc/reference/configuration/index.html#uri)), or the `options` object(see the third argument). |
| [host] | <code>string</code> \| <code>Object</code> | <code>&quot;localhost&quot;</code> | Host of the Tarantool server, when the first argument is a URL string, this argument is an object represents the options. |
| [path] | <code>string</code> \| <code>Object</code> | <code>null</code> | Unix socket path of the Tarantool server. |
| [options] | <code>Object</code> |  | Other options, including all from [net.createConnection](https://nodejs.org/api/net.html#netcreateconnection). |
| [options.port] | <code>number</code> | <code>6379</code> | Port of the Tarantool server. |
| [options.host] | <code>string</code> | <code>&quot;localhost&quot;</code> | Host of the Tarantool server. |
| [options.username] | <code>string</code> | <code>null</code> | If set, client will authenticate with the value of this option when connected. |
| [options.password] | <code>string</code> | <code>null</code> | If set, client will authenticate with the value of this option when connected. |
| [options.timeout] | <code>number</code> | <code>0</code> | The milliseconds before a timeout occurs during the initial connection to the Tarantool server. |
| [options.keepAlive] | <code>boolean</code> | <code>true</code> | Enables keep-alive functionality (recommended). |
| [options.noDelay] | <code>boolean</code> | <code>true</code> | Disables the use of Nagle's algorithm (recommended). |
| [options.lazyConnect] | <code>boolean</code> | <code>false</code> | By default, When a new `Tarantool` instance is created, it will connect to Tarantool server automatically. If you want to keep disconnected util a command is called, you can pass the `lazyConnect` option to the constructor. |
| [options.nonWritableHostPolicy] | <code>string</code> | <code>null</code> | What to do when Tarantool server rejects write operation, e.g. because of `box.cfg.read_only` set to `true` or during snapshot fetching. <br /> Possible values are: <br /> - `null`: just rejects Promise with an error <br /> - `changeHost`: disconnect from the current host and connect to the next from `reserveHosts`. Pending Promise will be rejected. <br /> - `changeAndRetry`: same as `changeHost`, but after reconnecting tries to run the command again in order to fullfil the Promise |
| [options.maxRetriesPerRequest] | <code>number</code> | <code>5</code> | Number of attempts to find the alive host if `nonWritableHostPolicy` is not null. |
| [options.enableOfflineQueue] | <code>boolean</code> | <code>true</code> | By default, if there is no active connection to the Tarantool server, commands are added to a queue and are executed once the connection is "ready", meaning the connection to the Tarantool server has been established and auth passed (`connect` event is also executed at this moment). If this option is false, when execute the command when the connection isn't ready, an error will be returned. |
| [options.reserveHosts] | <code>array</code> | [] | Array of [strings](https://tarantool.org/en/doc/reference/configuration/index.html?highlight=uri#uri)  - reserve hosts. Client will try to connect to hosts from this array after loosing connection with current host and will do it cyclically. See example below.|
| [options.beforeReserve] | <code>number</code> | <code>2</code> | Number of attempts to reconnect before connect to next host from the <code>reserveHosts</code> |
| [options.retryStrategy] | <code>function</code> |  | See below |

### Reserve hosts example:

```javascript
let connection = new Tarantool({
    host: 'mail.ru',
    port: 33013,
    username: 'user'
    password: 'secret',
    reserveHosts: [
        'anotheruser:difficultpass@mail.ru:33033',
        '127.0.0.1:3301'
    ],
    beforeReserve: 1
})
// connect to mail.ru:33013 -> dead
//                  ↓
// trying connect to mail.ru:33033 -> dead
//                  ↓
// trying connect to 127.0.0.1:3301 -> dead
//                  ↓
// trying connect to mail.ru:33013 ...etc
```

### Retry strategy

By default, node-tarantool-driver client will try to reconnect when the connection to Tarantool is lost
except when the connection is closed manually by `tarantool.disconnect()`.

It's very flexible to control how long to wait to reconnect after disconnection
using the `retryStrategy` option:

```Javascript
var tarantool = new Tarantool({
  // This is the default value of `retryStrategy`
  retryStrategy: function (times) {
    var delay = Math.min(times * 50, 2000);
    return delay;
  }
});
```


`retryStrategy` is a function that will be called when the connection is lost.
The argument `times` means this is the nth reconnection being made and
the return value represents how long (in ms) to wait to reconnect. When the
return value isn't a number, node-tarantool-driver will stop trying to reconnect, and the connection
will be lost forever if the user doesn't call `tarantool.connect()` manually.

**This feature is borrowed from the [ioTarantool](https://github.com/luin/ioTarantool)**

## Usage example

We use TarantoolConnection instance and connect before other operations. Methods call return promise(https://developer.mozilla.org/ru/docs/Web/JavaScript/Reference/Global_Objects/Promise). Available methods with some testing: select, update, replace, insert, delete, auth, destroy.
```Javascript
var TarantoolConnection = require('tarantool-driver');
var conn = new TarantoolConnection('notguest:sesame@mail.ru:3301');

// select arguments space_id, index_id, limit, offset, iterator, key
conn.select(512, 0, 1, 0, 'eq', [50])
    .then(funtion(results){
        doSomeThingWithResults(results);
    });
```


## Msgpack implementation

You can use any implementation that can be duck typing with next interface:

```Javascript
//msgpack implementation example
/*
    @interface
    decode: (Buffer buf)
    encode: (Object obj)
 */
var exampleCustomMsgpack = {
    encode: function(obj){
        return yourmsgpack.encode(obj);
    },
    decode: function(buf){
        return yourmsgpack.decode(obj);
    }
};
```

By default use msgpack-lite package.

## API reference

### tarantool.connect() ⇒ <code>Promise</code>

Resolve if connected. Or reject if not.

### tarantool._auth(login: String, password: String) ⇒ <code>Promise</code>

**An internal method. The connection should be established before invoking.**

Auth with using [chap-sha1](http://tarantool.org/doc/book/box/box_space.html). About authenthication more here: [authentication](http://tarantool.org/doc/book/box/authentication.html)

### tarantool.packUuid(uuid: String)

**Method for converting [UUID values](https://www.tarantool.io/ru/doc/latest/concepts/data_model/value_store/#uuid) to Tarantool-compatible format.**

If passing UUID without converion via this method, server will accept it as simple String.

### tarantool.packDecimal(numberToConvert: Number)

**Method for converting Numbers (Float or Integer) to Tarantool [Decimal](https://www.tarantool.io/ru/doc/latest/concepts/data_model/value_store/#decimal) type.**

If passing number without converion via this method, server will accept it as Integer or Double (for JS Float type).

### tarantool.packInteger(numberToConvert: Number)

**Method for safely passing numbers up to int64 to bind params**

Otherwise msgpack will encode anything bigger than int32 as a double number.

### tarantool.select(spaceId: Number or String, indexId: Number or String, limit: Number, offset: Number, iterator: Iterator,  key: tuple) ⇒ <code>Promise</code>

[Iterators](http://tarantool.org/doc/book/box/box_index.html). Available iterators: 'eq', 'req', 'all', 'lt', 'le', 'ge', 'gt', 'bitsAllSet', 'bitsAnySet', 'bitsAllNotSet'.

It's just select. Promise resolve array of tuples.

Some examples:

```Javascript
conn.select(512, 0, 1, 0, 'eq', [50]);
//same as
conn.select('test', 'primary', 1, 0, 'eq', [50]);
```

You can use space name or index name instead of id, but it will some requests for get this metadata. That information actual for delete, replace, insert, update too.

You can create space 'users' on Tarantool side, where the 'id' index is of UUID type:

```lua
-- example schema of such space
box.schema.space.create("users", {engine = 'memtx'})
box.space.users:format({
    {name = 'id', type = 'uuid', is_nullable = false},
    {name = 'username', type = 'string', is_nullable = false}
})
```
And then select some tuples on a client side:
```Javascript
conn.select('users', 'id', 1, 0, 'eq', [conn.packUuid('550e8400-e29b-41d4-a716-446655440000')]);
```

### tarantool.selectCb(spaceId: Number or String, indexId: Number or String, limit: Number, offset: Number, iterator: Iterator,  key: tuple, callback: function(success), callback: function(error))

Same as [tarantool.select](#select) but with callbacks.

### tarantool.delete(spaceId: Number or String, indexId: Number or String, key: tuple) ⇒ <code>Promise</code>

Promise resolve an array of deleted tuples.

### tarantool.update(spaceId: Number or String, indexId: Number or String, key: tuple, ops) ⇒ <code>Promise</code>

[Possible operators.](https://tarantool.org/doc/book/box/box_space.html#lua-function.space_object.update)

Promise resolve an array of updated tuples.

### tarantool.insert(spaceId: Number or String, tuple) ⇒ <code>Promise</code>

More you can read here: [Insert](https://tarantool.org/doc/book/box/box_space.html#lua-function.space_object.insert)

Promise resolve a new tuple.

### tarantool.upsert(spaceId: Number or String, ops: array of operations, tuple: tuple) ⇒ <code>Promise</code>

About operation: [Upsert](http://tarantool.org/doc/book/box/box_space.html#lua-function.space_object.upsert)

[Possible operators.](https://tarantool.org/doc/book/box/box_space.html#lua-function.space_object.update)

Promise resolve nothing.

### tarantool.replace(spaceId: Number or String, tuple: tuple) ⇒ <code>Promise</code>

More you can read here: [Replace](https://tarantool.org/doc/book/box/box_space.html#lua-function.space_object.replace)

Promise resolve a new or replaced tuple.

### tarantool.call(functionName: String, args...) ⇒ <code>Promise</code>

Call a function with arguments.

You can create function on tarantool side:
```Lua
function myget(id)
    val = box.space.batched:select{id}
    return val[1]
end
```

And then use something like this:
```Javascript
conn.call('myget', 4)
    .then(function(value){
        console.log(value);
    });
```

If you have a 2 arguments function just send a second arguments in this way:
```Javascript
conn.call('my2argumentsfunc', 'first', 'second argument')
```
And etc like this.

Because lua support a multiple return it's always return array or undefined.

### tarantool.eval(expression: String) ⇒ <code>Promise</code>

Evaluate and execute the expression in Lua-string. [Eval](https://tarantool.org/doc/reference/reference_lua/net_box.html?highlight=eval#lua-function.conn.eval)

Promise resolve result:any.

Example:


```Javascript
conn.eval('return box.session.user()')
    .then(function(res){
        console.log('current user is:' res[0])
    })
```

### tarantool.sql(query: String, bindParams: Array) -> <code>Promise</code>

It's accessible only in 2.1 tarantool.

You can use SQL query that is like sqlite dialect to query a tarantool database.

You can insert or select or create database.

More about it [here](https://www.tarantool.io/en/doc/2.1/tutorials/sql_tutorial/).

Example:

```Javascript
await connection.insert('tags', ['tag_1', 1])
await connection.insert('tags', ['tag_2', 50])
connection.sql('select * from "tags"')
.then((res) => {
  console.log('Successful get tags', res);
})
.catch((error) => {
  console.log(error);
});
```

P.S. If you using lowercase in your space name you need to use a double quote for their name.

It doesn't work for space without format.

### tarantool.ping() ⇒ <code>Promise</code>

Promise resolve true.

### ~~tarantool.destroy(interupt: Boolean) ⇒ <code>Promise</code>~~
***Deprecated***
### tarantool.disconnect()
Disconnect from Tarantool.

This method closes the connection immediately,
and may lose some pending replies that haven't written to client.

## Debugging

Set environment variable "DEBUG" to "tarantool-driver:*"

## Contributions

It's ok you can do whatever you need. I add log options for some technical information it can be help for you. If i don't answer i just miss email :( it's a lot emails from github so please write me to newbiecraft@gmail.com directly if i don't answer in one day.

## Changelog

### 4.0.0

- Added 3 new msgpack extensions: UUID, Datetime, Decimal.
- Connection object now accepts all options of `net.createConnection()`, including Unix socket path.
- New `nonWritableHostPolicy` and related options, which improves a high availability capabilities without any 3rd parties.
- Ability to disable the offline queue.
- Fixed [bug with int32](https://github.com/tarantool/node-tarantool-driver/issues/48) numbers when it was encoded as floating. Use method `packInteger()` to solve this.
- `selectCb()` now also accepts `spaceId` and `indexId` as their String names, not only their IDs.

### 3.0.7

Fix in header decoding to support latest Tarantool versions. Update to tests to support latest Tarantool versions.

### 3.0.6

Remove let for support old nodejs version

### 3.0.5

Add support SQL

### 3.0.4

Fix eval and call

### 3.0.3

Increase request id limit to SMI Maximum

### 3.0.2

Fix parser thx @tommiv

### 3.0.0

New version with reconnect in alpha.

### 1.0.0

Fix test for call changes and remove unuse upsert parameter (critical change API for upsert)

### 0.4.1

Add clear schema cache on change schema id

### 0.4.0

Change msgpack5 to msgpack-lite(thx to @arusakov).
Add msgpack as option for connection.
Bump msgpack5 for work at new version.

### 0.3.0
Add upsert operation.
Key is now can be just a number.

## ToDo

1. Streams
2. Events and subscriptions
3. Graceful shutdown protocol
4. Prepared SQL statements