/*eslint-env mocha */
/* global Promise */
var expect = require('chai').expect;

var assert = require('assert');
var TarantoolConnection = require('../lib/connection');

describe.only('Tarantool errors', function(){
	// this.timeout(20000);
	// var conn;
	// beforeEach(function(){
	// 	conn = new TarantoolConnection({port: 33013});
  // });
  it('should reject when connected', function (done) {
    var conn = new TarantoolConnection({port: 33013});
    conn.connect().catch(function (err) {
      expect(err.message).to.match(/Tarantool is already connecting\/connected/);
      done();
    });
  });

});