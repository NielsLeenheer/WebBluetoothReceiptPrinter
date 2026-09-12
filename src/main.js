import EventEmitter from "./event-emitter.js";
import CallbackQueue from "./callback-queue.js";
import MeowPrinterEncoder from "@point-of-sale/meow-printer-encoder";

/*
	Wrappers turn the items of a renderer into the wire format of a printer. A profile
	that needs rendering names the wrapper it needs in its graphics section. The wire
	formats themselves live in their own packages, one encoder per protocol, and a
	wrapper is the line that hands the items of the renderer to one of them.
*/

const Wrappers = {
	'meow':				(items, options) => new MeowPrinterEncoder({
							width:		options.width,
							energy:		options.energy,
							speed:		options.speed,
							feed:		options.feed,
							compress:	options.compress
						}).encode(items)
};

/*
	The codepage mapping belongs to the language of the renderer, not to the printer,
	so that an application that switches renderer only changes one import.
*/

const CodepageMappings = {
	'esc-pos':			'epson',
	'star-prnt':		'star',
	'star-line':		'star'
};

/*
	How long the driver waits for the resume packet of a printer that asked it to stop
	writing, before it continues anyway. A graphics section can set its own.
*/

const ResumeTimeout = 30000;

/*
	The settings of a graphics section that are passed on to the renderer when the profile
	has them, next to the language, the width, the supported commands and the codepage
	mapping, which it always has.
*/

const RendererSettings = [ 'maxHeight', 'feedThreshold' ];

