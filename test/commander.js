const test = require('node:test');
const assert = require('assert');
const Commander = require('../lib/Commander.js');
const { TarantoolError } = require('../lib/errors.js');

function createCommanderMock() {
    const msgpacker = {
        encode: (v) => Buffer.from(JSON.stringify(v)),
    };
    return Object.assign(new Commander(), {
        options: {},
        isConnectedState: () => true,
        msgpacker,
        _id: [0],
        streamId: 1,
        namespace: {},
        offlineQueue: { enabled: false },
        pendingPromises: {},
        sendCommand: (...args) => args,
        salt: Buffer.from('12345678901234567890').toString('base64'),
    });
}

test('Commander: _createBuffer allocates buffer', () => {
    const c = createCommanderMock();
    const buf = c._createBuffer(10);
    assert(buf instanceof Buffer);
    assert.strictEqual(buf.length, 10);
});

test('Commander: _getRequestId increments', () => {
    const c = createCommanderMock();
    const id1 = c._getRequestId();
    const id2 = c._getRequestId();
    assert.strictEqual(id2, id1 + 1);
});

test('Commander: returns error on _getSpaceId if schema not fetched', () => {
    const c = createCommanderMock();
    c.schemaFetched = false;
    assert.ok(c._getSpaceId('test') instanceof TarantoolError)
});

test('Commander: returns error on _getIndexId if schema not fetched', () => {
    const c = createCommanderMock();
    c.schemaFetched = false;
    assert.ok(c._getIndexId('space', 'idx') instanceof TarantoolError)
});