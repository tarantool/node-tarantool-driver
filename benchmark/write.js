'use strict';
const { Bench } = require('tinybench');
const Driver = require('../lib/connection.js');
const conn = new Driver(process.argv[process.argv.length - 1], {
    lazyConnect: true
});
const {format} = require('node:util');
const {noop} = require('lodash');

/**
 * Truncates a space by deleting all records
 * @async
 * @param {string} spaceName - Name of the space to truncate
 * @returns {Promise}
 */
const truncateSpace = async (spaceName) => {
    return conn.sql(`DELETE FROM "${spaceName}" INDEXED BY "tree_idx" WHERE true`);
};

/**
 * Truncates all benchmark spaces
 * @async
 * @returns {Promise}
 */
const truncateAll = async () => {
    return Promise.all([
        truncateSpace('bench_memtx'),
        truncateSpace('bench_vinyl')
    ]) 
};

/**
 * Awaits for all sent commands to be drained
 * @async
 * @returns {Promise}
 */
const awaitCommandsDrain = async () => {
    return conn._awaitSentCommandsDrain().catch(noop);
};

const bench = new Bench({
    name: 'write benchmark',
    iterations: 10000,
    setup: (task) => {
        console.info(
            format('starting task "%s"', task.name)
        );
    },
    warmup: false,
    threshold: 1,
    concurrency: null
});

bench.addEventListener('cycle', (evt) => {
    const result = evt.task.result;
    if (result.state != 'completed') return;

    console.info(`\x1b[36mCompleted task\x1b[0m "${evt.task.name}":`);
    console.info(`  Latency: ${result.latency.mean.toFixed(5)} ms (min: ${result.latency.min.toFixed(5)}, max: ${result.latency.max.toFixed(5)})`);
    console.info(`  Throughput: ${Math.floor(result.throughput.mean)} ops/s`);
});

let counter = 0;
let preparedStmt;
const sqlStmt = `INSERT INTO "bench_memtx" VALUES (?, ?)`;
const pipelinedTaskName = '[pipelined] - non-deferred insert by 20';

conn.connect()
.then(() => {
    return truncateAll();
})
    .then(async () => {
        bench
            // memtx
            .add(
                '[memtx] - insert',
                () => {
                    const prevC = counter;
                    counter++;
                    const nextC = counter;
                    return conn.insert('bench_memtx', [prevC, [prevC, nextC]]);
                },
                {
                    async: true,
                    afterAll: awaitCommandsDrain
                }
            )
            .add('[memtx] - non-deferred insert', () => {
                const prevC = counter;
                counter++;
                const nextC = counter;
                conn.insert('bench_memtx', [prevC, [prevC, nextC]]);
            }, {
                async: false,
                afterAll: async () => {
                    await conn._awaitSentCommandsDrain().catch(noop); // prevent unexpected race conditions of non-deferred task
                    return truncateSpace('bench_memtx')
                }
            })

            // vinyl
            .add('[vinyl] - insert', () => {
                const prevC = counter;
                counter++;
                const nextC = counter;
                return conn.insert('bench_vinyl', [prevC, [prevC, nextC]]);
            }, {
                async: true,
                beforeAll: () => counter = 0,
                afterAll: awaitCommandsDrain
            })
            .add('[vinyl] - non-deferred insert', () => {
                const prevC = counter;
                counter++;
                const nextC = counter;
                conn.insert('bench_vinyl', [prevC, [prevC, nextC]]);
            }, {
                async: false,
                afterAll: async () => {
                    counter = 0;
                    await conn._awaitSentCommandsDrain().catch(noop);
                }
            })

            // SQL
            .add(`[SQL] - insert (memtx)`, () => {
                const prevC = counter;
                counter++;
                const nextC = counter;
                return conn.sql(sqlStmt, [prevC, [prevC, nextC]]);
            }, {
                async: true,
                afterAll: awaitCommandsDrain
            })
            .add(`[SQL] - non-deferred insert (memtx)`, () => {
                const prevC = counter;
                counter++;
                const nextC = counter;
                conn.sql(sqlStmt, [prevC, [prevC, nextC]]);
            }, {
                async: false,
                afterAll: awaitCommandsDrain
            })
            .add(`[SQL] - non-deferred prepared insert (memtx)`, () => {
                const prevC = counter;
                counter++;
                const nextC = counter;
                conn.sql(preparedStmt, [prevC, [prevC, nextC]]);
            }, {
                async: false,
                beforeAll: async () => {
                    preparedStmt = await conn.prepare(sqlStmt);
                },
                afterAll: async () => {
                    counter = 0;
                    await conn._awaitSentCommandsDrain().catch(noop); // prevent unexpected race conditions of non-deferred task
                    return truncateSpace('bench_memtx')
                }
            })

            // pipeline
            const pipelinedConn = conn.pipeline(); // it is possible to create the pipelined instance only once and reuse it in future
            bench
            .add('[pipeline] - non-deferred autopipelined insert', () => {
                const prevC = counter;
                counter++;
                const nextC = counter;
                conn.insert('bench_memtx', [prevC, [prevC, nextC]]);
            }, {
                async: false,
                beforeAll: () => conn.options.enableAutoPipelining = true,
                afterAll: () => conn.options.enableAutoPipelining = false
            })
            .add(pipelinedTaskName, () => {
                for (let i = 0; i < 20; i++) {
                    const prevC = counter;
                    counter++;
                    const nextC = counter;
                    pipelinedConn.insert('bench_memtx', [prevC, [prevC, nextC]]);
                }
                pipelinedConn.exec();
            }, {
                async: false
            });

        return bench.run();
    })
    .then(() => {
        // pipelined benchmark measures loops by default, but we need to count exact 'insert' requests
        const task = bench.getTask(pipelinedTaskName);
        if (task && task.result) {
            const throughput = task.result.throughput;
            throughput.min = throughput.min * 20;
            throughput.mean = throughput.mean * 20;
            throughput.max = throughput.max * 20;
            throughput.p50 = throughput.p50 * 20;
        }

        console.info(`Benchmark "${bench.name}" finished, results: `, bench.table())
    })
    .catch(function (e) {
        console.error('bench failed: ', e);
    })
    .finally(async () => {
        await conn.disconnect();
        process.exit();
    });