const DeviceProfiles = [

	/* Epson TM-P series, for example the TM-P20II */
	{
		filters: [
			{
				namePrefix: 'TM-P'
			}
		],

		functions: {
			'print':		{
				service: 		'49535343-fe7d-4ae5-8fa9-9fafd205e455',
				characteristic:	'49535343-8841-43f4-a8d4-ecbe34729bb3'
			},

			'status':		{
				service: 		'49535343-fe7d-4ae5-8fa9-9fafd205e455',
				characteristic:	'49535343-1e4d-4bd9-ba61-23c647249616'
			}
		},

		language:			'esc-pos',
		codepageMapping:	'epson'
	},

	/* Star SM-L series, for example the SM-L200 */
	{
		filters: [
			{
				namePrefix: 'STAR L'
			}
		],

		functions: {
			'print':		{
				service: 		'49535343-fe7d-4ae5-8fa9-9fafd205e455',
				characteristic:	'49535343-8841-43f4-a8d4-ecbe34729bb3'
			},

			'status':		{
				service: 		'49535343-fe7d-4ae5-8fa9-9fafd205e455',
				characteristic:	'49535343-1e4d-4bd9-ba61-23c647249616'
			}
		},

		language:			'star-line',
		codepageMapping:	'star'
	},

	/* POS-5805, POS-8360 and similar printers */
	{
		filters: [ 
			{ 
				name: 		'BlueTooth Printer',
				services: 	[ '000018f0-0000-1000-8000-00805f9b34fb' ] 
			}
		],
		
		functions: {
			'print':		{
				service: 		'000018f0-0000-1000-8000-00805f9b34fb',
				characteristic:	'00002af1-0000-1000-8000-00805f9b34fb'
			},

			'status':		{
				service: 		'000018f0-0000-1000-8000-00805f9b34fb',
				characteristic:	'00002af0-0000-1000-8000-00805f9b34fb'
			}
		},

		language:			'esc-pos',
		codepageMapping:	'zjiang'
	}, 

	/* Xprinter */
	{
		filters: [ 
			{ 
				name: 		'Printer001',
				services: 	[ '000018f0-0000-1000-8000-00805f9b34fb' ] 
			} 
		],
		
		functions: {
			'print':		{
				service: 		'000018f0-0000-1000-8000-00805f9b34fb',
				characteristic:	'00002af1-0000-1000-8000-00805f9b34fb'
			},

			'status':		{
				service: 		'000018f0-0000-1000-8000-00805f9b34fb',
				characteristic:	'00002af0-0000-1000-8000-00805f9b34fb'
			}
		},

		language:			'esc-pos',
		codepageMapping:	'xprinter'
	}, 

	/* MPT-II printer */
	{
		filters: [ 
			{ 
				name: 		'MPT-II',
				services: 	[ '000018f0-0000-1000-8000-00805f9b34fb' ] 
			} 
		],
		
		functions: {
			'print':		{
				service: 		'000018f0-0000-1000-8000-00805f9b34fb',
				characteristic:	'00002af1-0000-1000-8000-00805f9b34fb'
			},

			'status':		{
				service: 		'000018f0-0000-1000-8000-00805f9b34fb',
				characteristic:	'00002af0-0000-1000-8000-00805f9b34fb'
			}
		},

		language:			'esc-pos',
		codepageMapping:	'mpt'
	},

	/* Cat printer */
	{
		/*
			Not every cat printer advertises its AE30 service, the MX10 for example does
			not, and the device picker only sees what is advertised. The known model
			names are therefore accepted as well, the service is checked after connecting.
		*/

		filters: [ 
			{ 
				services: 	[ '0000ae30-0000-1000-8000-00805f9b34fb' ] 
			},
			{ namePrefix: 'GB01' }, { namePrefix: 'GB02' }, { namePrefix: 'GB03' },
			{ namePrefix: 'GT01' }, { namePrefix: 'YT01' }, { namePrefix: 'MXTP' },
			{ namePrefix: 'MX05' }, { namePrefix: 'MX06' }, { namePrefix: 'MX08' }, { namePrefix: 'MX10' }
		],
		
		functions: {
			'print':		{
				service: 		'0000ae30-0000-1000-8000-00805f9b34fb',
				characteristic:	'0000ae01-0000-1000-8000-00805f9b34fb'
			},

			'notify':		{
				service: 		'0000ae30-0000-1000-8000-00805f9b34fb',
				characteristic:	'0000ae02-0000-1000-8000-00805f9b34fb'
			}

		},

		language:			'meow',
		codepageMapping:	'default',

		/*
			The two values that decide how long a receipt takes. The driver fills a write
			with as many whole packets as fit in messageSize bytes and sleeps
			sleepAfterCommand between the writes, which is what the reference
			implementation does with 200 byte writes and 20 ms. They are tunable: a
			printer that drops packets needs a longer sleep, and the flow control of the
			notify characteristic catches the rest.
		*/

		messageSize:		200,
		sleepAfterCommand:	20,

		/*
			The cat printers have no fonts and no barcode engine, they only print
			bitmap rows. When the application passed a renderer, the driver renders the
			job and packs the images itself, the language of the profile being the key of
			the graphics section that does it. Without one the packets of the protocol
			are passed on the way they always were, which leaves them to the application.

			The language of the section is the language the renderer has to encode, which
			is the language the application encodes its receipt in. These printers are not
			Star and not Epson, so ESC/POS it is, the language most encoders speak.

			The feedThreshold is tunable as well. White rows cost as much to send as
			printed ones, so a short gap between two lines of text is better spent on a
			feed packet of two bytes than on a few dozen white rows. Four dot rows is
			low enough to catch the gaps inside a receipt without turning every line into
			its own image.
		*/

		graphics:			{
								'meow': {
									language:		'esc-pos',
									width:			384,
									commands:		[ 'feed' ],
									wrapper:		'meow',
									maxHeight:		256,
									feedThreshold:	4,
									resumeTimeout:	30000
								}
							}
	},

	/* Generic printer */
	{
		filters: [ 
			{ 
				services: 	[ '000018f0-0000-1000-8000-00805f9b34fb' ] 
			} 
		],
		
		functions: {
			'print':		{
				service: 		'000018f0-0000-1000-8000-00805f9b34fb',
				characteristic:	'00002af1-0000-1000-8000-00805f9b34fb'
			},

			'status':		{
				service: 		'000018f0-0000-1000-8000-00805f9b34fb',
				characteristic:	'00002af0-0000-1000-8000-00805f9b34fb'
			}
		},

		language:			'esc-pos',
		codepageMapping:	'default'
	}
]

class ReceiptPrinterDriver {}

/*
	Thrown when the renderer option is not a renderer. That is a programming error an
	application has to see, so connect() rejects with it instead of swallowing it the way
	it swallows a user who closes the device dialog.
*/

