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
		failNotify:		false,
		withoutResponse: false,
		unacknowledged:	[]
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

		/* The MX10 only allows writes without a response on its print characteristic */

		get properties() {
			return state.withoutResponse ?
				{ write: false, writeWithoutResponse: true, notify: true } :
				{ write: true, writeWithoutResponse: true, notify: true };
		},

		writeValueWithResponse: async (data) => {
			if (state.withoutResponse) {
				throw new Error('GATT operation failed for unknown reason.');
			}

			state.writes.push(Array.from(data));

			/* A test can answer a write, the way the printer answers with flow control */

			if (state.onWrite) {
				state.onWrite(state.writes.length);
			}
		},

		writeValueWithoutResponse: async (data) => {
			state.unacknowledged.push(Array.from(data));
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

/*
	A stand in for the renderer package, which this repository does not depend on. The
	class announces the languages it can encode, the instance is the one the driver asked
	for with the language option.
*/

class FakeRenderer {
	static languages = [ 'esc-pos', 'star-prnt', 'star-line' ];

	#language;

	constructor(options) {
		FakeRenderer.options = options;

		this.#language = options.language;
	}

	get language() {
		return this.#language;
	}

	render(bytes) {
		FakeRenderer.bytes = Array.from(bytes);

		return [
			{ type: 'image', width: 384, height: 1, data: new Uint8Array(48).fill(0x0f) },
			{ type: 'feed', height: 24 }
		];
	}
}

/*
	A renderer with more rows than fit in one write. The rows are 0x0f bytes, four dots on
	and four off, which needs 96 bytes of runs and is therefore sent as a raw row of 48
	bytes in a packet of 56, so the batches are the ones counted in the test below.
*/

class TallFakeRenderer {
	static languages = [ 'esc-pos' ];

	#language;

	constructor(options) {
		this.#language = options.language;
	}

	get language() {
		return this.#language;
	}

	render() {
		return [
			{ type: 'image', width: 384, height: 10, data: new Uint8Array(480).fill(0x0f) },
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

		it('should report its own language and pass the bytes through without a renderer', async () => {
			let state = install(Services.cat, 'GB01');
			let printer = new WebBluetoothReceiptPrinter();
			let connected = null;

			printer.addEventListener('connected', d => connected = d);

			await printer.connect();
			await wait();

			/* No renderer, so no columns and the protocol of the printer as the language */

			expect(connected).to.deep.equal({
				type:				'bluetooth',
				name:				'GB01',
				id:					'device-1',
				language:			'meow',
				codepageMapping:	'default'
			});

			await printer.print(new Uint8Array(250));

			/* The bytes of the application, chunked by the messageSize of the profile */

			expect(state.writes.map(i => i.length)).to.deep.equal([ 200, 50 ]);
			expect(state.disconnects).to.equal(0);
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

			expect(error.message).to.equal('The renderer option must be the ReceiptPrinterRenderer class, or a function that returns it');
		});

		it('should take the connection down when the notify characteristic refuses', async () => {
			let state = install(Services.cat, 'GB01');
			state.failNotify = true;

			let printer = new WebBluetoothReceiptPrinter({ renderer: FakeRenderer });
			let connected = null;

			printer.addEventListener('connected', d => connected = d);

			await printer.connect();
			await wait();

			/*
				Flow control is not optional on this link, so a subscription that fails
				fails the connection. It is not a mistake of the application, so it is
				logged like every other failure to connect rather than thrown.
			*/

			expect(connected).to.equal(null);
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
				language:			'esc-pos',
				width:				384,
				commands:			[ 'feed' ],
				maxHeight:			256,
				feedThreshold:		4,
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

		it('should render, wrap and batch the packets into one write', async () => {
			let state = install(Services.cat, 'GB01');
			let printer = new WebBluetoothReceiptPrinter({ renderer: FakeRenderer });

			await printer.connect();
			await printer.print(new Uint8Array([ 0x1b, 0x40, 0x41 ]));

			/*
				The eleven packets of this job are 169 bytes together, which is less than
				the 200 of the profile, so they are one write.
			*/

			expect(FakeRenderer.bytes).to.deep.equal([ 0x1b, 0x40, 0x41 ]);
			expect(state.writes.length).to.equal(1);
			expect(state.writes[0].length).to.equal(169);
			expect(state.writes[0].slice(0, 9)).to.deep.equal([ 0x51, 0x78, 0xa3, 0x00, 0x01, 0x00, 0x00, 0x00, 0xff ]);
			expect(state.writes[0].slice(74, 82)).to.deep.equal([ 0x51, 0x78, 0xa2, 0x00, 0x30, 0x00, 0xf0, 0xf0 ]);
			expect(state.writes[0].slice(130, 140)).to.deep.equal([ 0x51, 0x78, 0xa1, 0x00, 0x02, 0x00, 0x18, 0x00, 0xff, 0xff ]);
			expect(state.writes[0].slice(159)).to.deep.equal([ 0x51, 0x78, 0xa1, 0x00, 0x02, 0x00, 0x60, 0x00, 0xf5, 0xff ]);
		});

		it('should fill every write with as many whole packets as fit', async () => {
			let state = install(Services.cat, 'GB01');
			let printer = new WebBluetoothReceiptPrinter({ renderer: TallFakeRenderer });

			await printer.connect();
			await printer.print(new Uint8Array([ 0x41 ]));

			/*
				Twenty packets: the seven of the job settings, ten rows of 56 bytes, the
				feed item, the lattice end and the final feed. The first write takes the
				settings and the two rows that still fit, then three rows per write, and
				the last row goes with the end of the job.
			*/

			expect(state.writes.map(i => i.length)).to.deep.equal([ 186, 168, 168, 151 ]);

			/* No packet is cut in half, so every write begins with the magic */

			for (let write of state.writes) {
				expect(write.slice(0, 2)).to.deep.equal([ 0x51, 0x78 ]);
			}

			/* The three rows of the second write, one after the other */

			expect(state.writes[1].slice(0, 6)).to.deep.equal([ 0x51, 0x78, 0xa2, 0x00, 0x30, 0x00 ]);
			expect(state.writes[1].slice(56, 62)).to.deep.equal([ 0x51, 0x78, 0xa2, 0x00, 0x30, 0x00 ]);
			expect(state.writes[1].slice(112, 118)).to.deep.equal([ 0x51, 0x78, 0xa2, 0x00, 0x30, 0x00 ]);
		});

		it('should write without response when the print characteristic only allows that', async () => {
			let state = install(Services.cat, 'MX10');
			state.withoutResponse = true;

			let printer = new WebBluetoothReceiptPrinter({ renderer: FakeRenderer });

			await printer.connect();
			await printer.print(new Uint8Array([ 0x1b, 0x40, 0x41 ]));

			expect(state.writes.length).to.equal(0);
			expect(state.unacknowledged.length).to.equal(1);
			expect(state.unacknowledged[0].slice(0, 9)).to.deep.equal([ 0x51, 0x78, 0xa3, 0x00, 0x01, 0x00, 0x00, 0x00, 0xff ]);
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

			expect(state.writes.length).to.equal(1);
		});

		it('should stop between two batches when the pause arrives halfway', async () => {
			let state = install(Services.cat, 'GB01');
			let printer = new WebBluetoothReceiptPrinter({ renderer: TallFakeRenderer });

			await printer.connect();

			/* The printer fills up and asks for a stop after it received the first write */

			state.onWrite = (count) => {
				if (count == 1) {
					state.emit([ 0x51, 0x78, 0xae, 0x01, 0x01, 0x00, 0x10, 0x70, 0xff ]);
				}
			};

			let job = printer.print(new Uint8Array([ 0x41 ]));

			await wait(80);

			expect(state.writes.length).to.equal(1);

			state.emit([ 0x51, 0x78, 0xae, 0x01, 0x01, 0x00, 0x00, 0x00, 0xff ]);

			await job;

			expect(state.writes.map(i => i.length)).to.deep.equal([ 186, 168, 168, 151 ]);
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

				expect(state.writes.length).to.equal(1);
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
