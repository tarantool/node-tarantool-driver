var tConn = require('../lib/connection.js')
var options = {host: 'localhost', port: '3301', timeout: 0}
conn = new tConn(options);
var redisCli = require('redis').createClient();
var Redis = require('ioredis');
var redis = new Redis();

var NanoTimer = require('nanotimer');
var timerObject = new NanoTimer();

conn.connect().then(function(){
    setInterval(function(){
        timerObject.time(function(callback){
            conn.select('space17', 'primary', 1, 0, 'eq', ['C', 'C']).then(function(results){
                callback();
            }).catch(function(error){
                console.log(error);
            });
        }, '', 'm', function(time){
            // reply is null when the key is missing
            console.log('select',time);
        });
    },2000);
/*
    setInterval(function(){
        timerObject.time(function(callback){
            conn.selectCb(512, 0, 1, 0, 'eq', ['test'], function(){callback()}, console.error)
        }, '', 'm', function(time){
            console.log('cb',time);
        });
    },2000);
*/
});
/*redisCli.set('test', 1, function(err, reply){
  setInterval(function(){
    timerObject.time(function(callback){
      redisCli.get('test', function(err, reply){
        callback();
      })
    }, '', 'm', function(time){
      // reply is null when the key is missing
      console.log('redis select',time);
    });
  },2000);
});*/
/*
redis.set('test', 1, function(err, reply){
  setInterval(function(){
    timerObject.time(function(callback){
      redis.get('test', function(err, reply){
        callback();
      })
    }, '', 'm', function(time){
      // reply is null when the key is missing
      console.log('ioredis select',time);
    });
  },2000);
});
*/
