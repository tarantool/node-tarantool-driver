/**
 * Test suite for Auto-Pipelining feature (enableAutoPipelining option)
 */

const { test, describe, before, after, afterEach } = require('node:test');
const assert = require('node:assert');
const TarantoolConnection = require('../lib/connection');

let conn;

const truncateSpace = async (conn, spaceName) => {
    return conn.sql(`DELETE FROM "${spaceName}" INDEXED BY "tree_idx" WHERE true`);
};

describe('Auto-Pipelining (enableAutoPipelining option)', { timeout: 10000 }, () => {
    before(async () => {
        conn = new TarantoolConnection(3301, {
            enableAutoPipelining: true,
            lazyConnect: true
        });
        await conn.connect();
    });

    after(async () => {
        if (conn) {
            await conn.quit();
        }
    });

    afterEach(() => {
        return truncateSpace(conn, 'bench_memtx');
    })

    test('should have autoPipeliner available on connection', () => {
        assert.ok(conn.autoPipeliner, 'Connection should have autoPipeliner');
        assert.ok(typeof conn.autoPipeliner.add === 'function', 'autoPipeliner should have add method');
        assert.ok(Array.isArray(conn.autoPipeliner.queue) || 
                  conn.autoPipeliner.queue instanceof Array,
                  'autoPipeliner should have queue');
    });

    test('should accumulate commands during same event loop tick', async () => {
        try {
            assert.equal(conn.autoPipeliner.queue.length, 0);

            const firstInsert = [771, [771, 772]];
            const secondInsert = [772, [772, 773]];

            // Issue multiple commands without await (in same event loop)
            const promise1 = conn.insert('bench_memtx', firstInsert);
            const promise2 = conn.insert('bench_memtx', secondInsert);

            // At this point, commands should be queued
            assert.equal(conn.autoPipeliner.queue.length, 2);

            // autopipeline mode flushes queue on next tick
            await new Promise((resolve) => {
                process.nextTick(() => {
                    resolve(assert.equal(conn.autoPipeliner.queue.length, 0));
                });
            });

            // Wait for all commands to complete
            const [res1, res2] = await Promise.all([promise1, promise2]);

            assert.deepStrictEqual(res1[0], firstInsert);
            assert.deepStrictEqual(res2[0], secondInsert);
        } catch (err) {
            console.error('❌ Auto-pipelining accumulation test failed:', err);
            throw err;
        }
    });

    test('should properly resolve all commands after batch is sent', async () => {
        try {
            const results = [];
            const expectedCount = 15;

            // Issue multiple commands
            const promises = [];
            for (let i = 0; i < expectedCount; i++) {
                promises.push(
                    conn.insert('bench_memtx', [i, [i, i+1]])
                        .then(res => {
                            results.push(res);
                            return res;
                        })
                );
            }

            // Wait for all
            await Promise.all(promises);

            // Each should have unique values
            for (let i = 0; i < expectedCount; i++) {
                assert.deepStrictEqual(results[i][0], [i, [i, i+1]]);
            }
        } catch (err) {
            console.error('❌ Auto-pipelining resolution test failed:', err);
            throw err;
        }
    });

    test('should disable auto-pipelining with autoPipeline: false in options', async () => {
        try {
            assert.equal(conn.autoPipeliner.queue.length, 0);
            const tuple = [740, [140, 141]];
            // This command should be sent immediately, not batched
            const result = conn.insert(
                'bench_memtx',
                tuple,
                { autoPipeline: false } // Disable for this particular command
            );

            // still should be empty
            assert.equal(conn.autoPipeliner.queue.length, 0);

            const res = await result;

            assert.ok(res, 'Insert with autoPipeline: false should succeed');
            assert.deepStrictEqual(res[0], tuple);
        } catch (err) {
            console.error('❌ Auto-pipelining disable test failed:', err);
            throw err;
        }
    });
});
