# node-tarantool-driver

[![Build Status](https://travis-ci.org/KlonD90/node-tarantool-driver.svg)](https://travis-ci.org/KlonD90/node-tarantool-driver)

This project is an effort to create a blazing fast Node.js [Tarantool](http://tarantool.org/) driver comparable to (or even faster than) the drivers for other languages, such as [Python](https://github.com/tarantool/tarantool-python), [Java](https://github.com/tarantool/tarantool-java), [Ruby](https://github.com/tarantool/tarantool-ruby) and [Go](https://github.com/tarantool/go-tarantool). Benchmarks are coming soon...

Supports Tarantool >= 1.6, Node.js >= 0.12 (or IO.js).

Initially based on [Go Tarantool driver](https://github.com/mialinx/go-tarantool-1.6). Implements [Tarantool IProto Protocol](http://tarantool.org/doc/dev_guide/box-protocol.html). See [Tarantul docs](http://tarantool.org/doc/) for more info.

Tuples are handled using [`msgpack-lite`](https://github.com/kawanet/msgpack-lite).

## Install

```
npm install --save tarantool-driver
```

## Usage example

Create a `TarantoolConnection` instance and wait for it to `.connect()`. After that you can call any methods directly on the connection. Available methods: `select`, `update`, `replace`, `insert`, `delete`, `auth`, `destroy`. All methods return [Promise](https://developer.mozilla.org/ru/docs/Web/JavaScript/Reference/Global_Objects/Promise)s.

```js
var TarantoolConnection = require('tarantool-driver');
var conn = new TarantoolConnection({port: 3301});

conn.connect()
.then(function(){
  // Connection established. Authenticate user
  return conn.auth('login', 'password');
}).then(function(){
  // `select` arguments: space_id, index_id, limit, offset, iterator, key
  return conn.select(512, 0, 1, 0, 'eq', [50]);
})
.then(funtion(results){
  console.log(results);
});
```

## API

**class TarantoolConnection(options)**

```js
var defaultOptions = {
  host: 'localhost',
  port: '3301',
  log: false,
  msgpack: require('msgpack-lite'),
  timeout: 3000
};
```

You can override the default options with your custom options.

**connect() : Promise**

Resolves when the connection has been established. Rejects otherwise.

**auth(login: String, password: String) : Promise**

Authenticates using [`chap-sha1`](http://tarantool.org/doc/book/box/box_space.html). See [Tarantul docs](http://tarantool.org/doc/book/box/authentication.html) for more info on authentication.

**select(spaceId: Number or String, indexId: Number or String, limit: Number, offset: Number, iterator: Iterator,  key: tuple) : Promise( Array of tuples)**

Supported [iterators](http://tarantool.org/doc/book/box/box_index.html): `eq`, `req`, `all`, `lt`, `le`, `ge`, 'gt', `bitsAllSet`, `bitsAnySet`, `bitsAllNotSet`.

It's just a select. `Promise` resolves to an array of tuples.

Example: 

```js
conn.select(512, 0, 1, 0, 'eq', [50]);
// same as
conn.select('test', 'primary', 1, 0, 'eq', [50]);
```

You can pass space name or index name instead of an id, but in that case it will perform some additional requests to obtain the metadata required for resolving names. Same goes for `delete`, `replace`, `insert` and `update`.

**delete(spaceId: Number or String, indexId: Number or String, key: tuple) : Promise(Array of tuples)**

Resolves to an array of deleted tuples.

**update(spaceId: Number or String, indexId: Number or String, key: tuple, ops) : Promise(Array of tuples)**

See [Tarantool docs](http://tarantool.org/doc/book/box/box_space.html) (search for `update` there) for more info on the `ops` parameter.

Resolves to an array of updated tuples.

**insert(spaceId: Number or String, tuple: tuple) : Promise(Tuple)**

Performs an insert. See [Tarantool docs](http://tarantool.org/doc/book/box/box_space.html) (search for `update` there) for more info.

Resolves to the inserted tuple.

**upsert(spaceId: Number or String, ops: array of operations, tuple: tuple) : Promise()**

See [Tarantool docs](http://tarantool.org/doc/book/box/box_space.html#lua-function.space_object.upsert) (search for `update` there) for more info on `upsert`.

Resolves to nothing.

**replace(spaceId: Number or String, tuple: tuple) : Promise(Tuple)**

Performs an replacement operation. See [Tarantool docs](http://tarantool.org/doc/book/box/box_space.html) (search for `update` there) for more info.

Resolves to a new or replaced tuple.

**call(functionName: String, args...) : Promise(Array or undefined)**

Calls a function with arguments. See the tests for more usage examples.

You can create a function in Tarantool: 

```lua
function myget(id)
  val = box.space.batched:select{id}
  return val[1]
end
```

And then call it like this:

```js
conn.call('myget', 4)
.then(function(value){
  console.log(value);
});
```

If the function takes more than one argument then just pass the arguments as usually done in javascript:

```js
conn.call('2_arguments_func', 'first argument', 'second argument')
```

Because Lua supports returning multiple values as a result, it will always return either an array or `undefined`.

**destroy(interupt: Boolean) : Promise**

If you call `destroy` with `interupt` set to `true` then it will interupt all processes and destroy all socket connections without waiting for them to finish. Otherwise (the default behaviour) it waits for all ongoing processes to finish and then closes the connection.

## Msgpack implentation

You can use any MessagePack implementation of your choice. The only requirement is that it implements the following interface:

```js
// `msgpack` implementation example
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

[`msgpack-lite`](https://github.com/kawanet/msgpack-lite) is used by default.

## Troubleshooting

The connection will be destroyed in case of a connection-specific error. Subscribe to the socket `close` event to handle connection errors

```js
TarantoolConnection.socket.on('close', function(error){
  // Hadle connection errors here
})
```

## Testing

Note: this is a very basic test, a more sophisticated one is coming in the future.

First install all the dependencies

```
npm install
```

Also make sure Tarantool is installed on your machine.

Next, prepare your Tarantool instance for the test:
```
$ ./test/box.lua
```

And, finally, run `npm test`.

## Contributing

You're welcome to send me an email (or create an issue) discussing anything be it a feature request, a bug report or a suggestion for a change of any kind. If I don't answer to a comment or an issue then it means that I just missed the email notification. I receive a lot of emails from GitHub every day so please write me to `newbiecraft@gmail.com` directly if I don't answer you in one day.

## Changelog

### 1.0.0

  * Fix: call tests changed and removed unused upsert parameter (critical change API for upsert)

### 0.4.1

  * Clearing schema cache on schema id change

### 0.4.0

  * Switched `msgpack5` for `msgpack-lite` (thx to `@arusakov`).  
  * Added `msgpack` as a connection option.   
  * Bumped `msgpack5` version.

### 0.3.0

  * Added upsert operation.  
  * Now key can be just a number.

## ToDo

  * Test `eval` methods
  * Release benchmarks
  * Improve performance
