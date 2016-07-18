'use strict'
var Benchmark = require('benchmark');

var tDriver = require('../lib/connection.js');
var tConn = new tDriver({});
tConn.connect()
.then(function(){
  var suite = new Benchmark.Suite;
  suite.add('paralell 5000', {defer: true, fn: function(defer){
    try{
    var promises = [];
    for (let l=0;l<5000;l++)
      promises.push(
        tConn.select(512, 0, 1, 0, 'eq', ['test'])
          .then(function(){
            console.log('l', l);
            return l;
          })
      );
    var chain = Promise.all(promises)


    chain.then(function(){ defer.resolve() })
    .catch(function(e){
      defer.reject(e);
      console.error(e, e.stack);
    });
    } catch(e){
      defer.reject(e);
      console.error(e, e.stack);
    }
  }});
  suite.add('sequence', {defer: true, fn: function(defer){
    var chain = promise.resolve();
    for (var i=0;i<5000;i++)
    {
      chain = chain.then(function(){
        return tconn.select(512, 0, 1, 0, 'eq', ['test']);
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
          var promises = [];
          for (var l=0;l<10;l++)
          promises.push(
            tConn.select(512, 0, 1, 0, 'eq', ['test'])
          );
          return Promise.all(promises)
        });
    }

    chain.then(function(){ defer.resolve() })
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
          var promises = [];
          for (var l=0;l<50;l++)
          promises.push(
            tConn.select(512, 0, 1, 0, 'eq', ['test'])
          );
          return Promise.all(promises)
        });
    }

    chain.then(function(){ defer.resolve() })
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
      console.log('Fastest is ' + this.filter('fastest').map('name'));
    })
  suite.run({ 'async': true, 'queued': true });
})
