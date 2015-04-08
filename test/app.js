/**
 * Created by klond on 05.04.15.
 */
var TarantoolConnection = require('../lib/connection');

var conn = new TarantoolConnection({port: 33013, host: '95.85.55.64'});
conn.connect()
    .then(function(){
        console.log('resolve');
        return conn.ping();
    }, function(e){
        console.log('reject');
    })
    .then(function(ss){
        console.log(ss);
        console.log('start request select')
        return conn.select(512, 0, 1, 0, 'eq', [2]);
    }, function(e){
        console.log(e);
    })
    .then(function(ff){
        console.log('select result');
        console.log(ff);
    }, function(e){
        console.log('err on select', e)
    })