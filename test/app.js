/**
 * Created by klond on 05.04.15.
 */

/*eslint-env mocha */
/* global Promise */

var fs = require('fs');
var assert = require('assert');
var TarantoolConnection = require('../lib/connection');
var mlite = require('msgpack-lite');

describe('Tarantool Connection tests', function(){
	// this.timeout(20000);
	before(function(){
//		cp.execFile('./box.lua');
	});
	var conn;
	beforeEach(function(){
		conn = new TarantoolConnection({port: 33013, lazyConnect: true});
	});
	describe('connection test', function(){
		it('connect', function(done){
				conn.connect().then(function(){
				done();
			}, function(e){ throw 'not connected'; })
				.catch((e)=>{console.error(e)});
		});
		it('auth', function(done){
			conn.connect().then(function(){
				return conn._auth('test', 'test');
			}, function(e){ throw 'not connected'; })
			.then(function(){
				done();
			}, function(e){ throw 'not auth'; });
		});
		// it('reconnecting', function(){
		// 	conn.connect()
		// 		then
		// })
	});
	describe('requests', function(){
		var insertTuple = [50, 10, 'my key', 30];
		/*eslint-disable no-shadow */
		var conn;
		/*eslint-enable no-shadow */
		before(function(done){
			console.log('before call');
			// try{
			// 	conn = new TarantoolConnection({port: 33013, lazyConnect: true});
			// 	conn.connect().then(function(){
			// 		return conn._auth('test', 'test');
			// 	}, function(e){ throw 'not connected';})
			// 		.then(function(){
			// 			return Promise.all([conn.delete(514, 0, [1]),conn.delete(514, 0, [2]),
			// 				conn.delete(514, 0, [3]),conn.delete(514, 0, [4]),
			// 				conn.delete(512, 0, [999])]);
			// 		})
			// 		.then(function(){
			// 			return conn.call('clearaddmore');
			// 		})
			// 		.then(function(){
			// 			done();
			// 		})
			// 		.catch(function(e){
			// 			done(e);
			// 		});
			// }
			// catch(e){
			// 	console.log(e);
			// }
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
	});
	describe('upsert', function(){
		/*eslint-disable no-shadow */
		var conn;
		/*eslint-enable no-shadow */
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
			customConn = new TarantoolConnection(
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
		it('auth', function(done){
			return new Promise((resolve, reject) => {
				customConn.connect()
					.then(function(){
						return customConn.call('box.session.user');
					})
					.then(function(res){
						resolve(res);
					})
					.catch(function(e){reject(e);});
			})
			.then((res)=>{
				console.log(res);
			})
			.catch(function(e){done(e);});
		});
	});
});
