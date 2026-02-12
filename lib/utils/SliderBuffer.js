// It is faster to reuse the existing buffer than allocating a new one.

module.exports = class SliderBuffer {
    offset = 0;
    isCleanupScheduled = false;
    initialSize = 0;

    constructor (initialSize) {
        if (typeof initialSize != 'number') throw new Error(`'initialSize' should be a number`);
        if (initialSize < 2) throw new Error(`'initialSize' is too low`);

        this.initialSize = initialSize;
        this.buffer = Buffer.allocUnsafe(initialSize);
    }

    getBuffer (size) {
        if (size > this.buffer.length - this.offset) {
            this.buffer = Buffer.allocUnsafe(this.buffer.length * 2);
            this.offset = 0;
            this.scheduleCleanup()
        }

        return this.buffer.subarray(this.offset, this.offset += size);
    }

    scheduleCleanup() {
        if (!this.isCleanupScheduled) {
            this.isCleanupScheduled = true;
            setImmediate(() => {
                this.cleanupCache();
                this.isCleanupScheduled = false;
            });
        }
    }

    cleanupCache() {
        this.buffer = Buffer.allocUnsafe(this.initialSize);
        this.offset = 0;
    }

    releaseBuffer(buffer) {
        if (buffer.length > this.buffer.length) this.buffer = buffer;
    }
}