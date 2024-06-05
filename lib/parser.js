var msgpack = require('msgpack-lite');
var tarantoolConstants = require('./const');
var { TarantoolError } = require('./utils');
var { codec } = require('./msgpackExt');

var decoder = new msgpack.Decoder({codec});

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

  if (success)
    dfd.resolve(_returnBool(task[0], data));
	else
		dfd.reject(new TarantoolError(data[tarantoolConstants.KeysCode.iproto_error]?.[0x00]?.[0]?.[0x03] || data[tarantoolConstants.KeysCode.iproto_error_24]));
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
