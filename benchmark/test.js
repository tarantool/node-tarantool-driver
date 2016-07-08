'use strict'
var tDriver = require('../lib/connection.js');
var tConn = new tDriver({});
tConn.connect()
.then(function(){
  console.log('sequence start');
  console.time('seq');
  var chain = Promise.resolve();
  for (var i=0;i<100000;i++)
  {
    chain = chain.then(function(){
      return tConn.upsert('counter', [['+',1,1]], ['test', 1]);
    });
  }
  return chain;
})
.then(function(){
  console.timeEnd('seq');
  console.log('sequence end');
//  console.log('paralel start');
//  console.time('paralel')
//  var promises = [];
//  for (var i=0;i<100000;i++)
//  {
//    promises.push(
//      tConn.upsert('counter', [['+',1,1]], ['test', 1])
//    );
//  }
//  return Promise.all(promises);
//})
//.then(function(){
//  console.timeEnd('paralel');
//  console.log('paralel end');
  console.log('paralel chain by 10 start');
  console.time('paralel_chain')
  var chain = Promise.resolve();
  var promises = [];
  for (var i=0;i<100000;i++)
  {
    if (i%10 == 0)
    {
      let prom = promises;
      chain = chain.then(function(){ return Promise.all(prom) });
      promises = [];
    }
    promises.push(
      tConn.upsert('counter', [['+',1,1]], ['test', 1])
    );
  }

  let prom = promises;
  chain = chain.then(function(){ return Promise.all(prom) });
  return chain;
})
.then(function(){
  console.timeEnd('paralel_chain')
  console.log('paralel chain by 10 end');
  console.log('paralel chain by 50 start');
  console.time('paralel_chain50')
  var chain = Promise.resolve();
  var promises = [];
  for (var i=0;i<100000;i++)
  {
    if (i%50== 0)
    {
      let prom = promises;
      chain = chain.then(function(){ return Promise.all(prom) });
      promises = [];
    }
    promises.push(
      tConn.upsert('counter', [['+',1,1]], ['test', 1])
    );
  }

  let prom = promises;
  chain = chain.then(function(){ return Promise.all(prom) });
  return chain;
})
.then(function(){
  console.timeEnd('paralel_chain50')
  console.log('paralel chain by 50 end');
})
.catch(function(e){
  console.error(e, e.stack);
});
