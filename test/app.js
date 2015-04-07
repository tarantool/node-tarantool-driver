/**
 * Created by klond on 05.04.15.
 */
var TarantoolConnection = require('../lib/connection');

var conn = new TarantoolConnection({port: 33013, host: '95.85.55.64'});
conn.connect()
    .then(function(){
        console.log('resolve');
        conn.ping();
    }, function(e){
        console.log('reject');
    })