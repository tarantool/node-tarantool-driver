var net = require('net');
var _ = require('lodash');

function Connector(options) {
  this.options = options;
  this.socket = new net.Socket({
    readable: true,
    writable: true
  });
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
      callback(new Error(utils.CONNECTION_CLOSED_ERROR_MSG));
      return;
    }
    try {
      this.socket.connect({port: this.options.port, host: this.options.host});
    } catch (err) {
      callback(err);
      return;
    }
    callback(null, _this.socket);
  });
};

Connector.prototype.auth = function(username, password){
    return new Promise(function (resolve, reject) {
        var reqId = requestId.getId();
        var header = this._header(tarantoolConstants.RequestCode.rqAuth, reqId);
        var buffered = {
            username: this.msgpack.encode(username)
        };
        var scrambled = scramble(password, this.salt);
        var body = Buffer.concat([new Buffer([0x82, tarantoolConstants.KeysCode.username]), buffered.username,
            new Buffer([0x21, 0x92]), tarantoolConstants.passEnter, new Buffer([0xb4]), scrambled]);
        this._request(header, body);
        this.commandsQueue.push([tarantoolConstants.RequestCode.rqAuth, reqId, {resolve: resolve, reject: reject}]);
    }.bind(this));
};

module.exports = Connector;