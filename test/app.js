/**
 * Created by klond on 05.04.15.
 */

/*eslint-env mocha */
/* global Promise */
var exec = require('child_process').exec;
var expect = require('chai').expect;
var sinon = require('sinon');
var spy = sinon.spy.bind(sinon);
var stub = sinon.stub.bind(sinon);

var fs = require('fs');
var assert = require('assert');
var TarantoolConnection = require('../lib/connection');
var mlite = require('msgpack-lite');
var conn;

describe('constructor', function () {
	it('should parse options correctly', function () {
		stub(TarantoolConnection.prototype, 'connect').returns(Promise.resolve());
		var option;
		try {
			option = getOption(6380);
			expect(option).to.have.property('port', 6380);
			expect(option).to.have.property('host', 'localhost');

			option = getOption('6380');
			expect(option).to.have.property('port', 6380);

			option = getOption(6381, '192.168.1.1');
			expect(option).to.have.property('port', 6381);
			expect(option).to.have.property('host', '192.168.1.1');

			option = getOption(6381, '192.168.1.1', {
				password: '123',
				username: 'userloser'
			});
			expect(option).to.have.property('port', 6381);
			expect(option).to.have.property('host', '192.168.1.1');
			expect(option).to.have.property('password', '123');
			expect(option).to.have.property('username', 'userloser');

			option = getOption('mail.ru:33013');
			expect(option).to.have.property('port', 33013);
			expect(option).to.have.property('host', 'mail.ru');

			option = getOption('notguest:sesame@mail.ru:3301');
			expect(option).to.have.property('port', 3301);
			expect(option).to.have.property('host', 'mail.ru');
			expect(option).to.have.property('username', 'notguest');
			expect(option).to.have.property('password', 'sesame');

			option = getOption({
				port: 6380,
				host: '192.168.1.1'
			});
			expect(option).to.have.property('port', 6380);
			expect(option).to.have.property('host', '192.168.1.1');

			option = getOption({
				port: 6380,
				host: '192.168.1.1',
				reserveHosts: ['notguest:sesame@mail.ru:3301', 'mail.ru:3301']
			});
			expect(option).to.have.property('port', 6380);
			expect(option).to.have.property('host', '192.168.1.1');
			expect(option).to.have.property('reserveHosts');
			expect(option.reserveHosts).to.deep.equal(['notguest:sesame@mail.ru:3301', 'mail.ru:3301']);
			
			option = new TarantoolConnection({
				port: 6380,
				host: '192.168.1.1',
				reserveHosts: ['notguest:sesame@mail.ru:3301', 'mail.ru:3301']
			});
			expect(option.reserve).to.deep.include(
				{
					port:	6380,
					host: '192.168.1.1',
					username: null,
					password: null
				},
				{
					port:	3301,
					host: 'mail.ru'
				},
				{
					port:	3301,
					host: 'mail.ru',
					username: 'notguest',
					password: 'sesame'
				}
			);

			option = getOption({
				port: 6380,
				host: '192.168.1.1'
			});
			expect(option).to.have.property('port', 6380);
			expect(option).to.have.property('host', '192.168.1.1');

			option = getOption({
				port: '6380'
			});
			expect(option).to.have.property('port', 6380);

			option = getOption(6380, {
				host: '192.168.1.1'
			});
			expect(option).to.have.property('port', 6380);
			expect(option).to.have.property('host', '192.168.1.1');

			option = getOption('6380', {
				host: '192.168.1.1'
			});
			expect(option).to.have.property('port', 6380);
		} catch (err) {
			TarantoolConnection.prototype.connect.restore();
			throw err;
		}
		TarantoolConnection.prototype.connect.restore();
			
		function getOption() {
			conn = TarantoolConnection.apply(null, arguments);
			return conn.options;
		}
	});

	it('should throw when arguments is invalid', function () {
		expect(function () {
			new TarantoolConnection(function () {});
		}).to.throw(Error);
	});
});

