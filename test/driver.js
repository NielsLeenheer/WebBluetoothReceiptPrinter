import { expect } from 'chai';

/*
	The driver itself needs the Web Bluetooth API, which no test runner has, so it is
	mocked here. It is just enough of the API for the driver to walk through connect,
	open, subscribe, print and disconnect: a device with one service, characteristics
	that record what was written to them and hand back their notification listener, and
	a gatt object that can be disconnected.

	The mock is installed before src/main.js is imported, because the constructor of the
	driver reaches for navigator.bluetooth.
*/

const Services = {
	cat:		'0000ae30-0000-1000-8000-00805f9b34fb',
	generic:	'000018f0-0000-1000-8000-00805f9b34fb'
};

let mock = null;

function install(uuid, name) {
	let state = {
		writes:			[],
		subscribed:		[],
		listeners:		[],
		disconnects:	0,
		failNotify:		false
	};

	let characteristic = (id) => ({
		uuid: id,

		startNotifications: async () => {
			if (state.failNotify) {
				throw new Error('the characteristic refused to notify');
			}

			state.subscribed.push(id);
		},

		addEventListener: (n, f) => {
			state.listeners.push(f);
		},

		writeValueWithResponse: async (data) => {
			state.writes.push(Array.from(data));
		}
	});

	let service = {
		uuid:				uuid,
		getCharacteristic:	async (id) => characteristic(id)
	};

	state.device = {
		name:	name,
		id:		'device-1',

		gatt: {
			connect: async () => ({
				getPrimaryServices:	async () => [ service ],
				getPrimaryService:	async () => service
			}),

			disconnect: async () => {
				state.disconnects++;
			}
		}
	};

	state.emit = (bytes) => {
		let value = new DataView(Uint8Array.from(bytes).buffer);

		for (let listener of state.listeners) {
			listener({ target: { value: value } });
		}
	};

	Object.defineProperty(globalThis, 'navigator', {
		configurable:	true,

		value: {
			bluetooth: {
				addEventListener:	(n, f) => { state.disconnected = f; },
				requestDevice:		async () => state.device,
				getDevices:			async () => [ state.device ]
			}
		}
	});

	mock = state;

	return state;
}

/* A stand in for the renderer package, which this repository does not depend on */

class FakeRenderer {
	static language = 'esc-pos';

	constructor(options) {
		FakeRenderer.options = options;
	}

	render(bytes) {
		FakeRenderer.bytes = Array.from(bytes);

		return [
			{ type: 'image', width: 384, height: 1, data: new Uint8Array(48).fill(0x0f) },
			{ type: 'feed', height: 24 }
		];
	}
}

function wait(ms) {
	return new Promise(resolve => setTimeout(resolve, ms || 0));
}

/* The driver is imported once, after the first mock is in place */

install(Services.cat, 'GB01');

const { default: WebBluetoothReceiptPrinter } = await import('../src/main.js');


