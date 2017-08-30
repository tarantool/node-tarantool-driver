/* global Promise */
'use strict';
var Benchmark = require('benchmark');
var suite = new Benchmark.Suite();
var Driver = require('../lib/connection.js');
var conn = new Driver(process.argv[process.argv.length - 1], {lazyConnect: true});
var promises;
var c = 0;

conn.connect()
	.then(function(){
		suite.add('insert', {defer: true, fn: function(defer){
			conn.insert('bench', [c++, {user: 'username', data: 'Some data.'}])
				.then(function(){defer.resolve();})
				.catch(function(e){
					console.error(e, e.stack);
					defer.reject(e);
				});
		}});
		
		suite.add('insert parallel 50', {defer: true, fn: function(defer){
			try{
				promises = [];
				for (let l=0;l<50;l++){
					promises.push(conn.insert('bench', [c++, {user: 'username', data: 'Some data.'}]));
				}
				var chain = Promise.all(promises);
				chain.then(function(){ defer.resolve(); })
					.catch(function(e){
						console.error(e, e.stack);
						defer.reject(e);
					});
				} catch(e){
					defer.reject(e);
					console.error(e, e.stack);
				}
		}});
		suite
			.on('cycle', function(event) {
				console.log(String(event.target));
			})
			.on('complete', function() {
				conn.eval('return clear()')
					.then(function(){
						console.log('complete');
						process.exit();
					})
					.catch(function(e){
						console.error(e);
					});
			})
			.run({ 'async': true, 'queued': true });
	});