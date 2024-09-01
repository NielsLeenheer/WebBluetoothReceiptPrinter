class CallbackQueue {
    constructor() {
        this._queue = [];
        this._working = false;
    }

    add(data) {
        let that = this;

        async function run() {
            if (!that._queue.length) {
                that._working = false;
                return;
            }

            that._working = true;

            let callback = that._queue.shift();
            await callback();

            run();
        }

        this._queue.push(data);

        if (!this._working) {
            run();
        }
    }

    sleep(ms) {
        this.add(() => new Promise(resolve => setTimeout(resolve, ms)));
    }
}

export default CallbackQueue;