describe('driver', () => {

	describe('a cat printer', () => {

		it('should reject connect() without a renderer', async () => {
			let state = install(Services.cat, 'GB01');
			let printer = new WebBluetoothReceiptPrinter();
			let error = null;

			try {
				await printer.connect();
			}
			catch(e) {
				error = e;
			}

			expect(error).to.be.an.instanceof(Error);
			expect(error.message).to.contain('only supports graphics');
			expect(state.disconnects).to.equal(1);
		});

		it('should reject connect() with a renderer that is not one', async () => {
			install(Services.cat, 'GB01');

			let printer = new WebBluetoothReceiptPrinter({ renderer: class {} });
			let error = null;

			try {
				await printer.connect();
			}
			catch(e) {
				error = e;
			}

			expect(error.message).to.equal('The renderer option must be a renderer class, or a function that returns one');
		});

		it('should reject connect() when the notify characteristic refuses', async () => {
			let state = install(Services.cat, 'GB01');
			state.failNotify = true;

			let printer = new WebBluetoothReceiptPrinter({ renderer: FakeRenderer });
			let error = null;

			try {
				await printer.connect();
			}
			catch(e) {
				error = e;
			}

			expect(error.message).to.contain('notify characteristic for flow control');
			expect(state.disconnects).to.equal(1);
		});

		it('should report the language, mapping and columns of the renderer', async () => {
			install(Services.cat, 'GB01');

			let printer = new WebBluetoothReceiptPrinter({ renderer: async () => FakeRenderer });
			let connected = null;

			printer.addEventListener('connected', d => connected = d);

			await printer.connect();
			await wait();

			expect(connected).to.deep.equal({
				type:				'bluetooth',
				name:				'GB01',
				id:					'device-1',
				language:			'esc-pos',
				codepageMapping:	'epson',
				columns:			32
			});
		});

		it('should construct the renderer with the settings of the profile', async () => {
			install(Services.cat, 'GB01');

			let printer = new WebBluetoothReceiptPrinter({
				renderer:			FakeRenderer,
				rendererOptions:	{ font: 'x', width: 999, commands: [ 'cut' ] }
			});

			await printer.connect();

			expect(FakeRenderer.options).to.deep.equal({
				font:				'x',
				width:				384,
				commands:			[ 'feed' ],
				maxHeight:			256,
				codepageMapping:	'epson'
			});
		});

		it('should subscribe to the notify characteristic once', async () => {
			let state = install(Services.cat, 'GB01');
			let printer = new WebBluetoothReceiptPrinter({ renderer: FakeRenderer });

			await printer.connect();

			expect(state.subscribed).to.deep.equal([ '0000ae02-0000-1000-8000-00805f9b34fb' ]);

			await printer.listen();
			await printer.listen();

			expect(state.subscribed.length).to.equal(1);
		});

		it('should render, wrap and write one packet per write', async () => {
			let state = install(Services.cat, 'GB01');
			let printer = new WebBluetoothReceiptPrinter({ renderer: FakeRenderer });

			await printer.connect();
			await printer.print(new Uint8Array([ 0x1b, 0x40, 0x41 ]));

			expect(FakeRenderer.bytes).to.deep.equal([ 0x1b, 0x40, 0x41 ]);
			expect(state.writes.length).to.equal(11);
			expect(state.writes[0]).to.deep.equal([ 0x51, 0x78, 0xa3, 0x00, 0x01, 0x00, 0x00, 0x00, 0xff ]);
			expect(state.writes[7].slice(0, 8)).to.deep.equal([ 0x51, 0x78, 0xa2, 0x00, 0x30, 0x00, 0xf0, 0xf0 ]);
			expect(state.writes[8]).to.deep.equal([ 0x51, 0x78, 0xa1, 0x00, 0x02, 0x00, 0x18, 0x00, 0xff, 0xff ]);
			expect(state.writes[10]).to.deep.equal([ 0x51, 0x78, 0xa1, 0x00, 0x02, 0x00, 0x60, 0x00, 0xf5, 0xff ]);
		});

		it('should join everything one print() was given into one job', async () => {
			install(Services.cat, 'GB01');

			let printer = new WebBluetoothReceiptPrinter({ renderer: FakeRenderer });

			await printer.connect();
			await printer.print([ new Uint8Array([ 0x1b, 0x40 ]), [ 0x41 ], new DataView(Uint8Array.from([ 0x42 ]).buffer) ]);

			expect(FakeRenderer.bytes).to.deep.equal([ 0x1b, 0x40, 0x41, 0x42 ]);
		});

		it('should accept a DataView', async () => {
			install(Services.cat, 'GB01');

			let printer = new WebBluetoothReceiptPrinter({ renderer: FakeRenderer });
			let buffer = Uint8Array.from([ 0x00, 0x1b, 0x40, 0x41 ]).buffer;

			await printer.connect();
			await printer.print(new DataView(buffer, 1, 3));

			expect(FakeRenderer.bytes).to.deep.equal([ 0x1b, 0x40, 0x41 ]);
		});
	});

	describe('flow control', () => {

		it('should stop writing on a pause and continue on a resume', async () => {
			let state = install(Services.cat, 'GB01');
			let printer = new WebBluetoothReceiptPrinter({ renderer: FakeRenderer });

			await printer.connect();

			state.emit([ 0x51, 0x78, 0xae, 0x01, 0x01, 0x00, 0x10, 0x70, 0xff ]);

			let job = printer.print(new Uint8Array([ 0x41 ]));

			await wait(60);

			expect(state.writes.length).to.equal(0);

			state.emit([ 0x51, 0x78, 0xae, 0x01, 0x01, 0x00, 0x00, 0x00, 0xff ]);

			await job;

			expect(state.writes.length).to.equal(11);
		});

		it('should continue by itself when the resume never arrives', async () => {
			let state = install(Services.cat, 'GB01');
			let printer = new WebBluetoothReceiptPrinter({ renderer: FakeRenderer });

			await printer.connect();

			/*
				The resume timeout of the profile is three seconds, which is too long for
				a test run, so every long timer is shortened for the duration of this
				test. The short ones, which pace the writes, are left alone.
			*/

			let real = globalThis.setTimeout;

			globalThis.setTimeout = (f, ms) => real(f, ms >= 1000 ? 20 : ms);

			try {
				state.emit([ 0x51, 0x78, 0xae, 0x01, 0x01, 0x00, 0x10, 0x70, 0xff ]);

				let job = printer.print(new Uint8Array([ 0x41 ]));

				await wait(10);

				expect(state.writes.length).to.equal(0);

				await job;

				expect(state.writes.length).to.equal(11);
			}
			finally {
				globalThis.setTimeout = real;
			}
		});

		it('should settle a pending job and write nothing more when the printer goes away', async () => {
			let state = install(Services.cat, 'GB01');
			let printer = new WebBluetoothReceiptPrinter({ renderer: FakeRenderer });

			await printer.connect();

			state.emit([ 0x51, 0x78, 0xae, 0x01, 0x01, 0x00, 0x10, 0x70, 0xff ]);

			let job = printer.print(new Uint8Array([ 0x41 ]));
			let settled = false;

			job.then(() => settled = true);

			await wait(20);

			expect(settled).to.equal(false);

			await printer.disconnect();
			await job;

			expect(settled).to.equal(true);
			expect(state.writes.length).to.equal(0);

			await wait(100);

			expect(state.writes.length).to.equal(0);
		});

		it('should settle a pending job when the link drops by itself', async () => {
			let state = install(Services.cat, 'GB01');
			let printer = new WebBluetoothReceiptPrinter({ renderer: FakeRenderer });

			await printer.connect();

			state.emit([ 0x51, 0x78, 0xae, 0x01, 0x01, 0x00, 0x10, 0x70, 0xff ]);

			let job = printer.print(new Uint8Array([ 0x41 ]));

			await wait(20);

			state.disconnected({ device: state.device });

			await job;
			await wait(100);

			expect(state.writes.length).to.equal(0);
		});
	});

	describe('an ordinary printer', () => {

		it('should report no columns and chunk the job as it always did', async () => {
			let state = install(Services.generic, 'Something');
			let printer = new WebBluetoothReceiptPrinter();
			let connected = null;

			printer.addEventListener('connected', d => connected = d);

			await printer.connect();
			await wait();

			expect(connected).to.deep.equal({
				type:				'bluetooth',
				name:				'Something',
				id:					'device-1',
				language:			'esc-pos',
				codepageMapping:	'default'
			});

			await printer.print(new Uint8Array(250));

			expect(state.writes.map(i => i.length)).to.deep.equal([ 100, 100, 50 ]);
		});

		it('should subscribe to the status characteristic on listen() only', async () => {
			let state = install(Services.generic, 'Something');
			let printer = new WebBluetoothReceiptPrinter();

			await printer.connect();

			expect(state.subscribed).to.deep.equal([]);

			expect(await printer.listen()).to.equal(true);
			expect(state.subscribed).to.deep.equal([ '00002af0-0000-1000-8000-00805f9b34fb' ]);

			await printer.listen();

			expect(state.subscribed.length).to.equal(1);
		});

		it('should not read a status byte sequence as flow control', async () => {
			let state = install(Services.generic, 'Something');
			let printer = new WebBluetoothReceiptPrinter();
			let data = [];

			printer.addEventListener('data', v => data.push(v));

			await printer.connect();
			await printer.listen();

			/* The very bytes that pause a cat printer, which mean nothing here */

			state.emit([ 0x51, 0x78, 0xae, 0x01, 0x01, 0x00, 0x10, 0x70, 0xff ]);

			await printer.print(new Uint8Array(10));
			await wait();

			expect(state.writes.length).to.equal(1);
			expect(data.length).to.equal(1);
		});
	});
});
