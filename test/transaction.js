/**
 * Test suite for Transaction Methods
 */

const { test, describe, before, after, afterEach } = require('node:test');
const assert = require('node:assert');
const {
  setTimeout: promisedSetTimeout,
} = require('node:timers/promises');
const TarantoolConnection = require('../lib/connection');

let conn;

const truncateSpace = async (conn, spaceName) => {
    return conn.sql(`DELETE FROM "${spaceName}" INDEXED BY "tree_idx" WHERE true`);
};

describe('Transaction Methods', { timeout: 10000 }, () => {
    before(async () => {
        conn = new TarantoolConnection(3301, {
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

    test('should create transaction context', () => {
        const txn = conn.transaction();
        assert.ok(txn, 'Transaction should be created');
        assert.ok(typeof txn.begin === 'function', 'Should have begin method');
        assert.ok(typeof txn.commit === 'function', 'Should have commit method');
        assert.ok(typeof txn.rollback === 'function', 'Should have rollback method');
    });

    test('should execute commands within transaction and commit', async () => {
        try {
            const txn = conn.transaction();

            // Begin transaction
            await txn.begin(120, 0);

            // Insert data within transaction
            const tuple = [1, [1, 2]];
            const inserted = await txn.insert('bench_memtx', tuple);
            assert.ok(inserted, 'Insert within transaction should succeed');
            assert.deepStrictEqual(inserted[0], tuple);

            // Commit transaction
            await txn.commit();

            // Verify data was committed
            const results = await conn.select('bench_memtx', 'hash_idx', 1, 0, 'eq', [1]);
            assert.strictEqual(results.length, 1, 'Data should be visible after commit');
            assert.deepStrictEqual(results[0], tuple);
        } catch (err) {
            console.error('❌ Transaction commit test failed:', err);
            throw err;
        }
    });

    test('should rollback transaction changes', async () => {
        try {
            const txn = conn.transaction();

            // Begin transaction
            await txn.begin(120, 0);

            // Insert data within transaction
            const inserted = await txn.insert('bench_memtx', [1, [1, 2]]);
            assert.ok(inserted, 'Insert should succeed');

            // Rollback transaction
            await txn.rollback();

            // Verify data was NOT committed
            const results = await conn.select('bench_memtx', 'hash_idx', 1, 0, 'eq', [1]);
            const found = results.some(r => r[0] === 1);
            assert.ok(!found, 'Rolled back data should not be persisted');
        } catch (err) {
            console.error('❌ Transaction rollback test failed:', err);
            throw err;
        }
    });

    test('check transaction params', async () => {
        try {
            const txn = conn.transaction();
            const txn_isolation = 2;

            // Begin transaction with a very low timeout
            await txn.begin(1, txn_isolation);

            const currentIsolation = await txn.eval('return box.internal.txn_isolation()');
            assert.strictEqual(currentIsolation[0], txn_isolation);

            const is_in_txn = await txn.eval('return box.is_in_txn()');
            assert.ok(is_in_txn[0] === true);

            // Currently there is no internal function to get transaction timeout :(
            await promisedSetTimeout(2000)

            let err;
            await txn.commit().catch(e => err = e);
            assert.strictEqual(err?.errno, 231, 'Transaction should timeout');
        } catch (err) {
            console.error('❌ Transaction timeout test failed:', err);
            throw err;
        }
    });

    test('should support callback style for transaction methods', async () => {
        try {
            const txn = conn.transaction();

            // Test begin with callback
            await new Promise((resolve, reject) => {
                txn.begin(120, 0, {}, (err, result) => {
                    if (err) reject(err);
                    else resolve(result);
                });
            });

            // Insert within transaction
            const inserted = await txn.insert('bench_memtx', [1, [1, 2]]);
            assert.ok(inserted, 'Insert should succeed');

            // Test commit with callback
            await new Promise((resolve, reject) => {
                txn.commit({}, (err, result) => {
                    if (err) reject(err);
                    else resolve(result);
                });
            });

            // Verify
            const results = await conn.select('bench_memtx', 'hash_idx', 1, 0, 'eq', [1]);
            assert.ok(results.some(r => r[0] === 1), 'Data should be committed');
        } catch (err) {
            console.error('❌ Transaction callback test failed:', err);
            throw err;
        }
    });

    test('should handle multiple commands in same transaction', async () => {
        try {
            const txn = conn.transaction();

            await txn.begin(120, 0);

            // Multiple inserts
            const res1 = await txn.insert('bench_memtx', [1, [1, 2]]);
            const res2 = await txn.insert('bench_memtx', [2, [2, 3]]);
            const res3 = await txn.insert('bench_memtx', [3, [3, 4]]);

            assert.ok(res1 && res2 && res3, 'All inserts should succeed');

            await txn.commit();

            // Verify all were committed
            const results = await conn.select('bench_memtx', 'hash_idx', 3, 0, 'eq', [1]);
            assert.ok(results.length > 0, 'First record should exist');
        } catch (err) {
            console.error('❌ Transaction multi-command test failed:', err);
            throw err;
        }
    });
});
