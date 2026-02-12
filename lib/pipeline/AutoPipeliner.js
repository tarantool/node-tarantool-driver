module.exports = class AutoPipeliner {
    queue = [];
    autoPipeliningStarted = false;

    constructor (parent) {
        this.parent = parent;
    }

    add (buffer) {
        this.queue.push(buffer);
        // check if auto pipelining is already started in order to don't execute 'setImmediate' every time
        if (!this.autoPipeliningStarted) {
            process.nextTick(() => this.process())
            this.autoPipeliningStarted = true;
        }
    }

    process () {
        const concatenatedBuffer = Buffer.concat(this.queue);
        this.reset();
        this.parent.connector.write(concatenatedBuffer, null, () => {
            this.parent.bufferPool.releaseBuffer(concatenatedBuffer);
        });
        this.autoPipeliningStarted = false;
    };

    reset () {
        this.queue = []; 
    }
}