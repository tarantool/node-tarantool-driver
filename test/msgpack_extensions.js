const { test, before, after } = require('node:test');
const assert = require('node:assert');
const Driver = require('../lib/connection.js');

// Connection to Tarantool instance
const tarantool = new Driver({port: 3301, host: 'localhost'}, {
	lazyConnect: true
});

// Connect to Tarantool before running all tests
before(async () => {
	try {
		await tarantool.connect();
		console.info('Connected to Tarantool');
	} catch (error) {
		console.error('Failed to connect to Tarantool:', error.message);
		throw error;
	}
});

// Disconnect after all tests are completed
after(async () => {
	try {
		await tarantool.disconnect();
		console.info('Disconnected from Tarantool');
	} catch (error) {
		console.error('Failed to disconnect from Tarantool:', error.message);
	}
});

// Test pack methods via SQL queries
test('MessagePack extensions - Testing packUuid()', async () => {
	// Valid UUID format
	const validUuid = '123e4567-e89b-12d3-a456-426614174000';
	
	try {
		const result = await tarantool.sql(
			`SELECT TYPEOF(:value) as "type", :value as "value"`,
			[{ ':value': tarantool.packUuid(validUuid) }]
		);
		assert.strictEqual(result[0].type, 'uuid', 'Should return uuid type');
		// UUID is returned as formatted string
		assert.strictEqual(result[0].value, validUuid, 'Should return same UUID value');
	} catch (error) {
		console.error('packUuid test error:', error);
		assert.fail(`packUuid test failed: ${error.message}`);
	}
});

test('MessagePack extensions - Testing packDecimal()', async () => {
	const testValues = [123, 123.45, -99.99, 0.001, BigInt(100)];

	for (const value of testValues) {
		try {
			const result = await tarantool.sql(
				`SELECT TYPEOF(:value) as "type", :value as "value"`,
				[{ ':value': tarantool.packDecimal(value) }]
			);
			assert.strictEqual(
				result[0].type,
				'decimal',
				`Should return decimal type for value ${value}`
			);
			// packDecimal(BigInt(100)) returns 100 as a number - this is acceptable
			const returnedValue = result[0].value;
			const expectedValue = typeof value === 'bigint' ? Number(value) : value;
			// For floating point comparisons, allow small precision errors
			const tolerance = Math.abs(expectedValue) * 0.0001;
			assert(
				Math.abs(returnedValue - expectedValue) <= tolerance,
				`Value mismatch for ${value}: expected ${expectedValue}, got ${returnedValue}`
			);
		} catch (error) {
			console.error(`packDecimal test failed for value ${value}:`, error);
			assert.fail(`packDecimal test failed for value ${value}: ${error.message}`);
		}
	}
});

test('MessagePack extensions - Testing packInterval()', async () => {
	const intervalObject = {
		day: 5,
		hour: 12,
		minute: 30
	};

	try {
		const result = await tarantool.sql(
			`SELECT TYPEOF(:value) as "type", :value as "value"`,
			[{ ':value': tarantool.packInterval(intervalObject) }]
		);
		assert.strictEqual(result[0].type, 'interval', 'Should return interval type');
		
		// Returned interval object may contain undefined/null for unspecified fields
		const returnedInterval = result[0].value;
		assert.strictEqual(returnedInterval.day, intervalObject.day, 'Day value should match');
		assert.strictEqual(returnedInterval.hour, intervalObject.hour, 'Hour value should match');
		assert.strictEqual(returnedInterval.minute, intervalObject.minute, 'Minute value should match');
		// Other fields might be undefined or null - that's acceptable
	} catch (error) {
		console.error('packInterval test error:', error);
		assert.fail(`packInterval test failed: ${error.message}`);
	}
});

test('MessagePack extensions - Testing packInteger()', async () => {
	const testValues = [0, Number.MIN_SAFE_INTEGER, Number.MAX_SAFE_INTEGER];

	for (const value of testValues) {
		try {
			const result = await tarantool.sql(
				`SELECT TYPEOF(:value) as "type", :value as "value"`,
				[{ ':value': tarantool.packInteger(value) }]
			);
			// packInteger should preserve integer type
			const typeResult = result[0].type;
			assert(
				typeResult === 'integer' || typeResult === 'unsigned',
				`Should return integer type for value ${value}, got ${typeResult}`
			);
			// Verify the value is returned correctly
			assert.strictEqual(result[0].value, value, `Value should match for ${value}`);
		} catch (error) {
			console.error(`packInteger test failed for value ${value}:`, error);
			assert.fail(`packInteger test failed for value ${value}: ${error.message}`);
		}
	}
});

test('MessagePack extensions - Testing packDecimal() type casting', async () => {
	// Test that packDecimal correctly preserves decimal representation
	const testValue = 123.456;
	const decimalValue = tarantool.packDecimal(testValue);
	
	try {
		const result = await tarantool.sql(
			`SELECT TYPEOF(:value) as "type", :value as "value"`,
			[{ ':value': decimalValue }]
		);
		assert.strictEqual(result[0].type, 'decimal', 'Should be decimal type');
		// Compare with tolerance for floating point precision
		const tolerance = Math.abs(testValue) * 0.0001;
		assert(
			Math.abs(result[0].value - testValue) <= tolerance,
			`Decimal value should match original: expected ${testValue}, got ${result[0].value}`
		);
	} catch (error) {
		console.error('packDecimal casting test error:', error);
		assert.fail(`packDecimal casting test failed: ${error.message}`);
	}
});

test('MessagePack extensions - Testing Date (datetime) type', async () => {
	// Validate that Date objects are correctly packed as datetime
	const testDate = new Date();

	try {
		const result = await tarantool.sql(
			`SELECT TYPEOF(:value) as "type", :value as "value"`,
			[{ ':value': testDate }]
		);
		assert.strictEqual(result[0].type, 'datetime', 'Should return datetime type');
		// Verify returned value is a Date object and matches the original timestamp
		const returnedDate = result[0].value;
		assert.ok(returnedDate instanceof Date, 'Should return Date object');
		// Compare timestamps with a small tolerance for nanosecond precision loss
		const timeDiff = Math.abs(returnedDate.getTime() - testDate.getTime());
		assert(timeDiff <= 1, `Date timestamp should match: expected ${testDate.getTime()}, got ${returnedDate.getTime()}`);
	} catch (error) {
		console.error('Date/datetime test error:', error);
		assert.fail(`Date/datetime test failed: ${error.message}`);
	}
});