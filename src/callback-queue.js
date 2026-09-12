class CallbackQueue {
    constructor() {
        this._queue = [];
        this._working = false;
        this._gate = null;
        this._open = null;
        this._generation = 0;
    }

    add(data) {
        let that = this;

        async function run(generation) {

            /* The queue was cleared, this run belongs to a job that no longer exists */

            if (generation !== that._generation) {
                return;
            }

            if (!that._queue.length) {
                that._working = false;
                return;
            }

            that._working = true;

            /* Wait for the gate when the queue is paused, for example by flow control */

            while (that._gate) {
                await that._gate;
            }

            if (generation !== that._generation) {
                return;
            }

            if (!that._queue.length) {
                that._working = false;
                return;
            }

            let callback = that._queue.shift();

            /*
                A callback that throws must not wedge the queue. A failing Bluetooth
                write is logged and the rest of the job is still drained, so that the
                promise of a print job always settles.
            */

            try {
                await callback();
            }
            catch(error) {
                console.log('Callback failed! ' + error);
            }

            run(generation);
        }

        this._queue.push(data);

        if (!this._working) {
            run(this._generation);
        }
    }

    sleep(ms) {
        this.add(() => new Promise(resolve => setTimeout(resolve, ms)));
    }

    pause() {
        if (!this._gate) {
            this._gate = new Promise(resolve => this._open = resolve);
        }
    }

    resume() {
        if (this._gate) {
            let open = this._open;

            this._gate = null;
            this._open = null;

            open();
        }
    }

    /*
        Throw away everything that is still waiting and start over. The generation
        counter stops the run that is in flight, so a callback that is being awaited
        right now is the last one of the old queue.
    */

    clear() {
        this._generation++;
        this._queue = [];
        this._working = false;

        this.resume();
    }

    get paused() {
        return this._gate !== null;
    }
}

export default CallbackQueue;
