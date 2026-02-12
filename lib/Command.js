const { prototype } = require('./Commander');
const {
    RequestCode,
    symbols: { begin: beginSym, commit: commitSym, rollback: rollbackSym }
} = require('./const');

const cmds = [
    {
        flags: ['readonly'],
        rqCode: RequestCode.rqSelect,
        function: prototype.select,
        argsLen: 7,
        methodName: 'select'
    },
    {
        flags: ['write'],
        rqCode: RequestCode.rqInsert,
        function: prototype.insert,
        argsLen: 3,
        methodName: 'insert'
    },
    {
        flags: ['no_auth', 'readonly'],
        rqCode: RequestCode.rqPing,
        function: prototype.ping,
        argsLen: 1,
        methodName: 'ping'
    },
    {
        flags: ['no_auth', 'readonly'],
        rqCode: RequestCode.rqAuth,
        function: prototype._auth,
        argsLen: 3,
        methodName: '_auth'
    },
    {
        flags: ['transaction'],
        rqCode: RequestCode.rqBegin,
        function: prototype[beginSym],
        argsLen: 3,
        methodName: beginSym
    },
    {
        flags: ['transaction'],
        rqCode: RequestCode.rqCommit,
        function: prototype[commitSym],
        argsLen: 1,
        methodName: commitSym
    },
    {
        flags: ['transaction'],
        rqCode: RequestCode.rqRollback,
        function: prototype[rollbackSym],
        argsLen: 1,
        methodName: rollbackSym
    },
    {
        flags: ['write'],
        rqCode: RequestCode.rqDelete,
        function: prototype.delete,
        argsLen: 4,
        methodName: 'delete'
    },
    {
        flags: ['write'],
        rqCode: RequestCode.rqUpdate,
        function: prototype.update,
        argsLen: 5,
        methodName: 'update'
    },
    {
        flags: ['write'],
        rqCode: RequestCode.rqUpsert,
        function: prototype.upsert,
        argsLen: 4,
        methodName: 'upsert'
    },
    {
        flags: ['script'],
        rqCode: RequestCode.rqEval,
        function: prototype.eval,
        argsLen: 3,
        methodName: 'eval'
    },
    {
        flags: ['script'],
        rqCode: RequestCode.rqCall,
        function: prototype.call,
        argsLen: 3,
        methodName: 'call'
    },
    {
        flags: ['script', 'sql'],
        rqCode: RequestCode.rqExecute,
        function: prototype.sql,
        argsLen: 3,
        methodName: 'sql'
    },
    {
        flags: ['script', 'sql'],
        rqCode: RequestCode.rqPrepare,
        function: prototype.prepare,
        argsLen: 2,
        methodName: 'prepare'
    },
    {
        flags: ['readonly', 'no_auth'],
        rqCode: RequestCode.rqId,
        function: prototype.id,
        argsLen: 4,
        methodName: 'id'
    },
    {
        flags: ['write'],
        rqCode: RequestCode.rqReplace,
        function: prototype.replace,
        argsLen: 3,
        methodName: 'replace'
    }
];
// calculate 'opts' position in advance
cmds.map((obj) => {
    obj.optsPos = obj.argsLen - 1;
});

module.exports = class Commands {
    static list = cmds.map((obj) => obj.methodName);
    static commands = Object.fromEntries(
        cmds.map((obj) => [obj.methodName, obj])
    );
    static commandsNum = Object.fromEntries(
        cmds.map((obj) => [obj.rqCode, obj])
    );

    constructor() {}

    static hasFlag(cmdName, flag) {
        return Commands.commands[cmdName]?.flags?.includes(flag);
    }
};
