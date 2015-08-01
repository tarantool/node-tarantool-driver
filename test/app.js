/**
 * Created by klond on 05.04.15.
 */
var fs = require('fs');
var assert = require('assert');
var TarantoolConnection = require('../lib/connection');
//var cp = require('child_process');


describe('Tarantool Connection tests', function(){
	before(function(){
//		cp.execFile('./box.lua');
	});
	var conn;
	beforeEach(function(){
		conn = new TarantoolConnection({port: 33013, log: true});
	});
	describe('connection test', function(){
		it('connect', function(done){
				conn.connect().then(function(){
				done();
			}, function(e){ throw 'not connected'; done();});
		});
		it('auth', function(done){
			conn.connect().then(function(){
				return conn.auth('test', 'test');
			}, function(e){ throw 'not connected'; done();})
			.then(function(){
				done();
			}, function(e){ throw 'not auth'; done();})
		});
	});
	describe('requests', function(){
		var insertTuple = [50, 10, 'my key', 30];
		before(function(done){
			console.log('before call');
			try{
				Promise.all([conn.delete(514, 0, [1]),conn.delete(514, 0, [2]),conn.delete(514, 0, [3]),conn.delete(514, 0, [4]	)])
					.then(function(){
						return conn.call('clearaddmore');
					})
					.then(function(){
						done();
					})
					.catch(function(e){
						done(e);
					})
			}
			catch(e){
				console.log(e);
			}
		});
		beforeEach(function(done){
			conn.connect().then(function(){
				return conn.auth('test', 'test');
			}, function(e){ throw 'not connected'; done();})
			.then(function(){
				done();
			}, function(e){ throw 'not auth'; done();})
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
			}).catch(function(e){ done(e) });
		});
		it('a lot of insert', function(done){
			var promises = [];
			for (var i = 0; i <= 5000; i++) {
				conn.insert(515, ['key' + i, i]);
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
					done()
				})
				.catch(function(e){
					console.log(e);
					done(e);
				})
		});
		it('call batch', function(done){
			conn.call('batch', [[1], [2], [3]])
				.then(function(){
					done()
				})
				.catch(function(e){
					console.log(e);
					done(e);
				})
		});
		it('call get', function(done){
			conn.insert(514, [4])
				.then(function() {
					return conn.call('myget', 4)
				})
				.then(function(value){
					console.log('value', value);
					done()
				})
				.catch(function(e){
					console.log(e);
					done(e);
				})
		});

	});
});
