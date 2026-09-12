import { expect } from 'chai';
import CallbackQueue from '../src/callback-queue.js';

/*
	The queue is plain promises, so it can be tested without a browser. The gate is what
	the flow control of the cat printers uses: the printer asks the driver to stop
	writing, the driver pauses the queue, and the queue waits before the next callback
	instead of losing it.
*/

function tick() {
	return new Promise(resolve => setTimeout(resolve, 0));
}


describe('callback-queue', () => {

	describe('add()', () => {

		it('should run the callbacks in order', async () => {
			let queue = new CallbackQueue();
			let order = [];

			queue.add(() => { order.push(1); });
			queue.add(() => { order.push(2); });
			queue.add(async () => { await tick(); order.push(3); });
			queue.add(() => { order.push(4); });

			await tick();
			await tick();

			expect(order).to.deep.equal([ 1, 2, 3, 4 ]);
		});

		it('should keep draining after a callback that rejects', async () => {
			let queue = new CallbackQueue();
			let order = [];

			queue.add(() => { order.push(1); });
			queue.add(() => Promise.reject(new Error('the printer went away')));
			queue.add(() => { order.push(3); });

			await tick();
			await tick();
			await tick();

			expect(order).to.deep.equal([ 1, 3 ]);
		});

		it('should keep draining after a callback that throws', async () => {
			let queue = new CallbackQueue();
			let order = [];

			queue.add(() => { throw new Error('boom'); });
			queue.add(() => { order.push(2); });

			await tick();
			await tick();

			expect(order).to.deep.equal([ 2 ]);
		});

		it('should accept new callbacks after a failing one', async () => {
			let queue = new CallbackQueue();
			let order = [];

			queue.add(() => { throw new Error('boom'); });

			await tick();
			await tick();

			queue.add(() => { order.push(1); });

			await tick();

			expect(order).to.deep.equal([ 1 ]);
		});

		it('should keep running when something is added later', async () => {
			let queue = new CallbackQueue();
			let order = [];

			queue.add(() => { order.push(1); });

			await tick();

			queue.add(() => { order.push(2); });

			await tick();

			expect(order).to.deep.equal([ 1, 2 ]);
		});
	});

	describe('pause() and resume()', () => {

		it('should not run anything while it is paused', async () => {
			let queue = new CallbackQueue();
			let order = [];

			queue.pause();

			queue.add(() => { order.push(1); });
			queue.add(() => { order.push(2); });

			await tick();
			await tick();

			expect(order).to.deep.equal([]);

			queue.resume();

			await tick();
			await tick();

			expect(order).to.deep.equal([ 1, 2 ]);
		});

		it('should stop before the next callback when it is paused halfway', async () => {
			let queue = new CallbackQueue();
			let order = [];

			queue.add(async () => { order.push(1); queue.pause(); });
			queue.add(() => { order.push(2); });

			await tick();
			await tick();

			expect(order).to.deep.equal([ 1 ]);

			queue.resume();

			await tick();

			expect(order).to.deep.equal([ 1, 2 ]);
		});

		it('should stay paused when it is paused again before the resume', async () => {
			let queue = new CallbackQueue();
			let order = [];

			queue.pause();
			queue.pause();

			queue.add(() => { order.push(1); });

			await tick();

			expect(order).to.deep.equal([]);

			queue.resume();

			await tick();

			expect(order).to.deep.equal([ 1 ]);
		});

		it('should ignore a resume when it is not paused', async () => {
			let queue = new CallbackQueue();
			let order = [];

			queue.resume();
			queue.add(() => { order.push(1); });

			await tick();

			expect(order).to.deep.equal([ 1 ]);
			expect(queue.paused).to.equal(false);
		});

		it('should report whether it is paused', () => {
			let queue = new CallbackQueue();

			expect(queue.paused).to.equal(false);

			queue.pause();

			expect(queue.paused).to.equal(true);

			queue.resume();

			expect(queue.paused).to.equal(false);
		});
	});

	describe('clear()', () => {

		it('should throw away everything that is still waiting', async () => {
			let queue = new CallbackQueue();
			let order = [];

			queue.add(async () => { order.push(1); await tick(); });
			queue.add(() => { order.push(2); });
			queue.add(() => { order.push(3); });

			queue.clear();

			await tick();
			await tick();
			await tick();

			expect(order).to.deep.equal([ 1 ]);
		});

		it('should open the gate', async () => {
			let queue = new CallbackQueue();

			queue.pause();
			queue.clear();

			expect(queue.paused).to.equal(false);
		});

		it('should run what is added after it', async () => {
			let queue = new CallbackQueue();
			let order = [];

			queue.pause();
			queue.add(() => { order.push(1); });
			queue.clear();
			queue.add(() => { order.push(2); });

			await tick();
			await tick();

			expect(order).to.deep.equal([ 2 ]);
		});

		it('should not let a cleared job continue when the gate opens', async () => {
			let queue = new CallbackQueue();
			let order = [];

			queue.add(() => { order.push(1); });
			queue.add(() => { order.push(2); });
			queue.pause();

			await tick();

			queue.clear();

			await tick();
			await tick();

			expect(order).to.deep.equal([ 1 ]);
		});
	});

	describe('sleep()', () => {

		it('should wait between two callbacks', async () => {
			let queue = new CallbackQueue();
			let order = [];

			queue.add(() => { order.push(1); });
			queue.sleep(20);
			queue.add(() => { order.push(2); });

			await tick();

			expect(order).to.deep.equal([ 1 ]);

			await new Promise(resolve => setTimeout(resolve, 40));

			expect(order).to.deep.equal([ 1, 2 ]);
		});
	});

});