describe('reconnecting', function () {
	this.timeout(8000);
	it('should pass the correct retry times', function (done) {
		var t = 0;
		new TarantoolConnection({
			port: 1,
			retryStrategy: function (times) {
				expect(times).to.eql(++t);
				if (times === 3) {
					done();
					return;
				}
				return 0;
			}
		});
	});

	it('should skip reconnecting when retryStrategy doesn\'t return a number', function (done) {
		conn = new TarantoolConnection({
			port: 1,
			retryStrategy: function () {
				process.nextTick(function () {
					expect(conn.state).to.eql(32); // states.END == 32
					done();
				});
				return null;
			}
		});
	});

	it('should not try to reconnect when disconnected manually', function (done) {
		conn = new TarantoolConnection(33013, { lazyConnect: true });
		conn.eval('return func_foo()')
			.then(function () {
				conn.disconnect();
				return conn.eval('return func_foo()');
			})
			.catch(function (err) {
				expect(err.message).to.match(/Connection is closed/);
				done();
			});
	});
	it('should try to reconnect and then connect eventially', function (done){
		function timer(){
			return conn.ping()
							.then(function(res){
								assert.equal(res, true);
								done();
							})
							.catch(function(err){
								done(err);
							});
		}
		conn = new TarantoolConnection(33013, { lazyConnect: true });
		conn.eval('return func_foo()')
			.then(function () {
				exec('docker kill tarantool', function(error, stdout, stderr){
					if(error){
						done(error);
					}
					conn.eval('return func_foo()')
						.catch(function(err){
							expect(err.message).to.match(/connect ECONNREFUSED/);
						});
					exec('docker start tarantool', function(e, stdo, stde){
						if(error){
							done(error);
						}
						setTimeout(timer, 3000);
					});
				});
			});
	});
});

describe('multihost', function () {
	this.timeout(20000);
	after(function() {
    exec('docker start tarantool');
	});
	var t = 0;
	function timer(done, port, container){
		return conn.eval('return box.cfg').then(function(res){
			expect(res[0].listen).to.eql(port);
			if(port == '33013'){
				done();
			}
			if(container){
				exec('docker kill '+container, function(error, stdout, stderr){
					if(error){
						done(error);
					}
					conn.ping()
						.catch(function(err){
							expect(err.message).to.match(/connect ECONNREFUSED/);
							if(port == '33014'){
								exec('docker start tarantool');
								setTimeout(timer.bind(null, done, '33015', 'reserve_2'), 1000);
							} else if(port == '33015'){
								setTimeout(timer.bind(null, done, '33013'), 1000);
							}
						});
				});
			}
			if(t == 0){
				t++;
				exec('docker start tarantool');
				setTimeout(function() {
					done();
				}, 2000);
			}
		})
		.catch(function(e){
			done(e);
		});
	}
	it('should try to connect to reserve hosts after losing connection with main', function(done){
		conn = new TarantoolConnection(33013, {
			reserveHosts: ['test:test@127.0.0.1:33014', '127.0.0.1:33013'],
			attemptsBeforeReserve: 1,
			retryStrategy: function (times) {
					return Math.min(times * 500, 2000);
			}
		});
		conn.ping()
			.then(function(){
				exec('docker kill tarantool', function(error, stdout, stderr){
					if(error){
						done(error);
					}
					conn.ping().then(()=>{console.log('ping!');})
						.catch(function(err){
							expect(err.message).to.match(/connect ECONNREFUSED/);
							setTimeout(timer.bind(null, done, '33014'), 1000);
						});
				});
			})
			.catch(function(e){
				done(e);
			});
	});

	it('should try to connect to reserve hosts cyclically', function(done){
		conn = new TarantoolConnection(33013, {
			reserveHosts: ['test:test@127.0.0.1:33014', '127.0.0.1:33015'],
			attemptsBeforeReserve: 1,
			retryStrategy: function (times) {
					return Math.min(times * 500, 2000);
			}
		});
		conn.ping()
			.then(function(){
				exec('docker kill tarantool', function(error, stdout, stderr){
					if(error){
						done(error);
					}
					conn.ping().then(()=>{console.log('ping!');})
						.catch(function(err){
							expect(err.message).to.match(/connect ECONNREFUSED/);
							setTimeout(timer.bind(null, done, '33014', 'reserve'), 1000);
						});
				});
			})
			.catch(function(e){
				done(e);
			});
	});
});

