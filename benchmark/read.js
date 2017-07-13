/* global Promise */
'use strict';

var Promise = require('bluebird');
var Benchmark = require('benchmark');
var suite = new Benchmark.Suite();

var Driver = require('../lib/connection.js');
// var DriverDenque = require('../lib/connection_denque.js');
// var DriverDenque32 = require('../lib/connection.js');

var conn = new Driver({port: 3301});
// var connDenque = new DriverDenque({port: 3301});
// var connDenque32 = new DriverDenque32({port: 3301});

var promises = [];

promises.push(conn.connect());
// promises.push(connDenque.connect());
// promises.push(connDenque32.connect());

Promise.all(promises)
	.then(function(){

		suite.add('sequence select cb', {defer: true, fn: function(defer){
			var c = 0;
			try{
				var goCycle = function(){
					c++;
					if (c>5000)
						defer.resolve();
					else
						conn.selectCb(512, 0, 1, 0, 'eq', ['test'], goCycle, console.error);
				};
				goCycle();
			} catch(e) {
				console.error(e, e.stack);
			}
		}});

		suite.add('paralell 5000', {defer: true, fn: function(defer){
			try{
				promises = [];
				for (let l=0;l<5000;l++)
					promises.push(
						conn.select(512, 0, 1, 0, 'eq', ['test'])
							.then(function(){
								// console.log('l', l);
								// console.log('c', counter++);
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

		suite.add('counter', {defer: true, fn: function(defered){
			var chain = conn.select('counter', 'primary', 1000000, 0, 'all',[]);
			chain.then(function(data){ defered.resolve();})
			.catch(console.error);
		}});

		suite.add('sequence', {defer: true, fn: function(defer){
			var chain = Promise.resolve();
			for (var i=0;i<5000;i++)
			{
				chain = chain.then(function(){
					return conn.select(512, 0, 1, 0, 'eq', ['test']);
				});
			}
			chain.then(function(){ defer.resolve();});
		}});

		suite.add('paralel by 10', {defer: true, fn: function(defer){
			var chain = Promise.resolve();
			try{
			for (var i=0;i<500;i++)
			{
					chain = chain.then(function(){
						promises = [];
						for (var l=0;l<10;l++)
						promises.push(
							conn.select(512, 0, 1, 0, 'eq', ['test'])
						);
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
			for (var i=0;i<100;i++)
			{
					chain = chain.then(function(){
						promises = [];
						for (var l=0;l<50;l++)
						promises.push(
							conn.select(512, 0, 1, 0, 'eq', ['test'])
						);
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

		// denque
		// suite.add('denque sequence select cb', {defer: true, fn: function(defer){
		// 	var c = 0;
		// 	try{
		// 		var goCycle = function(){
		// 			c++;
		// 			if (c>5000)
		// 				defer.resolve();
		// 			else
		// 				connDenque.selectCb(512, 0, 1, 0, 'eq', ['test'], goCycle, console.error);
		// 		};
		// 		goCycle();
		// 	} catch(e) {
		// 		console.error(e, e.stack);
		// 	}
		// }});

		// suite.add('denque paralell 5000', {defer: true, fn: function(defer){
		// 	try{
		// 		promises = [];
		// 		for (let l=0;l<5000;l++)
		// 			promises.push(
		// 				connDenque.select(512, 0, 1, 0, 'eq', ['test'])
		// 					.then(function(){
		// 						// console.log('l', l);
		// 						// console.log('c', counter++);
		// 						return l;
		// 					})
		// 			);
		// 		var chain = Promise.all(promises);
		// 		chain.then(function(){ defer.resolve(); })
		// 			.catch(function(e){
		// 				// defer.reject(e);
		// 				console.error(e, e.stack);
		// 			});
		// 	} catch(e){
		// 		defer.reject(e);
		// 		console.error(e, e.stack);
		// 	}
		// }});

		// suite.add('denque counter', {defer: true, fn: function(defered){
		// 	var chain = connDenque.select('counter', 'primary', 1000000, 0, 'all',[]);
		// 	chain.then(function(data){ defered.resolve();})
		// 	.catch(console.error);
		// }});

		// suite.add('denque sequence', {defer: true, fn: function(defer){
		// 	var chain = Promise.resolve();
		// 	for (var i=0;i<5000;i++)
		// 	{
		// 		chain = chain.then(function(){
		// 			return connDenque.select(512, 0, 1, 0, 'eq', ['test']);
		// 		});
		// 	}
		// 	chain.then(function(){ defer.resolve();});
		// }});

		// suite.add('denque paralel by 10', {defer: true, fn: function(defer){
		// 	var chain = Promise.resolve();
		// 	try{
		// 	for (var i=0;i<500;i++)
		// 	{
		// 			chain = chain.then(function(){
		// 				promises = [];
		// 				for (var l=0;l<10;l++)
		// 				promises.push(
		// 					connDenque.select(512, 0, 1, 0, 'eq', ['test'])
		// 				);
		// 				return Promise.all(promises);
		// 			});
		// 	}

		// 	chain.then(function(){ defer.resolve(); })
		// 	.catch(function(e){
		// 		console.error(e, e.stack);
		// 	});
		// 	} catch(e){
		// 		console.error(e, e.stack);
		// 	}
		// }});

		// suite.add('denque paralel by 50', {defer: true, fn: function(defer){
		// 	var chain = Promise.resolve();
		// 	try{
		// 	for (var i=0;i<100;i++)
		// 	{
		// 			chain = chain.then(function(){
		// 				promises = [];
		// 				for (var l=0;l<50;l++)
		// 				promises.push(
		// 					connDenque.select(512, 0, 1, 0, 'eq', ['test'])
		// 				);
		// 				return Promise.all(promises);
		// 			});
		// 	}

		// 	chain.then(function(){ defer.resolve(); })
		// 	.catch(function(e){
		// 		console.error(e, e.stack);
		// 	});
		// 	} catch(e){
		// 		console.error(e, e.stack);
		// 	}
		// }});

		//denque32
		// suite.add('denque32 sequence select cb', {defer: true, fn: function(defer){
		// 	var c = 0;
		// 	try{
		// 		var goCycle = function(){
		// 			c++;
		// 			if (c>5000)
		// 				defer.resolve();
		// 			else
		// 				connDenque32.selectCb(512, 0, 1, 0, 'eq', ['test'], goCycle, console.error);
		// 		};
		// 		goCycle();
		// 	} catch(e) {
		// 		console.error(e, e.stack);
		// 	}
		// }});

		// suite.add('denque32 paralell 5000', {defer: true, fn: function(defer){
		// 	try{
		// 		promises = [];
		// 		for (let l=0;l<5000;l++)
		// 			promises.push(
		// 				connDenque32.select(512, 0, 1, 0, 'eq', ['test'])
		// 					.then(function(){
		// 						// console.log('l', l);
		// 						// console.log('c', counter++);
		// 						return l;
		// 					})
		// 			);
		// 		var chain = Promise.all(promises);
		// 		chain.then(function(){ defer.resolve(); })
		// 			.catch(function(e){
		// 				// defer.reject(e);
		// 				console.error(e, e.stack);
		// 			});
		// 	} catch(e){
		// 		defer.reject(e);
		// 		console.error(e, e.stack);
		// 	}
		// }});

		// suite.add('denque32 counter', {defer: true, fn: function(defered){
		// 	var chain = connDenque32.select('counter', 'primary', 1000000, 0, 'all',[]);
		// 	chain.then(function(data){ defered.resolve();})
		// 	.catch(console.error);
		// }});

		// suite.add('denque32 sequence', {defer: true, fn: function(defer){
		// 	var chain = Promise.resolve();
		// 	for (var i=0;i<5000;i++)
		// 	{
		// 		chain = chain.then(function(){
		// 			return connDenque32.select(512, 0, 1, 0, 'eq', ['test']);
		// 		});
		// 	}
		// 	chain.then(function(){ defer.resolve();});
		// }});

		// suite.add('denque32 paralel by 10', {defer: true, fn: function(defer){
		// 	var chain = Promise.resolve();
		// 	try{
		// 	for (var i=0;i<500;i++)
		// 	{
		// 			chain = chain.then(function(){
		// 				promises = [];
		// 				for (var l=0;l<10;l++)
		// 				promises.push(
		// 					connDenque32.select(512, 0, 1, 0, 'eq', ['test'])
		// 				);
		// 				return Promise.all(promises);
		// 			});
		// 	}

		// 	chain.then(function(){ defer.resolve(); })
		// 	.catch(function(e){
		// 		console.error(e, e.stack);
		// 	});
		// 	} catch(e){
		// 		console.error(e, e.stack);
		// 	}
		// }});

		// suite.add('denque32 paralel by 50', {defer: true, fn: function(defer){
		// 	var chain = Promise.resolve();
		// 	try{
		// 	for (var i=0;i<100;i++)
		// 	{
		// 			chain = chain.then(function(){
		// 				promises = [];
		// 				for (var l=0;l<50;l++)
		// 				promises.push(
		// 					connDenque32.select(512, 0, 1, 0, 'eq', ['test'])
		// 				);
		// 				return Promise.all(promises);
		// 			});
		// 	}

		// 	chain.then(function(){ defer.resolve(); })
		// 	.catch(function(e){
		// 		console.error(e, e.stack);
		// 	});
		// 	} catch(e){
		// 		console.error(e, e.stack);
		// 	}
		// }});

		suite
			.on('cycle', function(event) {
				console.log(String(event.target));
			})
			.on('complete', function() {
				console.log('complete')
				// conn.destroy(true)
				// console.log('Fastest is ' + this.filter('fastest').map('name'));
			})
			.run({ 'async': true, 'queued': true });
	});
