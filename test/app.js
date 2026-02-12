/**
 * Test suite for TarantoolConnection
 */

const { test, describe, before, after } = require('node:test');
const assert = require('node:assert');
const TarantoolConnection = require('../lib/connection');
const { states } = require('../lib/const');
const { noop } = require('lodash');
const {
  setTimeout: promisedSetTimeout,
} = require('node:timers/promises');
let conn;

// Global error handlers for better debugging
process.on('unhandledRejection', (error, promise) => {
    console.error('❌ Unhandled Rejection:', error);
});

process.on('uncaughtException', (error) => {
    console.error('❌ Uncaught Exception:', error);
    process.exit(1);
});

// mainly for 'constructor' tests
const optLazyConnect = {
    lazyConnect: true
};
// load fast and save on network bandwith
const optDontPrefetchSchema = {
    prefetchSchema: false
};

const truncateSpace = async (conn, spaceName) => {
    return conn.sql(`DELETE FROM "${spaceName}" INDEXED BY "tree_idx" WHERE true`);
};

describe('constructor', () => {
    test('should parse options correctly', () => {
        try {
            let option;

            option = getOption(33013);
            assert.strictEqual(option.port, 33013);
            assert.strictEqual(option.host, 'localhost');

            option = getOption('33013');
            assert.strictEqual(option.port, 33013);

            option = getOption(33013, '192.168.0.1');
            assert.strictEqual(option.port, 33013);
            assert.strictEqual(option.host, '192.168.0.1');

            option = getOption(33013, '192.168.0.1', {
                password: '123',
                username: 'userloser'
            });
            assert.strictEqual(option.port, 33013);
            assert.strictEqual(option.host, '192.168.0.1');
            assert.strictEqual(option.password, '123');
            assert.strictEqual(option.username, 'userloser');

            option = getOption('mail.ru:33013');
            assert.strictEqual(option.port, 33013);
            assert.strictEqual(option.host, 'mail.ru');

            option = getOption('notguest:sesame@mail.ru:33013');
            assert.strictEqual(option.port, 33013);
            assert.strictEqual(option.host, 'mail.ru');
            assert.strictEqual(option.username, 'notguest');
            assert.strictEqual(option.password, 'sesame');

            option = getOption('/tmp/tarantool-test.sock');
            assert.strictEqual(option.path, '/tmp/tarantool-test.sock');

            option = getOption({
                port: 33013,
                host: '192.168.0.1'
            });
            assert.strictEqual(option.port, 33013);
            assert.strictEqual(option.host, '192.168.0.1');

            option = getOption({
                port: 33013,
                host: '192.168.0.1',
                reserveHosts: ['notguest:sesame@mail.ru:33013', 'mail.ru:33013']
            });
            assert.strictEqual(option.port, 33013);
            assert.strictEqual(option.host, '192.168.0.1');
            assert.ok(option.reserveHosts);
            assert.deepStrictEqual(option.reserveHosts, [
                'notguest:sesame@mail.ru:33013',
                'mail.ru:33013'
            ]);

            // option = new TarantoolConnection({
            //     port: 33013,
            //     host: '192.168.0.1',
            //     reserveHosts: [
            //         'notguest:sesame@mail.ru:33013',
            //         'mail.ru:33013'
            //     ],
            //     ...optLazyConnect,
            //     ...optDontPrefetchSchema
            // });

            option = getOption({
                port: 33013,
                host: '192.168.0.1'
            });
            assert.strictEqual(option.port, 33013);
            assert.strictEqual(option.host, '192.168.0.1');

            option = getOption({
                port: '33013'
            });
            assert.strictEqual(option.port, 33013);

            option = getOption(33013, {
                host: '192.168.0.1'
            });
            assert.strictEqual(option.port, 33013);
            assert.strictEqual(option.host, '192.168.0.1');

            option = getOption('33013', {
                host: '192.168.0.1'
            });
            assert.strictEqual(option.port, 33013);
        } catch (e) {
            console.error('Failed to parse options: ', e);
            throw e;
        }

        function getOption(a, b, c) {
            // don't emit process warning while connecting
            if (typeof a == 'object') a.lazyConnect = true;
            if (typeof b == 'object') b.lazyConnect = true;
            if (typeof c == 'object') c.lazyConnect = true;
            if (a === undefined) a = optLazyConnect;
            if (b === undefined) b = optLazyConnect;
            if (c === undefined) c = optLazyConnect;

            conn = new TarantoolConnection(a, b, c);
            return conn.options;
        }
    });

    test('should throw when arguments are invalid', () => {
        assert.throws(() => {
            new TarantoolConnection(function () {});
        }, Error);
    });
});

