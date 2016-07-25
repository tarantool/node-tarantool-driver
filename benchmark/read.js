'use strict'
var Benchmark = require('benchmark');
var fs = require('fs');

var tDriver = require('../lib/connection.js');
var promises = [];
if (fs.existsSync('../../old_tnt/lib/connection.js')){
	var oldDriver = require('../../old_tnt/lib/connection.js');
	var oldConn = new oldDriver({port: 3301});
	promises.push(oldConn.connect());
}

var tConn = new tDriver({});
promises.push(tConn.connect());
Promise.all(promises)
.then(function(){
  var suite = new Benchmark.Suite;
  suite.add('sequence select cb', {defer: true, fn: function(defer){
    var c = 0;
    try{
    var goCycle = function(){
      c++;
      if (c>5000)
        defer.resolve();
      else
        tConn.selectCb(512, 0, 1, 0, 'eq', ['test'], goCycle, console.error);

    }
    goCycle();
    } catch(e){
      console.error(e, e.stack);
    }
  }});
  suite.add('paralell 5000', {defer: true, fn: function(defer){
    try{
    var promises = [];
    for (let l=0;l<5000;l++)
      promises.push(
        tConn.select(512, 0, 1, 0, 'eq', ['test'])
          .then(function(){
//            console.log('l', l);
//            console.log('c', counter++);
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
  suite.add('counter', {defer: true, fn: function(defer){
    var chain = tConn.select('counter', 'primary', 1000000, 0, 'all',[]);
    chain.then(function(data){ defer.resolve();})
    .catch(console.error);
  }});
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
  if (oldDriver)
  {
  suite.add('old paralell 5000', {defer: true, fn: function(defer){
    try{
    var promises = [];
    for (let l=0;l<5000;l++)
      promises.push(
        oldConn.select(512, 0, 1, 0, 'eq', ['test'])
          .then(function(){
//            console.log('l', l);
//            console.log('c', counter++);
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
  suite.add('old counter', {defer: true, fn: function(defer){
    var chain = oldConn.select('counter', 'primary', 1000000, 0, 'all',[]);
    chain.then(function(){ defer.resolve();});
  }});
  suite.add('old sequence', {defer: true, fn: function(defer){
    var chain = Promise.resolve();
    for (var i=0;i<5000;i++)
    {
      chain = chain.then(function(){
        return oldConn.select(512, 0, 1, 0, 'eq', ['test']);
      });
    }
    chain.then(function(){ defer.resolve();});
  }});
  suite.add('old paralel by 10', {defer: true, fn: function(defer){
    var chain = Promise.resolve();
    try{
    for (var i=0;i<500;i++)
    {
        chain = chain.then(function(){
          var promises = [];
          for (var l=0;l<10;l++)
          promises.push(
            oldConn.select(512, 0, 1, 0, 'eq', ['test'])
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
  suite.add('old paralel by 50', {defer: true, fn: function(defer){
    var chain = Promise.resolve();
    try{
    for (var i=0;i<100;i++)
    {
        chain = chain.then(function(){
          var promises = [];
          for (var l=0;l<50;l++)
          promises.push(
            oldConn.select(512, 0, 1, 0, 'eq', ['test'])
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
  }
  suite
    .on('cycle', function(event) {
      console.log(String(event.target));
    })
    .on('complete', function() {
      console.log('Fastest is ' + this.filter('fastest').map('name'));
    })
  suite.run({ 'async': true, 'queued': true });
})
