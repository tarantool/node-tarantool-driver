'use strict';
const { Bench } = require('tinybench');
const Driver = require('../lib/connection.js');
const conn = new Driver('localhost:3301', {
    lazyConnect: true
});
const connUnixPath = new Driver('/tmp/tarantoolTest.sock', {
    lazyConnect: true
});
const {format} = require('node:util');

const bench = new Bench({
    name: 'read benchmark',
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
const sqlStmt = `SELECT * FROM "bench_memtx" INDEXED BY "tree_idx" WHERE "id" = ?`;
const pipelinedTaskName = '[pipeline] - non-deferred pipelined select by 20; HASH index';

/**
 * Resets the counter variable
 */
const resetCounter = () => {
    counter = 0;
};

Promise.all([
    conn.connect(),
    connUnixPath.connect()
])
    .then(() => {
        bench
            // memtx
            .add(
                '[memtx] - select; HASH index',
                () => {
                    return conn.select('bench_memtx', 'hash_idx', 1, 0, 'eq', [counter++]);
                },
                {
                    async: true,
                    afterAll: resetCounter
                }
            )
            .add(
                '[memtx] - select; HASH index; UNIX-path socket',
                () => {
                    return connUnixPath.select('bench_memtx', 'hash_idx', 1, 0, 'eq', [counter++]);
                },
                {
                    async: true,
                    afterAll: resetCounter
                }
            )
            .add('[memtx] - non-deferred select; HASH index', () => {
                conn.select('bench_memtx', 'hash_idx', 1, 0, 'eq', [counter++]);
            }, {
                async: false,
                afterAll: resetCounter
            })
            .add('[memtx] - non-deferred select; HASH index; UNIX-path socket', () => {
                connUnixPath.select('bench_memtx', 'hash_idx', 1, 0, 'eq', [counter++]);
            }, {
                async: false,
                afterAll: resetCounter
            })
            .add('[memtx] - non-deferred select; HASH index; UNIX-path socket; using "commandTimeout" option', () => {
                connUnixPath.select('bench_memtx', 'hash_idx', 1, 0, 'eq', [counter++]);
            }, {
                async: false,
                beforeAll: () => connUnixPath.options.commandTimeout = 10000,
                afterAll: () => {
                    connUnixPath.options.commandTimeout = null;
                    resetCounter();
                }
            })
            .add(
                '[memtx] - select; TREE index',
                () => {
                    return conn.select('bench_memtx', 'tree_idx', 1, 0, 'eq', [counter++]);
                },
                {
                    async: true,
                    afterAll: resetCounter
                }
            )
            .add(
                '[memtx] - select; RTREE index',
                () => {
                    const prevC = counter;
                    counter++;
                    const nextC = counter;
                    return conn.select('bench_memtx', 'rtree_idx', 1, 0, 'ge', [prevC, nextC]);
                },
                {
                    async: true,
                    afterAll: resetCounter
                }
            )

            // vinyl
            .add('[vinyl] - select; TREE index', () => {
                return conn.select('bench_vinyl', 'tree_idx', 1, 0, 'eq', [counter++]);
            }, {
                async: true,
                afterAll: resetCounter
            })
            .add('[vinyl] - non-deferred select; TREE index', () => {
                conn.select('bench_vinyl', 'tree_idx', 1, 0, 'eq', [counter++]);
            }, {
                async: false,
                afterAll: resetCounter
            })

            // SQL
            // .add(`[SQL] - select; TREE index (memtx)`, () => {
            //     return conn.sql(sqlStmt, [counter++]);
            // }, {
            //     async: true,
            //     afterAll: resetCounter
            // })
            .add(`[SQL] - non-deferred select; TREE index (memtx)`, () => {
                conn.sql(sqlStmt, [counter++]);
            }, {
                async: false,
                afterAll: resetCounter
            })
            .add(`[SQL] - non-deferred prepared select; TREE index (memtx)`, () => {
                conn.sql(preparedStmt, [counter++]);
            }, {
                async: false,
                beforeAll: async () => {
                    preparedStmt = await conn.prepare(sqlStmt);
                },
                afterAll: resetCounter
            })

            // pipeline
            const pipelinedConn = conn.pipeline(); // it is possible to create the pipelined instance only once and reuse it in future
            bench
            .add('[pipeline] - non-deferred autopipelined select; HASH index', () => {
                conn.select('bench_memtx', 'hash_idx', 1, 0, 'eq', [counter++]);
            }, {
                async: false,
                beforeAll: () => conn.options.enableAutoPipelining = true,
                afterAll: () => conn.options.enableAutoPipelining = false
            })
            .add(pipelinedTaskName, () => {
                for (let i = 0; i < 20; i++) {
                    pipelinedConn.select('bench_memtx', 'hash_idx', 1, 0, 'eq', [counter++]);
                }
                pipelinedConn.exec();
            }, {
                async: false,
                afterAll: resetCounter
            });

        return bench.run();
    })
    .then(() => {
        // pipelined benchmark measures loops by default, but we need to count exact 'insert' requests
        const task = bench.getTask(pipelinedTaskName);
        if (task?.result?.state == 'completed') {
            const throughput = task.result.throughput;
            throughput.min = throughput.min * 20;
            throughput.mean = throughput.mean * 20;
            throughput.max = throughput.max * 20;
            throughput.p50 = throughput.p50 * 20;
        }

        console.info(`Benchmark "${bench.name}" finished, results: `)
        console.table(bench.table());

        return Promise.all([
            conn.quit(),
            connUnixPath.quit()
        ])
    })
    .catch(function (e) {
        console.error('bench failed: ', e);
    })
    .finally(async () => {
        process.exit();
    });