describe('reconnecting', { timeout: 8000 }, () => {
    test('should pass the correct retry times', async () => {
        let t = 0;
        let finished = false;
        let lastError = null;

        conn = new TarantoolConnection({
            port: 1,
            retryStrategy: (times) => {
                try {
                    assert.strictEqual(times, ++t);
                    if (times === 3) {
                        finished = true;
                        return;
                    }
                    return 0;
                } catch (err) {
                    lastError = err;
                    console.error('❌ retryStrategy assertion failed:', {
                        expected: t,
                        actual: times,
                        message: err.message,
                        stack: err.stack
                    });
                }
            }
        });

        conn.on('error', noop); // don't emit the process warning

        await new Promise((resolve) => setTimeout(resolve, 200));

        conn.disconnect();

        if (lastError) {
            console.error(
                'Test failed with error from retryStrategy:',
                lastError
            );
            throw lastError;
        }

        assert.ok(
            finished,
            `Expected retryStrategy to complete (finished=${finished}, t=${t})`
        );
    });

    test("should skip reconnecting when retryStrategy doesn't return a number", async () => {
        let finished = false;
        let lastError = null;

        conn = new TarantoolConnection({
            port: 1,
            ...optDontPrefetchSchema,
            retryStrategy: () => {
                process.nextTick(() => {
                    try {
                        assert.strictEqual(conn._state[0], states.END);
                        finished = true;
                    } catch (err) {
                        lastError = err;
                        console.error('❌ Assertion failed in nextTick:', {
                            actual: conn._state[0],
                            expected: states.END,
                            message: err.message,
                            stack: err.stack
                        });
                    }
                });
                return null;
            }
        });

        conn.on('error', noop);

        await new Promise((resolve) => setTimeout(resolve, 200));

        if (lastError) {
            console.error('Test failed:', lastError);
            throw lastError;
        }

        assert.ok(
            finished,
            `Expected state check to complete (finished=${finished}, state=${conn._state[0]})`
        );

        conn.disconnect();
    });

    test('should not try to reconnect when disconnected manually', async () => {
        try {
            conn = new TarantoolConnection(3301, {
                lazyConnect: false,
                ...optDontPrefetchSchema
            });
            await conn.eval('return func_arg(...)', ['test']);
            conn.disconnect();

            await assert.rejects(
                async () => conn.eval('return func_arg(...)', ['test']),
                { message: 'Connection is finished' }
            );
        } catch (err) {
            console.error('❌ Test failed with error:', err);
            throw err;
        }
    });

    test('should try to reconnect and then connect eventually', async () => {
        conn = new TarantoolConnection(3301, {
            ...optLazyConnect,
            ...optDontPrefetchSchema
        });
        await conn.connect();
        let res = await conn.ping();
        assert.strictEqual(res, true);

        // disrupt the connection
        // imitating network error
        conn.connector.socket.destroy();

        await assert.rejects(() => conn.eval('return func_arg()'), {
            message: 'Socket is not writable'
        });

        // socket 'close' event may be emitted not immediately
        await promisedSetTimeout(100);

        res = await conn.ping();
        assert.strictEqual(res, true);
        conn.disconnect();
    });
});

describe('multihost', { timeout: 10000 }, () => {
    // Consider servers on port 33010 and UNIX-socket are unavailable
    // Connector will try to find the alive one (which is on port 3301).
    // This is a good example on how to pass 'reserveHosts' items in multiple ways
    // and demonstrate that we can also change connection options per each host.
    test('should try to connect to reserve hosts cyclically', async () => {
        conn = new TarantoolConnection(33010 /* pass only port */, {
            reserveHosts: [
                '/tmp/inactiveInstanceExample.sock', // may pass only UNIX socket path as a string
                {
                    // pass object with a custom 'timeout' and credentials
                    host: 'localhost',
                    port: 3301,
                    timeout: 12345,
                    username: 'test',
                    password: 'notStrongPass :('
                }
            ],
            beforeReserve: 1,
            ...optDontPrefetchSchema,
            retryStrategy: (times) => {
                return Math.min(times * 500, 2000);
            }
        });

        conn.on('error', noop);

        let t = 0;
        const connectionPromise = new Promise((resolve) => {
            conn.on('reconnecting', () => {
                const opts = conn.options;
                try {
                    switch (t) {
                        case 0:
                            assert.equal(opts.port, 33010);
                            assert.equal(opts.host, 'localhost');
                            assert.equal(opts.path, null);
                            assert.equal(opts.username, null);
                            assert.equal(opts.password, null);
                            break;
                        case 1:
                            assert.equal(opts.port, null);
                            assert.equal(opts.host, null);
                            assert.equal(
                                opts.path,
                                '/tmp/inactiveInstanceExample.sock'
                            );
                            assert.equal(opts.username, null);
                            assert.equal(opts.password, null);
                            break;
                        case 2:
                            assert.equal(opts.port, 3301);
                            assert.equal(opts.host, 'localhost');
                            assert.equal(opts.path, null);
                            assert.equal(opts.username, 'test');
                            assert.equal(opts.password, 'notStrongPass :(');
                            assert.equal(opts.timeout, 12345);
                            resolve();
                            break;
                    }
                } catch (e) {
                    reject(e);
                }
                t++;
            });
        });

        await conn.ping();
        return connectionPromise
        .finally(() => conn.disconnect());
    });
});