describe('lazy connect', function(){
	beforeEach(function(){
		conn = new TarantoolConnection({port: 33013, lazyConnect: true, username: 'test', password: 'test'});
	});
	it('lazy connect', function(done){
		conn.connect()
			.then(function(){
				done();
			}, function(e){
				done(e);
			});
	});
	it('should be authenticated', function(done){
		conn.connect().then(function(){
			return conn.eval('return box.session.user()');
		})
		.then(function(res){
			assert.equal(res[0], 'test');
			done();
		})
		.catch(function(e){done(e);});
	});
	it('should disconnect when inited', function(done){
		conn.disconnect();
		expect(conn.state).to.eql(32); // states.END == 32
		done();
	});
	it('should disconnect', function(done){
		conn.connect()
		.then(function(res){
			conn.disconnect();
			assert.equal(conn.socket.writable, false);
			done();
		})
		.catch(function(e){done(e);});
	});
});
describe('instant connection', function(){
	beforeEach(function(){
		conn = new TarantoolConnection({port: 33013, username: 'test', password: 'test'});
	});
	it('connect', function(done){
		conn.eval('return func_arg(...)', 'connected!')
			.then(function(res){
				try{
					assert.equal(res, 'connected!');
				} catch(e){console.error(e);}
				done();
			}, function(e){
				done(e);
			});
	});
	it('should reject when connected', function (done) {
		conn.connect().catch(function (err) {
			expect(err.message).to.match(/Tarantool is already connecting\/connected/);
			done();
		});
  });
	it('should be authenticated', function(done){
		conn.eval('return box.session.user()')
			.then(function(res){
				assert.equal(res[0], 'test');
				done();
			})
			.catch(function(e){done(e);});
	});
	it('should reject when auth failed', function (done) {
		conn = new TarantoolConnection({port: 33013, username: 'userloser', password: 'test'});
		conn.eval('return func_foo()')
			.catch(function (err) {
				expect(err.message).to.match(/User 'userloser' is not found/);
				done();
			});
	});
	it('should reject command when connection is closed', function (done) {
		conn.disconnect();
		conn.eval('return func_foo()')
			.catch(function (err) {
				expect(err.message).to.match(/Connection is closed/);
				done();
			});
	});
});

describe('timeout', function(){
	it('should close the connection when timeout', function (done) {
		conn = new TarantoolConnection(33013, '192.0.0.0', {
			timeout: 1,
			retryStrategy: null
		});
		// conn.on('error', function (err) {
		// 	expect(err.message).to.eql('connect ETIMEDOUT');
		// 	if (!--pending) {
		// 		done();
		// 	}
		// });
		conn.eval('return func_foo()')
			.catch(function (err) {
				expect(err.message).to.match(/connect ETIMEDOUT/);
				done();
			});
		});
	it('should clear the timeout when connected', function (done) {
		conn = new TarantoolConnection(33013, { timeout: 10000 });
		setImmediate(function () {
			stub(conn.socket, 'setTimeout')
				.callsFake(function (timeout) {
					expect(timeout).to.eql(0);
					conn.socket.setTimeout.restore();
					done();
				});
		});
	});
});


