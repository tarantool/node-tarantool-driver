var msgpack = require('msgpack-lite');
var debug = require('debug')('tarantool-driver:response');
var tarantoolConstants = require('./const');
var utils = require('./utils');
var Decoder = msgpack.Decoder;
var decoder = new Decoder();

exports._processResponse =  function(buffer, offset){
  offset=offset||0;
  decoder.buffer = buffer;
  decoder.offset = offset+23;
  var obj = decoder.fetch();
  var schemaId = buffer.readUInt32BE(offset+19);
  var reqId = buffer.readUInt32BE(offset+13);
  var code = buffer.readUInt32BE(offset+3);
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
    dfd.resolve(_returnBool(task[0], obj));
	else
		dfd.reject(new utils.TarantoolError(obj[tarantoolConstants.KeysCode.error]));
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
          let formattedRow = {};
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