describe('lazy connect', () => {
	before(() => {
		conn = new TarantoolConnection({port: 3301, lazyConnect: true, username: 'test', password: 'notStrongPass :('});
	});
	test('lazy connect', async () => {
		assert.strictEqual(conn._state[0], states.INITED);
		await conn.connect();
		assert.strictEqual(conn._state[0], states.CONNECT);
	});
	test('should be authenticated', async () => {
		const res = await conn.eval('return box.session.user()');
		assert.strictEqual(res[0], 'test');
	});
	test('should disconnect when inited', () => {
		conn.disconnect();
		assert.strictEqual(conn._state[0], states.END);
	});
	test('should connect after ".disconnect()" call', async () => {
        await promisedSetTimeout(100) // wait for the previous '.disconnect()' call to fullfill
		await conn.connect();
		conn.disconnect();
		assert.strictEqual(conn._state[0], states.END);
        const isWritable = conn.connector.isWritable();
		assert.strictEqual(isWritable, false);
	});
});

describe('instant connection', () => {
	before(() => {
		conn = new TarantoolConnection({port: 3301, username: 'test', password: 'notStrongPass :('});
	});
	test('connect', async () => {
		const res = await conn.eval('return func_arg(...)', ['connected!']);
		assert.strictEqual(res[0], 'connected!');
	});
	test('should reject when connected', async () => {
		await assert.rejects(
			() => conn.connect(),
			{ message: /Tarantool is already connecting\/connected/ }
		);
	});
	test('should be authenticated', async () => {
		const res = await conn.eval('return box.session.user()');
		assert.strictEqual(res[0], 'test');
        conn.disconnect()
	});
	test('should reject when auth failed', async () => {
		conn = new TarantoolConnection({port: 3301, username: 'userloser', password: 'test'});
        conn.on('error', noop)

        await conn.pendingPromises.connect.catch(noop);

		await assert.rejects(
			() => conn.eval('return func_arg()'),
			{ message: /Connection is closed/ }
		);
		conn.disconnect();
	});
	test('should reject command when connection is closed', async () => {
		conn = new TarantoolConnection(3301);
        
        await conn.pendingPromises.connect.catch(noop);

		conn.disconnect();

		await assert.rejects(
			() => conn.eval('return func_arg()'),
			{ message: /Connection is finished/ }
		);
	});
});

describe('timeout', { timeout: 10000 }, () => {
	test('should close the connection when timeout', async () => {
		conn = new TarantoolConnection(3301, '192.0.0.0', {
			timeout: 1,
			retryStrategy: null
		});

		const errorPromise = new Promise((resolve) => {
			conn.on('error', (err) => {
				resolve(
                    assert.strictEqual(err.message, 'connect ETIMEDOUT')
                )
			});
		});

		try {
			await conn.ping();
		} catch (err) {
			assert.match(err.message, /Connection is closed/);
		}

		await errorPromise;
	});
});

