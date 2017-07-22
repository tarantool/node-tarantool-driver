/* global Promise */
var net = require('net');
var _ = require('lodash');

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
  var connectionOptions = _.pick(this.options, ['port', 'host']);

  var _this = this;
  process.nextTick(function () {
    if (!_this.connecting) {
      callback(new Error('Connection is closed.'));
      return;
    }
    var socket;
    try {
      socket = net.createConnection(connectionOptions);
    } catch (err) {
      callback(err);
      return;
    }
    _this.socket = socket;
    callback(null, socket);
  });
};

module.exports = Connector;