class RendererError extends Error {}

class WebBluetoothReceiptPrinter extends ReceiptPrinterDriver {

	#emitter;
	#queue;
	#options;

	#device = null;
	#profile = null;
	#graphics = null;
	#renderer = null;
	#wrapper = null;
	#characteristics = {
		print: 	null,
		status: null,
		notify: null
	};
	#subscribed = {
		status: false,
		notify: false
	};
	#jobs = new Set();
	#timer = null;

	constructor(options) {
		super();

		this.#options = Object.assign({
			renderer:			null,
			rendererOptions:	{}
		}, options);

		this.#emitter = new EventEmitter();
		this.#queue = new CallbackQueue();

		/*
			An unexpected drop of the link has to leave the driver in the same state as
			a disconnect() the application asked for, or the next connection would start
			with a closed gate and a queue full of writes to a printer that is gone.
		*/

		navigator.bluetooth.addEventListener('disconnect', async event => {
			if (this.#device == event.device) {
				await this.#reset();

				this.#emitter.emit('disconnected');
			}
		});
	}

	async connect() {
		let filters = DeviceProfiles.map(i => i.filters).reduce((a, b) => a.concat(b));
		let optionalServices = DeviceProfiles.map(i => Object.values(i.functions).map(f => f.service)).reduce((a, b) => a.concat(b)).filter((v, i, a) => a.indexOf(v) === i);

		try {
			let device = await navigator.bluetooth.requestDevice({
				filters, optionalServices
			});

			if (device) {
				await this.#open(device);
			}
		}
		catch(error) {
			/*
				A renderer option that is not a renderer is a mistake in the application,
				which would otherwise print nothing at all and say nothing about it, so
				that one error is passed on to the caller. Everything else keeps the old
				behaviour and only logs.
			*/

			if (error instanceof RendererError) {
				throw error;
			}

			console.log('Could not connect! ' + error);
		}
	}

	async reconnect(previousDevice) {
		if (!navigator.bluetooth.getDevices) {
			return;
		}

		let devices = await navigator.bluetooth.getDevices();

		let device = devices.find(device => device.id == previousDevice.id);

		if (device) {
			await this.#open(device);
		}
	}

	async #open(device) {
		this.#device = device;

		let server = await this.#device.gatt.connect();
		let services = await server.getPrimaryServices();
		let uuids = services.map(service => service.uuid);

		/* Find profile for device */

		this.#profile = DeviceProfiles.find(item => item.filters.some(filter => this.#evaluateFilter(filter, uuids)));

		/* Get characteristics and service for printing */
		
		let printService = await server.getPrimaryService(this.#profile.functions.print.service);
		
		this.#characteristics.print = 
			await printService.getCharacteristic(this.#profile.functions.print.characteristic);
		
		/* Get characteristics and service for status */

		if (this.#profile.functions.status)
		{
			let statusService = await server.getPrimaryService(this.#profile.functions.status.service);

			this.#characteristics.status =
				await statusService.getCharacteristic(this.#profile.functions.status.characteristic);
		}

		/* Get characteristics and service for notifications */

		if (this.#profile.functions.notify)
		{
			let notifyService = await server.getPrimaryService(this.#profile.functions.notify.service);

			this.#characteristics.notify =
				await notifyService.getCharacteristic(this.#profile.functions.notify.characteristic);
		}

		let language = await this.#evaluate(this.#profile.language);
		let codepageMapping = await this.#evaluate(this.#profile.codepageMapping);

		/*
			A printer that can only print images. When the application passed a renderer,
			it turns the bytes the application sends into images, and the wrapper of the
			profile turns those into the packets the printer understands.

			Without a renderer the driver does what it has always done: it reports the
			language of the printer itself and passes the bytes of the application on
			unchanged, which leaves it to the application to build the packets.
		*/

		let graphics = this.#profile.graphics ? this.#profile.graphics[language] : null;

		this.#graphics = null;
		this.#renderer = null;
		this.#wrapper = null;

		if (graphics) {
			try {
				let Renderer = await this.#resolve(this.#options.renderer);

				if (Renderer) {
					/*
						A setting of a graphics section may be a function of the device, the
						same way the language and the codepage mapping of a profile may be,
						so that one profile can serve models with different print widths.
					*/

					graphics = await this.#settings(graphics);

					let wrapper = Wrappers[graphics.wrapper];

					if (!wrapper) {
						throw new Error('The profile of this printer names a wrapper that does not exist: ' + graphics.wrapper);
					}

					/*
						The language of a rendered printer is the language the profile asks
						the renderer for, and the codepage mapping is the one that belongs to
						that language. The width and the supported commands are those of the
						printer, so they win over anything the application passed.
					*/

					codepageMapping = CodepageMappings[graphics.language] || codepageMapping;

					let settings = {
						language:			graphics.language,
						width:				graphics.width,
						commands:			graphics.commands,
						codepageMapping:	codepageMapping
					};

					/*
						The settings that shape the images belong to the printer as well, but
						only when its profile has them. One that it does not set is left to the
						rendererOptions of the application and to the default of the renderer,
						rather than being overruled with an undefined.
					*/

					for (let key of RendererSettings) {
						if (typeof graphics[key] != 'undefined') {
							settings[key] = graphics[key];
						}
					}

					this.#renderer = new Renderer(Object.assign({}, this.#options.rendererOptions, settings));

					this.#graphics = graphics;
					this.#wrapper = wrapper;

					language = this.#renderer.language;

					/*
						The printer asks the driver to stop writing over the notify
						characteristic, so it is subscribed here and not only when the
						application asks for it with listen(). Flow control is not optional
						on this link, so a subscription that fails fails the connection.
					*/

					try {
						await this.#subscribe('notify');
					}
					catch(error) {
						throw new Error('This printer needs its notify characteristic for flow control, but it could not be subscribed: ' + error);
					}
				}
			}
			catch(error) {
				/*
					Nothing was printed and nothing will be, so the connection is taken
					down again instead of leaving a connected printer that cannot print.
				*/

				await this.#reset();

				throw error;
			}
		}

		/* Emit connected event */

		let connected = {
			type:				'bluetooth',
			name: 				this.#device.name,
			id: 				this.#device.id,
			language: 			language,
			codepageMapping:	codepageMapping
		};

		/*
			Only a rendered printer knows how many columns it has, it is the print width
			divided by the twelve dots of a font A character. For other printers the
			application decides, as it always has.
		*/

		if (this.#graphics) {
			connected.columns = this.#graphics.width / 12;
		}

		this.#emitter.emit('connected', connected);
	}

	/**
	 * Evaluate the settings of a graphics section against the device
	 *
	 * @param  {object}      graphics   The graphics section of the profile
	 * @return {object}                 The same settings with every function resolved
	 */
	async #settings(graphics) {
		let settings = {};

		for (let key of Object.keys(graphics)) {
			settings[key] = await this.#evaluate(graphics[key]);
		}

		return settings;
	}

	async #resolve(renderer) {
		if (!renderer) {
			return null;
		}

		/*
			The renderer class is a function with a static languages array. Any other
			function is a loader, which returns the class, possibly as a promise.
		*/

		try {
			if (typeof renderer == 'function' && !Array.isArray(renderer.languages)) {
				renderer = await renderer();
			}
		}
		catch(error) {
			throw new RendererError('The renderer option must be the ReceiptPrinterRenderer class, or a function that returns it');
		}

		if (typeof renderer != 'function' || !Array.isArray(renderer.languages)) {
			throw new RendererError('The renderer option must be the ReceiptPrinterRenderer class, or a function that returns it');
		}

		return renderer;
	}

	/**
	 * Subscribe to a notifying characteristic, at most once per connection
	 *
	 * @param  {string}      name       The name of the characteristic, status or notify
	 * @return {boolean}                Whether there is a subscription afterwards
	 */
	async #subscribe(name) {
		if (!this.#characteristics[name]) {
			return false;
		}

		if (this.#subscribed[name]) {
			return true;
		}

		/*
			The flag is set last, so that a subscription that failed can be tried again
			instead of being remembered as one that succeeded.
		*/

		await this.#characteristics[name].startNotifications();

		this.#characteristics[name].addEventListener("characteristicvaluechanged", (e) => {
			this.#handle(e.target.value);
		});

		this.#subscribed[name] = true;

		return true;
	}

	/**
	 * Handle a notification from the printer
	 *
	 * @param  {DataView}    value      The bytes of the notification
	 */
	#handle(value) {
		/*
			The cat printers ask the driver to stop writing when their buffer is full and
			to continue when it has room again. Only a printer the driver renders for
			speaks this, the status characteristic of an ordinary printer carries status
			bytes that must never be read as flow control.
		*/

		if (this.#graphics) {
			if (MeowPrinterEncoder.isPause(value)) {
				this.#pause();
			}

			if (MeowPrinterEncoder.isResume(value)) {
				this.#resume();
			}
		}

		this.#emitter.emit('data', value);
	}

	/**
	 * Stop writing until the printer says it has room again
	 *
	 * A resume that never arrives, because the notification was lost or the printer
	 * forgot to send it, would leave the job stuck forever, so the gate opens by itself
	 * after a while.
	 */
	#pause() {
		this.#queue.pause();

		if (this.#timer) {
			clearTimeout(this.#timer);
		}

		let timeout = this.#graphics.resumeTimeout || ResumeTimeout;

		this.#timer = setTimeout(() => {
			console.warn('Did not receive a resume from the printer within ' + timeout + ' ms, continuing anyway, the output may be corrupted');

			this.#resume();
		}, timeout);
	}

	/**
	 * Continue writing
	 */
	#resume() {
		if (this.#timer) {
			clearTimeout(this.#timer);
			this.#timer = null;
		}

		this.#queue.resume();
	}

	/**
	 * Join everything that was handed to print() into one buffer
	 *
	 * A renderer takes a job as one buffer, and a job is one job however the application
	 * chopped it up.
	 *
	 * @param  {Array}       commands   Arrays or typed arrays of bytes
	 * @return {Uint8Array}             All of the bytes, in order
	 */
	#join(commands) {
		/*
			A DataView or any other view on a buffer is wrapped without copying, which
			also takes care of a view on a slice of a larger buffer.
		*/

		let views = commands.map(command => ArrayBuffer.isView(command)
			? new Uint8Array(command.buffer, command.byteOffset, command.byteLength)
			: Uint8Array.from(command));

		if (views.length == 1) {
			return views[0];
		}

		let result = new Uint8Array(views.reduce((total, view) => total + view.length, 0));
		let offset = 0;

		for (let view of views) {
			result.set(view, offset);
			offset += view.length;
		}

		return result;
	}

	/**
	 * Pack packets into writes of at most maxLength bytes
	 *
	 * A packet is never split over two writes, so a packet that is longer than maxLength
	 * by itself, which the wrapper of the cat printers never produces, gets its own write
	 * rather than being cut in half.
	 *
	 * @param  {Array}       packets    The packets of the job, each a typed array
	 * @param  {number}      maxLength  The largest write the printer accepts
	 * @return {Array}                  The writes, each a Uint8Array of whole packets
	 */
	#batch(packets, maxLength) {
		let writes = [];
		let batch = [];
		let length = 0;

		for (let packet of packets) {
			if (batch.length && length + packet.length > maxLength) {
				writes.push(this.#join(batch));

				batch = [];
				length = 0;
			}

			batch.push(packet);
			length += packet.length;
		}

		if (batch.length) {
			writes.push(this.#join(batch));
		}

		return writes;
	}

	/**
	 * Write one chunk to the printer, if there still is one
	 *
	 * @param  {Uint8Array}  data       The bytes to write
	 */
	async #write(data) {
		if (!this.#characteristics.print) {
			return;
		}

		/*
			Some printers, such as the MX10 cat printer, only allow writing without a
			response on their print characteristic, so follow what it advertises.
		*/

		let properties = this.#characteristics.print.properties;

		if (properties && !properties.write && properties.writeWithoutResponse) {
			await this.#characteristics.print.writeValueWithoutResponse(data);
		} else {
			await this.#characteristics.print.writeValueWithResponse(data);
		}
	}

	async #evaluate(expression) {
		if (typeof expression == 'function') {
			return await expression(this.#device);
		}

		return expression;
	}

	#evaluateFilter(filter, uuids) {
		if (filter.services) {
			for (let service of filter.services) {
				if (!uuids.includes(service)) {
					return false;
				}
			}
		}

		if (filter.name) {
			if (this.#device.name != filter.name) {
				return false;
			}
		}

		if (filter.namePrefix) {
			if (!this.#device.name || !this.#device.name.startsWith(filter.namePrefix)) {
				return false;
			}
		}

		return true;
	}
	
	async listen() {
		/*
			The notify characteristic of a rendered printer is already subscribed during
			open, and a subscription is never made twice, so calling this is harmless.
		*/

		let status = await this.#subscribe('status');
		let notify = await this.#subscribe('notify');

		return status || notify;
	}

	async disconnect() {
		if (!this.#device) {
			return;
		}

		await this.#reset();

		this.#emitter.emit('disconnected');
	}

	/**
	 * Take down the connection and forget everything that belongs to it
	 */
	async #reset() {
		if (this.#device) {
			try {
				await this.#device.gatt.disconnect();
			}
			catch(error) {
				console.log('Could not disconnect! ' + error);
			}
		}

		this.#device = null;
		this.#characteristics.print = null;
		this.#characteristics.status = null;
		this.#characteristics.notify = null;
		this.#subscribed.status = false;
		this.#subscribed.notify = false;
		this.#profile = null;
		this.#graphics = null;
		this.#renderer = null;
		this.#wrapper = null;

		this.#resume();

		/*
			Everything that was still waiting to be written is thrown away, and the jobs
			that were waiting for it are settled, so that a print() nobody can finish any
			more never stays pending. They resolve rather than reject: the paper is the
			only place to see what did and did not print, and an application that never
			expected a rejection would end up with an unhandled one on every disconnect.
		*/

		this.#queue.clear();

		for (let settle of Array.from(this.#jobs)) {
			settle();
		}
	}

	print(commands) {
		return new Promise(resolve => {
			if (ArrayBuffer.isView(commands)) {
				commands = [ commands ];
			}

			/*
				The job is remembered until the queue has drained it, so that #reset()
				can settle it when the printer disappears halfway through.
			*/

			let settle = () => {
				if (this.#jobs.delete(settle)) {
					resolve();
				}
			};

			this.#jobs.add(settle);

			/*
				A graphics printer with a renderer does not understand the language the
				application encoded the receipt in, so the whole job is rendered to images
				first and then wrapped in the packets of the printer. Without a renderer
				the bytes are chunked and paced the way they always were, and building the
				packets is up to the application.

				The packets are small, a row is at most 56 bytes, and every write costs a
				sleep of the profile, so as many whole packets as fit go into one write.
				A receipt of six hundred packets becomes some eighty writes that way.
				Flow control is not lost: the queue checks its gate before every write, so
				a pause that arrives between two batches stops the next one.
			*/

			if (this.#graphics) {
				let packets = this.#wrapper(this.#renderer.render(this.#join(commands)), this.#graphics);

				for (let data of this.#batch(packets, this.#profile.messageSize || 100)) {
					this.#queue.add(() => this.#write(data));

					if (this.#profile.sleepAfterCommand) {
						this.#queue.sleep(this.#profile.sleepAfterCommand);
					}
				}

				this.#queue.add(() => settle());
				return;
			}

			for (let command of commands) {
				const maxLength = this.#profile.messageSize || 100;
				let chunks = Math.ceil(command.length / maxLength);
		
				if (chunks === 1) {
					let data = command;

					this.#queue.add(() => this.#write(data));

					if (this.#profile.sleepAfterCommand) {
						this.#queue.sleep(this.#profile.sleepAfterCommand);
					}
				} else {
					for (let i = 0; i < chunks; i++) {
						let byteOffset = i * maxLength;
						let length = Math.min(command.length, byteOffset + maxLength);
						let data = command.slice(byteOffset, length);

						this.#queue.add(() => this.#write(data));

						if (this.#profile.sleepAfterCommand) {
							this.#queue.sleep(this.#profile.sleepAfterCommand);
						}	
					}
				}
			}
	
			this.#queue.add(() => settle());
		});
	}

	addEventListener(n, f) {
		this.#emitter.on(n, f);
	}
}

export default WebBluetoothReceiptPrinter;