/**
 * Test suite for Pipelining Methods and PipelineResponse
 */

const { test, describe, before, after, afterEach } = require('node:test');
const assert = require('node:assert');
const TarantoolConnection = require('../lib/connection');

let conn;

const truncateSpace = async (conn, spaceName) => {
    return conn.sql(`DELETE FROM "${spaceName}" INDEXED BY "tree_idx" WHERE true`);
};

describe('Pipelining Methods', { timeout: 5000 }, () => {
    before(async () => {
        conn = new TarantoolConnection(3301, {
            lazyConnect: true
        });
        await conn.connect();
        await truncateSpace(conn, 'bench_memtx');
    });

    after(async () => {
        if (conn) {
            await conn.quit();
        }
    });

    afterEach(() => {
        return truncateSpace(conn, 'bench_memtx');
    })

    test('should queue commands in pipeline', () => {
        const pipeline = conn.pipeline();
        assert.ok(pipeline, 'Pipeline should be created');
        assert.ok(typeof pipeline.insert === 'function', 'Pipeline should have insert method');
        assert.ok(typeof pipeline.select === 'function', 'Pipeline should have select method');
        assert.ok(typeof pipeline.exec === 'function', 'Pipeline should have exec method');
    });

    test('should execute pipelined commands and return PipelineResponse', async () => {
        try {
            const firstTuple = [881, [881, 882]];
            const secondTuple = [882, [882, 883]];
            const pipelineResponse = await conn.pipeline()
                .insert('bench_memtx', firstTuple)
                .insert('bench_memtx', secondTuple)
                .select('bench_memtx', 'hash_idx', 1, 0, 'eq', [881])
                .exec();

            assert.ok(pipelineResponse, 'Pipeline response should exist');
            assert.ok(pipelineResponse instanceof TarantoolConnection.PipelineResponse, 'Response should be an instance of PipelineResponse');
            assert.strictEqual(pipelineResponse.length, 3, 'Should have 3 results');

            // Check first result (insert)
            const [err1, res1] = pipelineResponse[0];
            assert.strictEqual(err1, null, 'First insert should not have error');
            assert.deepStrictEqual(res1[0], firstTuple);

            // Check second result (insert)
            const [err2, res2] = pipelineResponse[1];
            assert.strictEqual(err2, null, 'Second insert should not have error');
            assert.deepStrictEqual(res2[0], secondTuple);

            // Check third result (select)
            const [err3, res3] = pipelineResponse[2];
            assert.strictEqual(err3, null, 'Select should not have error');
            assert.ok(Array.isArray(res3), 'Select result should be array');
        } catch (err) {
            console.error('❌ Pipeline execution test failed:', err);
            throw err;
        }
    });

    test('reuse pipeline instance', async () => {
        try {
            const pipelined = conn.pipeline();

            let firstTuple = [881, [881, 882]];
            let secondTuple = [882, [882, 883]];
            let pipelineResponse = await pipelined
                .insert('bench_memtx', firstTuple)
                .insert('bench_memtx', secondTuple)
                .select('bench_memtx', 'hash_idx', 1, 0, 'eq', [881])
                .exec();

            // Check first result (insert)
            const [err1, res1] = pipelineResponse[0];
            assert.strictEqual(err1, null, 'First insert should not have error');
            assert.deepStrictEqual(res1[0], firstTuple);

            // Check second result (insert)
            const [err2, res2] = pipelineResponse[1];
            assert.strictEqual(err2, null, 'Second insert should not have error');
            assert.deepStrictEqual(res2[0], secondTuple);

            // Check third result (select)
            const [err3, res3] = pipelineResponse[2];
            assert.strictEqual(err3, null, 'Select should not have error');
            assert.ok(Array.isArray(res3), 'Select result should be array');

            // Reuse the "pipelined" instance
            const thirdTuple = [883, [883, 884]];
            pipelineResponse = await pipelined
                .insert('bench_memtx', thirdTuple)
                .exec();

            const [err4, res4] = pipelineResponse[0];
            assert.strictEqual(err4, null, 'Thrird insert should not have error');
            assert.deepStrictEqual(res4[0], thirdTuple);
            assert.strictEqual(pipelineResponse.length, 1, 'Should have only 1 result');
        } catch (err) {
            console.error('❌ Pipeline execution test failed:', err);
            throw err;
        }
    });

    test('should support callback style in pipeline', async () => {
        try {
            let callbackCalled = false;
            let callbackError = null;
            let callbackResult = null;

            const pipelineResponse = await conn.pipeline()
                .insert('bench_memtx', [871, [871, 872]], null, (err, result) => {
                    callbackCalled = true;
                    callbackError = err;
                    callbackResult = result;
                })
                .insert('bench_memtx', [872, [872, 873]])
                .exec();

            assert.ok(pipelineResponse, 'Pipeline response should exist');
            assert.strictEqual(pipelineResponse.length, 2, 'Should have 2 results');

            // Check individual callback was called
            assert.ok(callbackCalled, 'Callback should be called');
            assert.strictEqual(callbackError, null, 'Callback error should be null');
            assert.ok(callbackResult, 'Callback result should exist');
        } catch (err) {
            console.error('❌ Pipeline callback test failed:', err);
            throw err;
        }
    });

    test('should provide "findPipelineError" and "findPipelineErrors" methods', async () => {
        const pipelineResponse = await conn.pipeline()
            .insert('bench_memtx', [861, [861, 862]])
            .select('bench_memtx', 'hash_idx', 1, 0, 'eq', [861])
            .exec();

        assert.ok(typeof pipelineResponse.findPipelineError === 'function',
            'PipelineResponse should have findPipelineError method');
        assert.ok(typeof pipelineResponse.findPipelineErrors === 'function',
            'PipelineResponse should have findPipelineErrors method');
    });

    test('Testing "findPipelineError" and "findPipelineErrors" methods', async () => {
        try {
            // All ops should succeed below
            let pipelineResponse = await conn.pipeline()
                .insert('bench_memtx', [861, [861, 862]])
                .select('bench_memtx', 'hash_idx', 1, 0, 'eq', [861])
                .exec();

            assert.ok(typeof pipelineResponse.findPipelineError === 'function',
                'PipelineResponse should have findPipelineError method');
            assert.ok(typeof pipelineResponse.findPipelineErrors === 'function',
                'PipelineResponse should have findPipelineErrors method');

            // All operations succeeded, so should return null
            let firstError = pipelineResponse.findPipelineError();
            let allErrors = pipelineResponse.findPipelineErrors();
            assert.ok(firstError === null,
                'findPipelineError should return null');
            assert.strictEqual(allErrors.length, 0)

            // Insert below should fail because of invalid space with id 12345
            pipelineResponse = await conn.pipeline()
                .insert(12345, [861, [861, 862]])
                .exec();

            firstError = pipelineResponse.findPipelineError();
            assert.strictEqual(firstError.errno, 36);
            allErrors = pipelineResponse.findPipelineErrors();
            assert.strictEqual(allErrors.length, 1);

        } catch (err) {
            console.error('❌ Pipeline "findPipelineError*" test failed:', err);
            throw err;
        }
    });

    test('should accumulate multiple buffers in large pipelines', async () => {
        try {
            const pipeline = conn.pipeline();
            assert.strictEqual(pipeline.pipelinedCommands.length, 0)

            // Add multiple operations to potentially create multiple buffers
            for (let i = 0; i < 20; i++) {
                pipeline.insert('bench_memtx', [i, [i, i + 1]]);
            }

            assert.strictEqual(pipeline.pipelinedCommands.length, 20, 'Should have 20 queued commands')

            const pipelineResponse = await pipeline.exec();

            assert.strictEqual(pipelineResponse.length, 20, 'Should have 20 results');

            // Verify all succeeded
            const errors = pipelineResponse.findPipelineErrors();
            assert.strictEqual(errors.length, 0, 'No errors should be in bulk pipeline');
        } catch (err) {
            console.error('❌ Pipeline bulk operations test failed:', err);
            throw err;
        }
    });

    test('should be flushing queued commands', async () => {
        try {
            const pipeline = conn.pipeline();
            assert.strictEqual(pipeline.pipelinedCommands.length, 0, 'Should be empty after init');

            pipeline.insert('bench_memtx', [861, [861, 862]]);
            assert.strictEqual(pipeline.pipelinedCommands.length, 1, 'Should NOT be empty after "insert" command');

            assert.ok(typeof pipeline.flushPipelined === 'function',
                'Should have flushPipelined on pipeline object');

            pipeline.flushPipelined();
            assert.strictEqual(pipeline.pipelinedCommands.length, 0, 'Should be empty after flushing');
        } catch (err) {
            console.error('❌ Empty pipeline test failed:', err);
            throw err;
        }
    });

    test('should support empty pipeline', async () => {
        try {
            const pipelineResponse = await conn.pipeline().exec();

            assert.ok(pipelineResponse instanceof TarantoolConnection.PipelineResponse, 'Should return PipelineResponse instance');
            assert.strictEqual(pipelineResponse.length, 0, 'Empty pipeline should return empty result');
        } catch (err) {
            console.error('❌ Empty pipeline test failed:', err);
            throw err;
        }
    });

    test('should access PipelineResponse via static methods', ({ skip }) => {
        try {
            const PipelineResponse = TarantoolConnection.PipelineResponse;
            
            // Static methods should be available on PipelineResponse class
            assert.ok(typeof PipelineResponse.findPipelineError === 'function',
                'Should have static findPipelineError on Connection');
            assert.ok(typeof PipelineResponse.findPipelineErrors === 'function',
                'Should have static findPipelineErrors on Connection');
        } catch (err) {
            console.error('❌ Static methods test failed:', err);
            throw err;
        }
    });
});