describe('requests', function(){
	var insertTuple = [50, 10, 'my key', 30];
	before(function(done){
		console.log('before call');
		try{
			conn = new TarantoolConnection({port: 33013, username: 'test', password: 'test'});
			
			Promise.all([conn.delete(514, 0, [1]),conn.delete(514, 0, [2]),
				conn.delete(514, 0, [3]),conn.delete(514, 0, [4]),
				conn.delete(512, 0, [999])])
			.then(function(){
				return conn.call('clearaddmore');
			})
			.then(function(){
				done();
			})
			.catch(function(e){
				done(e);
			});
		}
		catch(e){
			console.log(e);
		}
	});
	it('replace', function(done){
		conn.replace(512, insertTuple)
		.then(function(a){
			assert.equal(a.length, 1);
			for (var i = 0; i<a[0].length; i++)
				assert.equal(a[0][i], insertTuple[i]);
			done();
		}, function(e){done(e);});
	});
	it('simple select', function(done){
		conn.select(512, 0, 1, 0, 'eq', [50])
		.then(function(a){
			assert.equal(a.length, 1);
			for (var i = 0; i<a[0].length; i++)
				assert.equal(a[0][i], insertTuple[i]);
			done();
		}, function(e){done(e);});
	});
	it('simple select with callback', function(done){
		conn.selectCb(512, 0, 1, 0, 'eq', [50], function(a){
			assert.equal(a.length, 1);
			for (var i = 0; i<a[0].length; i++)
				assert.equal(a[0][i], insertTuple[i]);
			done();
		}, function(e){done(e);});
	});
	it('composite select', function(done){
		conn.select(512, 1, 1, 0, 'eq', [10, 'my key'])
		.then(function(a){
			assert.equal(a.length, 1);
			for (var i = 0; i<a[0].length; i++)
				assert.equal(a[0][i], insertTuple[i]);
			done();
		}).catch(function(e){ done(e); });
	});
	it('delete', function(done){
		conn.delete(512, 0, [50])
		.then(function(a){
			assert.equal(a.length, 1);
			for (var i = 0; i<a[0].length; i++)
				assert.equal(a[0][i], insertTuple[i]);
			done();
		}).catch(function(e){ done(e); });
	});
	it('insert', function(done){
		conn.insert(512, insertTuple)
		.then(function(a){
			assert.equal(a.length, 1);
			for (var i = 0; i<a[0].length; i++)
				assert.equal(a[0][i], insertTuple[i]);
			done();
		}, function(e){done(e);});
	});
	it('dup error', function(done){
		conn.insert(512, insertTuple)
		.then(function(a){
			done(new Error('can insert'));
		}, function(e){
				assert(e instanceof Error);
				done();
			});
	});
	it('update', function(done){
		conn.update(512, 0, [50], [['+',3,10]])
		.then(function(a){
			assert.equal(a.length, 1);
			assert.equal(a[0][3], insertTuple[3]+10);
			done();
		}).catch(function(e){ done(e); });
	});
	it('a lot of insert', function(done){
		var promises = [];
		for (var i = 0; i <= 5000; i++) {
			promises.push(conn.insert(515, ['key' + i, i]));
		}
		Promise.all(promises)
			.then(function(pr){
				done();
			})
			.catch(function(e){
				done(e);
			});
	});
	it('check errors', function(done){
		conn.insert(512, ['key', 'key', 'key'])
			.then(function(){
				done(new Error('Right when need error'));
			})
			.catch(function(e){
				done();
			});
	});
	it('call print', function(done){
		conn.call('myprint', ['test'])
			.then(function(){
				done();
			})
			.catch(function(e){
				console.log(e);
				done(e);
			});
	});
	it('call batch', function(done){
		conn.call('batch', [[1], [2], [3]])
			.then(function(){
				done();
			})
			.catch(function(e){
				console.log(e);
				done(e);
			});
	});
	it('call get', function(done){
		conn.insert(514, [4])
			.then(function() {
				return conn.call('myget', 4);
			})
			.then(function(value){
				done();
			})
			.catch(function(e){
				console.log(e);
				done(e);
			});
	});
	it('get metadata space by name', function(done){
		conn._getSpaceId('batched')
			.then(function(v){
				assert.equal(v, 514);
				done();
			})
			.catch(function(e){
				done(e);
			});
	});
	it('get metadata index by name', function(done){
		conn._getIndexId(514, 'primary')
			.then(function(v){
				assert.equal(v, 0);
				done();
			})
			.catch(function(e){
				done(e);
			});
	});
	it('insert with space name', function(done){
		conn.insert('test', [999, 999, 'fear'])
			.then(function(v){
				done();
			})
			.catch(done);
	});
	it('select with space name and index name', function(done){
		conn.select('test', 'primary', 0, 0, 'all', [999])
			.then(function(){
				done();
			})
			.catch(done);
	});
	it('select with space name and index number', function(done){
		conn.select('test', 0, 0, 0, 'eq', [999])
			.then(function(){
				done();
			})
			.catch(done);
	});
	it('select with space number and index name', function(done){
		conn.select(512, 'primary', 0, 0, 'eq', [999])
			.then(function(){
				done();
			})
			.catch(done);
	});
	it('delete with name', function(done){
		conn.delete('test', 'primary', [999])
			.then(function(){
				done();
			})
			.catch(done);
	});
	it('update with name', function(done){
		conn.update('test', 'primary', [999], ['+', 1, 10])
			.then(function(){
				done();
			})
			.catch(done);
	});
	it('evaluate expression', function(done){
		conn.eval('return 2+2')
			.then(function(res){
				assert.equal(res, 4);
				done();
			})
			.catch(function(e){
				done(e);
			});
	});
	it('evaluate expression with args', function(done){
		conn.eval('return func_sum(...)', 11, 22)
			.then(function(res){
				assert.equal(res, 33);
				done();
			})
			.catch(function(e){
				done(e);
			});
	});
	it('ping', function(done){
		conn.ping()
			.then(function(res){
				assert.equal(res, true);
				done();
			})
			.catch(function(e){
				done(e);
			});
	});
});


