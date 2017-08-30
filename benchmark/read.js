/* global Promise */
'use strict';

var exec = require('child_process').exec;
var Benchmark = require('benchmark');
var suite = new Benchmark.Suite();
var Driver = require('../lib/connection.js');
var promises;

var conn = new Driver(process.argv[process.argv.length - 1], {lazyConnect: true});

conn.connect()
	.then(function(){

		suite.add('select cb', {defer: true, fn: function(defer){
			function callback(){
				defer.resolve();
			}
			conn.selectCb(512, 0, 1, 0, 'eq', ['test'], callback, console.error);
		}});

		suite.add('select promise', {defer: true, fn: function(defer){
			conn.select(512, 0, 1, 0, 'eq', ['test'])
				.then(function(){ defer.resolve();});
		}});

		suite.add('paralell 500', {defer: true, fn: function(defer){
			try{
				promises = [];
				for (let l=0;l<500;l++){
					promises.push(conn.select(512, 0, 1, 0, 'eq', ['test']));
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

		suite.add('paralel by 10', {defer: true, fn: function(defer){
			var chain = Promise.resolve();
			try{
				for (var i=0;i<50;i++)
				{
					chain = chain.then(function(){
						promises = [];
						for (var l=0;l<10;l++){
							promises.push(
								conn.select(512, 0, 1, 0, 'eq', ['test'])
							);
						}
						return Promise.all(promises);
					});
				}

				chain.then(function(){ defer.resolve(); })
					.catch(function(e){
						console.error(e, e.stack);
					});
			} catch(e){
				console.error(e, e.stack);
			}
		}});

		suite.add('paralel by 50', {defer: true, fn: function(defer){
			var chain = Promise.resolve();
			try{
				for (var i=0;i<10;i++)
				{
					chain = chain.then(function(){
						promises = [];
						for (var l=0;l<50;l++){
							promises.push(
								conn.select(512, 0, 1, 0, 'eq', ['test'])
							);
						}
						return Promise.all(promises);
					});
				}

				chain.then(function(){ defer.resolve(); })
					.catch(function(e){
						console.error(e, e.stack);
					});
			} catch(e){
				console.error(e, e.stack);
			}
		}});
		suite
			.on('cycle', function(event) {
				console.log(String(event.target));
			})
			.on('complete', function() {
				console.log('complete');
				process.exit();
			})
			.run({ 'async': true, 'queued': true });
	});
