/* global Promise */
'use strict';
var Benchmark = require('benchmark');
var suite = new Benchmark.Suite();
var Driver = require('../lib/connection.js');
var conn = new Driver(process.argv[process.argv.length - 1]);
var promises;

conn.on('connect', function(){
  suite.add('insert parallel 5000', {defer: true, fn: function(defer){
    try{
				promises = [];
				for (let l=0;l<5000;l++)
					promises.push(
						conn.insert('bench', [l, {user: 'username'+l, data: 'Some data.'}])
							.then(function(){
								return l;
							})
					);
				var chain = Promise.all(promises);
				chain.then(function(){ defer.resolve(); })
					.catch(function(e){
						// defer.reject(e);
						console.error(e, e.stack);
					});
			} catch(e){
				defer.reject(e);
				console.error(e, e.stack);
			}
  }});

  suite.add('update parallel 5000', {defer: true, fn: function(defer){
    try{
				promises = [];
				for (let l=0;l<5000;l++)
					promises.push(
						conn.update('bench-update', [l, {user: 'username'+l, data: 'Some data.'}])
							.then(function(){
								return l;
							})
					);
				var chain = Promise.all(promises);
				chain.then(function(){ defer.resolve(); })
					.catch(function(e){
						// defer.reject(e);
						console.error(e, e.stack);
					});
			} catch(e){
				defer.reject(e);
				console.error(e, e.stack);
			}
  }});

  suite.add('upsert parallel 5000', {defer: true, fn: function(defer){
    try{
				promises = [];
				for (let l=0;l<5000;l++)
					promises.push(
						conn.insert('bench-upsert', [l, {user: 'username'+l, data: 'Some data.'}])
							.then(function(){
								return l;
							})
					);
				var chain = Promise.all(promises);
				chain.then(function(){ defer.resolve(); })
					.catch(function(e){
						// defer.reject(e);
						console.error(e, e.stack);
					});
			} catch(e){
				defer.reject(e);
				console.error(e, e.stack);
			}
  }});
});