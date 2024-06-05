/* global Promise */
var net = require('net');
var { TarantoolError } = require('./utils');

function Connector(options) {
  this.options = options;
}

Connector.prototype.disconnect = function () {
  this.connecting = false;
  if (this.socket) {
    this.socket.end();
  }
};

Connector.prototype.connect = function (callback) {
  this.connecting = true;

  var _this = this;
  process.nextTick(function () {
    if (!_this.connecting) {
      callback(new TarantoolError('Connection is closed.'));
      return;
    }
    try {
      _this.options = Object.assign({
        noDelay: true,
        keepAlive: true
      }, _this.options)
      _this.socket = net.createConnection(_this.options);
    } catch (err) {
      callback(err);
      return;
    }
    callback(null, _this.socket);
  });
};

module.exports = Connector;