describe('upsert', function(){
	before(function(done){
		try{
			conn = new TarantoolConnection({port: 33013,lazyConnect: true});
			conn.connect().then(function(){
				return conn._auth('test', 'test');
			}, function(e){ throw 'not connected'; })
				.then(function(){
					return Promise.all([
						conn.delete('upstest', 'primary', 1),
						conn.delete('upstest', 'primary', 2)
					]);
				})
				.then(function(){
					done();
				})
				.catch(function(e){
					done(e);
				});
		}
		catch(e){
			console.log(e);
		}
	});
	it('insert', function(done){
		conn.upsert('upstest', [['+', 3, 3]], [1, 2, 3])
			.then(function() {
				return conn.select('upstest', 'primary', 1, 0, 'eq', 1);
			})
			.then(function(tuples){
				assert.equal(tuples.length, 1);
				assert.deepEqual(tuples[0], [1, 2, 3]);
				done();
			})

			.catch(function(e){
				done(e);
			});
	});
	it('update', function(done){
		conn.upsert('upstest', [['+', 2, 2]], [2, 4, 3])
			.then(function(){
				return conn.upsert('upstest', [['+', 2, 2]], [2, 4, 3]);
			})
			.then(function() {
				return conn.select('upstest', 'primary', 1, 0, 'eq', 2)	;
			})
			.then(function(tuples){
				assert.equal(tuples.length, 1);
				assert.deepEqual(tuples[0], [2, 4, 5]);
				done();
			})

			.catch(function(e){
				done(e);
			});
	});
});
describe('connection test with custom msgpack implementation', function(){
	var customConn;
	beforeEach(function(){
		customConn = TarantoolConnection(
			{
				port: 33013,
				msgpack: {
					encode: function(obj){
						return mlite.encode(obj);
					},
					decode: function(buf){
						return mlite.decode(buf);
					}
				},
				lazyConnect: true,
				username: 'test',
				password: 'test'
			}
		);
	});
	it('connect', function(done){
		customConn.connect().then(function(){
			done();
		}, function(e){ throw 'not connected'; });
	});
	it('should be authenticated', function(done){
		conn.eval('return box.session.user()')
			.then(function(res){
				assert.equal(res[0], 'test');
				done();
			})
			.catch(function(e){done(e);});
	});
});
