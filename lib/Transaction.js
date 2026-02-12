const Command = require('./Command');
const {symbols: {
    streamId: streamIdSym
}} = require('./const');

/**
 * Represents a transaction context
 */
class Transaction {
    /**
     * Creates a transaction
     * @static
     * @param {TarantoolConnection} self - Parent connection instance
     * @returns {Transaction} New transaction instance
     */
    static createTransaction = function createTransaction() {
        return new Transaction(this);
    };

    /**
     * Creates a new Transaction instance
     * @param {TarantoolConnection} self - Parent connection instance
     */
    constructor(self) {
        this.streamId = self._getRequestId();
        this._parent = self;
    }
}

Command.list.map((name) => {
    const visibleName = typeof name === 'symbol' ? name.description : name;

    Transaction.prototype[visibleName] = function commandInterceptor() {
        const optsPos = Command.commands[name].optsPos;
        const args = [...arguments];
        // if args are not empty
        if (args[optsPos]) {
            args[optsPos][streamIdSym] = this.streamId;
        } else {
            args[optsPos] = {
                [streamIdSym]: this.streamId
            };
        }

        return this._parent[name].apply(this._parent, args);
    };
});

module.exports = Transaction;
