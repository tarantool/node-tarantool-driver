'use strict'
var Benchmark = require('benchmark');

var tDriver = require('../lib/connection.js');
var tConn = new tDriver({});
tConn.connect()
.then(function(){
  var suite = new Benchmark.Suite;
  suite.add('sequence', {defer: true, fn: function(defer){
    var chain = Promise.resolve();
    for (var i=0;i<5000;i++)
    {
      chain = chain.then(function(){
        return tConn.select(512, 0, 1, 0, 'eq', ['test']);
      });
    }
    chain.then(function(){ defer.resolve();});
  }});
  suite.add('paralel', {defer: true, fn: function(defer){
    var chain = Promise.resolve();
    var promises = [];
    for (var i=0;i<5000;i++)
    {
      if (i%10== 0)
      {
        let prom = promises;
        chain = chain.then(function(){ return Promise.all(prom) });
        promises = [];
      }
      promises.push(
        tConn.select(512, 0, 1, 0, 'eq', ['test'])
      );
    }

    let prom = promises;
    chain = chain.then(function(){ return Promise.all(prom) });
    chain.then(function(){ defer.resolve() });
  }});
  suite
    .on('cycle', function(event) {
      console.log(String(event.target));
    })
    .on('complete', function() {
      console.log('Fastest is ' + this.filter('fastest').map('name'));
    })
  suite.run({ 'async': true, 'queued': true });
})
