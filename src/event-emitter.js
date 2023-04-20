class EventEmitter {
    constructor(device) {
        this._events = {};
    }

    on(e, f) {
        this._events[e] = this._events[e] || [];
        this._events[e].push(f);
    }

    emit(e, ...args) {
        let fs = this._events[e];
        if (fs) {
            fs.forEach(f => {
                f(...args);
            });
        }
    }        
}

export default EventEmitter;