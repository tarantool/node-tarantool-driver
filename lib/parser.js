var { Decoder: msgpackDecoder } = require('msgpack-lite');
var tarantoolConstants = require('./const');
var { TarantoolError } = require('./utils');
var { codec } = require('./msgpack-extensions');

var decoder = new msgpackDecoder({codec});

exports._processResponse = function(buffer, offset){
  decoder.buffer = buffer;
  decoder.offset = offset || 0;
  var headers = decoder.fetch();
  var schemaId = headers[tarantoolConstants.KeysCode.schema_version]
  var reqId = headers[tarantoolConstants.KeysCode.sync]
  var code = headers[tarantoolConstants.KeysCode.code]
  var data = decoder.fetch()

  if (this.schemaId)
  {
    if (this.schemaId != schemaId)
    {
      this.schemaId = schemaId;
      this.namespace = {};
    }
  }
  else
  {
    this.schemaId = schemaId;
  }
	var task;
	for(var i = 0; i<this.commandsQueue.length; i++) {
    task = this.commandsQueue._list[(this.commandsQueue._head + i) & this.commandsQueue._capacityMask];
    if (task[1] == reqId)
    {
      this.commandsQueue.removeOne(i);
      break;
    }
  }
	var dfd = task[2];
	var success = code == 0 ? true : false;

  if (success) {
    dfd.resolve(_returnBool(task[0], data));
  }
	else {
    var tarantoolErrorObject = data[tarantoolConstants.KeysCode.iproto_error]?.[0x00]?.[0]
    var errorDecription = tarantoolErrorObject?.[0x03] || data[tarantoolConstants.KeysCode.iproto_error_24]

    if ([
      358 /* code of 'read-only' */, 
      "Can't modify data on a read-only instance - box.cfg.read_only is true",
      3859 /* code of 'bootstrap not finished' */
    ].includes(tarantoolErrorObject?.[0x02] || errorDecription)) {
      switch (this.options.nonWritableHostPolicy) {
        case 'changeAndRetry':
          var attemptsCount = task[2].attempt
          if (attemptsCount) {
            task[2].attempt++
          } else {
            task[2].attempt = 1
          }

          if (this.options.maxRetriesPerRequest <= attemptsCount) {
            return dfd.reject(new TarantoolError(errorDecription));
          }

          this.offlineQueue.push([[task[0], task[1], task[2]], task[3]]);
          return  changeHost(this, errorDecription)
        case 'changeHost':
          changeHost(this, errorDecription)
      }
    }

    dfd.reject(new TarantoolError(errorDecription));
  }
};

function _returnBool(cmd, data){
	switch (cmd){
		case tarantoolConstants.RequestCode.rqAuth:
		case tarantoolConstants.RequestCode.rqPing:
			return true;
    case tarantoolConstants.RequestCode.rqExecute:
      if (data[tarantoolConstants.KeysCode.meta]) {
        var res = [];
        var meta = data[tarantoolConstants.KeysCode.meta];
        var rows = data[tarantoolConstants.KeysCode.data];
        for (var i = 0; i < rows.length; i++) {
          var formattedRow = {};
          for (var j = 0; j < meta.length; j++ ) {
            formattedRow[meta[j][0x00]] = rows[i][j];
          }
          res.push(formattedRow);
        }
        return res;
      } else {
        return 'Affected row count: ' + (data[tarantoolConstants.KeysCode.sql_info][0x0] || 0);
      }
		default:
			return data[tarantoolConstants.KeysCode.data];
	}
}

function changeHost (self, errorDecription) {
  self.setState(512, errorDecription) // event 'changing_host'
  self.useNextReserve()
  self.disconnect(true)
}