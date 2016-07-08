var msgpack = require('msgpack5')();

// i steal it from go
const RequestCode = {
	rqConnect: 0x00, //fake for connect
	rqSelect: 0x01,
	rqInsert: 0x02,
	rqReplace: 0x03,
	rqUpdate: 0x04,
	rqDelete: 0x05,
	rqCall: 0x06,
	rqAuth: 0x07,
	rqEval: 0x08,
	rqUpsert: 0x09,
	rqDestroy: 0x100, //fake for destroy socket cmd
	rqPing: 0x40
};

const KeysCode = {
	code: 0x00,
	sync: 0x01,
	space_id: 0x10,
	index_id: 0x11,
	limit: 0x12,
	offset: 0x13,
	iterator: 0x14,
	key: 0x20,
	tuple: 0x21,
	function_name: 0x22,
	username: 0x23,
	expression: 0x27,
	def_tuple: 0x28,
	data: 0x30,
	error: 0x31
};


// https://github.com/fl00r/go-tarantool-1.6/issues/2
const IteratorsType = {
	eq: 0,
	req: 1,
	all: 2,
	lt: 3,
	le: 4,
	ge: 5,
	gt: 6,
	bitsAllSet: 7,
	bitsAnySet: 8,
	bitsAllNotSet: 9
};

const OkCode            = 0;
const NetErrCode        = 0xfffffff1;  // fake code to wrap network problems into response
const TimeoutErrCode    = 0xfffffff2;  // fake code to wrap timeout error into repsonse

const PacketLengthBytes = 5;

const Space = {
	schema: 272,
	space: 280,
	index: 288,
	func: 296,
	user: 304,
	priv: 312,
	cluster: 320
};

const IndexSpace = {
	primary: 0,
	name: 2,
	indexPrimary: 0,
	indexName: 2
};

var BufferedIterators = {};
for(t in IteratorsType)
{
  BufferedIterators[t] = new Buffer([KeysCode.iterator, IteratorsType[t], KeysCode.key]);
}

var BufferedKeys = {};
for(k in KeysCode)
{
  BufferedKeys[k] = new Buffer([KeysCode[k]]);
}

const ExportPackage = {
	RequestCode: RequestCode,
	KeysCode: KeysCode,
	IteratorsType: IteratorsType,
	OkCode: OkCode,
	passEnter: msgpack.encode('chap-sha1'),
	Space: Space,
	IndexSpace: IndexSpace,
  BufferedIterators: BufferedIterators,
  BufferedKeys: BufferedKeys
};

module.exports = ExportPackage;