describe('requests', () => {
	let insertTuple = [1, [1, 2]];
	before(async () => {
		try {
			conn = new TarantoolConnection({port: 3301, username: 'test', password: 'notStrongPass :(', ...optLazyConnect});

            await truncateSpace(conn, 'bench_memtx');
			console.info('✓ Deleted test data');
		} catch(e) {
			console.error('❌ Setup failed in requests.before hook:', e);
			throw e;
		}
	});
	test('insert', async () => {
		const a = await conn.insert('bench_memtx', insertTuple);
        assert.deepStrictEqual(a[0], insertTuple);
	});
	test('replace', async () => {
		const a = await conn.replace('bench_memtx', insertTuple);
        assert.deepStrictEqual(a[0], insertTuple);
	});
	test('simple select', async () => {
		const a = await conn.select(512, 0, 1, 0, 'eq', [1]);
        assert.deepStrictEqual(a[0], insertTuple);
	});
	test('simple select with callback', async () => {
        return new Promise((resolve, reject) => {
            conn.select(512, 0, 1, 0, 'eq', [1], null, (error, result) => {
                if (error) return reject(error);

                try {
                    assert.deepStrictEqual(result[0], insertTuple);
                    resolve();
                } catch (e) {
                    reject(e)
                }
            })
        })
	});
	test('composite select', async () => {
		const a = await conn.select(512, 2 /* rtree idx */, null /* connector should use the default offset and limit values if omitted */, undefined, 'eq', [[1, 2]])
        assert.deepStrictEqual(a[0], insertTuple);
	});
	test('dup error', async () => {
		await assert.rejects(
			() => conn.insert(512, insertTuple),
			Error
		);
	});
	test('update', async () => {
        insertTuple[1] = [2, 3];
		const a = await conn.update(512, 0, [1], [['=', 1, insertTuple[1]]]);
        assert.deepStrictEqual(a[0], insertTuple);
	});
	test('update with field as string', async () => {
        insertTuple[1] = [3, 4];
		const a = await conn.update(512, 0, [1], [['=', 'line', insertTuple[1]]]);
        assert.deepStrictEqual(a[0], insertTuple);
	});
    // https://www.tarantool.io/en/doc/latest/reference/reference_lua/json_paths/
	test('update inside of an array', async () => {
        insertTuple[1][0]++;
		const a = await conn.update(512, 0, [1], [['+', 'line[1]', 1]]);
        assert.deepStrictEqual(a[0], insertTuple);
	});
	test('delete', async () => {
		const a = await conn.delete(512, 0, [1]);
        assert.deepStrictEqual(a[0], insertTuple);
	});
	test('a lot of insert', async () => {
		const promises = [];
		for (let i = 1; i <= 5000; i++) {
			promises.push(conn.insert(512, [i, [i, i+1]]));
		}
		return Promise.all(promises);
	});
	test('check errors', async () => {
		await assert.rejects(
			() => conn.insert(512, ['key', 'key', 'key'])
		);
	});
	test('call print', async () => {
		const a = await conn.call('func_arg', ['test']);
		assert.strictEqual(a[0][0], 'test');
	});
	test('call sum', async () => {
		const a = await conn.call('sum', [1, 2]).catch(console.error);
		assert.strictEqual(a[0][0], 3);
	});
	test('get metadata space by name', async () => {
		const v = await conn._getSpaceId('bench_memtx');
		assert.strictEqual(v, 512);
	});
	test('get metadata index by name', async () => {
		const v = await conn._getIndexId(512, 'tree_idx');
		assert.strictEqual(v, 1);
	});
	test('insert with space name', async () => {
        insertTuple = [0, [0, 1]];
		await conn.insert('bench_memtx', insertTuple);
	});
	test('select with space name and index name', async () => {
		const a = await conn.select('bench_memtx', 'hash_idx', 0, 0, 'eq', [0]);
        assert.deepStrictEqual(a[0], insertTuple)
	});
	test('select with space name and index number', async () => {
		const a = await conn.select('bench_memtx', 1, 0, 0, 'eq', [0]);
        assert.deepStrictEqual(a[0], insertTuple)
	});
	test('select with space number and index name', async () => {
		const a = await conn.select(512, 'hash_idx', 0, 0, 'eq', [0]);
        assert.deepStrictEqual(a[0], insertTuple)
	});
    test('upsert', async () => {
        // should update the tuple because it exists
        insertTuple[1] = [1, 1]
		await conn.upsert('bench_memtx', [['=', 1, insertTuple[1]]], insertTuple);
        const a = await conn.select('bench_memtx', 1, 0, 0, 'eq', [0]);
		assert.deepStrictEqual(a[0], insertTuple);

        // should insert a new tuple because it doesn't exist
        const newArr = [5001, [1, 1]];
		await conn.upsert('bench_memtx', [['=', 1, [0, 0]]], newArr);
        const b = await conn.select('bench_memtx', 1, 0, 0, 'eq', [5001]);
		assert.deepStrictEqual(b[0], newArr);
	});
	test('delete with name', async () => {
		const a = await conn.delete('bench_memtx', 'hash_idx', [0]);
        assert.deepStrictEqual(a[0], insertTuple);
	});
	test('evaluate expression', async () => {
		const res = await conn.eval('return 2+2');
		assert.strictEqual(res[0], 4);
	});
	test('evaluate expression with args', async () => {
		const res = await conn.eval('return sum(...)', [11, 22]);
		assert.strictEqual(res[0], 33);
	});
	test('ping', async () => {
		const res = await conn.ping();
		assert.strictEqual(res, true);
	});

    after(async () => {
        return conn.quit()
    })
});