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
	rqCallNew: 0x0a,
	rqExecute: 0x0b,
	rqDestroy: 0x100, //fake for destroy socket cmd
	rqPing: 0x40
};

const KeysCode = {
	code: 0x00,
	sync: 0x01,
	schema_version: 0x05,
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
	iproto_error_24: 0x31,
	meta: 0x32,
	sql_text: 0x40,
	sql_bind: 0x41,
	sql_info: 0x42,
	iproto_error: 0x52
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
	space: 281,
	index: 289,
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

const tzOffsets = {
	0: "UTC",
	60: "Africa/Lagos",
	120: "Africa/Johannesburg",
	180: "Asia/Baghdad",
	210: "Asia/Tehran",
	240: "Asia/Dubai",
	270: "Asia/Kabul",
	300: "Asia/Karachi",
	330: "Asia/Kolkata",
	345: "Asia/Kathmandu",
	360: "Asia/Dhaka",
	390: "Asia/Rangoon",
	420: "Asia/Jakarta",
	480: "Asia/Shanghai",
	525: "Australia/Eucla",
	540: "Asia/Tokyo",
	570: "Australia/Darwin",
	600: "Australia/Brisbane",
	660: "Pacific/Noumea",
	690: "Pacific/Norfolk",
	720: "Pacific/Majuro",
	780: "Pacific/Tongatapu",
	840: "Pacific/Kiritimati",
	// fffffd30: "Etc/GMT+12",
	"-720": "Etc/GMT+12",
	"-660": "Pacific/Pago_Pago",
	"-600": "Pacific/Honolulu",
	"-570": "Pacific/Marquesas",
	"-540": "Pacific/Gambier",
	"-480": "Pacific/Pitcairn",
	"-420": "America/Phoenix",
	"-360": "America/Guatemala",
	"-300": "America/Bogota",
	"-270": "America/Caracas",
	"-240": "America/Santo_Domingo",
	"-210": "America/St_Johns",
	"-180": "America/Argentina/Buenos_Aires",
	"-120": "America/Noronha",
	"-60": "Atlantic/Cape_Verde"
}

const ExportPackage = {
	RequestCode: RequestCode,
	KeysCode: KeysCode,
	IteratorsType: IteratorsType,
	OkCode: OkCode,
	passEnter: Buffer.from('a9636861702d73686131', 'hex') /* from msgpack.encode('chap-sha1') */,
	Space: Space,
	IndexSpace: IndexSpace,
	BufferedIterators: BufferedIterators,
	BufferedKeys: BufferedKeys,
	tzOffsets: tzOffsets
};

module.exports = ExportPackage;