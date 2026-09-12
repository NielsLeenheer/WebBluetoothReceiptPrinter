import EventEmitter from "./event-emitter.js";
import CallbackQueue from "./callback-queue.js";
import { wrap as meow, FlowControl } from "./wrappers/meow.js";

/*
	Wrappers turn the items of a renderer into the wire format of a printer. A profile
	that needs rendering names the wrapper it needs in its graphics section.
*/

const Wrappers = {
	'meow':				meow
};

/*
	The codepage mapping belongs to the language of the renderer, not to the printer,
	so that an application that switches renderer only changes one import.
*/

const CodepageMappings = {
	'esc-pos':			'epson',
	'star-prnt':		'star'
};

/*
	How long the driver waits for the resume packet of a printer that asked it to stop
	writing, before it continues anyway. A graphics section can set its own.
*/

const ResumeTimeout = 3000;

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
		filters: [ 
			{ 
				services: 	[ '0000ae30-0000-1000-8000-00805f9b34fb' ] 
			} 
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
		messageSize:		200,
		sleepAfterCommand:	30,

		/*
			The cat printers have no fonts and no barcode engine, they only print
			bitmap rows. The driver renders the job and packs the images itself, the
			language of the profile is the key of the graphics section that does it.
		*/

		graphics:			{
								'meow': {
									width:			384,
									commands:		[ 'feed' ],
									wrapper:		'meow',
									maxHeight:		256,
									resumeTimeout:	3000
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
	Everything that can go wrong around the renderer of a graphics printer: no renderer
	was passed, the renderer option is not a renderer, or the profile names a wrapper
	that does not exist. These are programming errors an application has to see, so
	connect() rejects with them instead of swallowing them the way it swallows a user
	who closes the device dialog.
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
				A printer that can only print graphics without a usable renderer would
				otherwise print nothing at all and say nothing about it, which is hard
				to diagnose, so that one error is passed on to the caller. Everything
				else keeps the old behaviour and only logs.
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
			A printer that can only print images. The renderer turns the bytes the
			application sends into images, and the wrapper of the profile turns those
			into the packets the printer understands.
		*/

		let graphics = this.#profile.graphics ? this.#profile.graphics[language] : null;

		this.#graphics = null;
		this.#renderer = null;
		this.#wrapper = null;

		if (graphics) {
			try {
				/*
					A setting of a graphics section may be a function of the device, the
					same way the language and the codepage mapping of a profile may be,
					so that one profile can serve models with different print widths.
				*/

				graphics = await this.#settings(graphics);

				let Renderer = await this.#resolve(this.#options.renderer);

				if (!Renderer) {
					throw new RendererError('This printer only supports graphics, pass the renderer option with the EscPosRenderer or StarPrntRenderer class from @point-of-sale/receipt-printer-renderer');
				}

				let wrapper = Wrappers[graphics.wrapper];

				if (!wrapper) {
					throw new RendererError('The profile of this printer names a wrapper that does not exist: ' + graphics.wrapper);
				}

				/*
					The language and the codepage mapping of a graphics printer are those
					of the renderer. The width and the supported commands are those of the
					printer, so they win over anything the application passed.
				*/

				language = Renderer.language;
				codepageMapping = CodepageMappings[language] || codepageMapping;

				this.#renderer = new Renderer(Object.assign({}, this.#options.rendererOptions, {
					width:				graphics.width,
					commands:			graphics.commands,
					maxHeight:			graphics.maxHeight,
					codepageMapping:	codepageMapping
				}));

				this.#graphics = graphics;
				this.#wrapper = wrapper;

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
					throw new RendererError('This printer needs its notify characteristic for flow control, but it could not be subscribed: ' + error);
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
			Only a graphics printer knows how many columns it has, it is the print width
			divided by the twelve dots of a font A character. For other printers the
			application decides, as it always has.
		*/

		if (graphics) {
			connected.columns = graphics.width / 12;
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
			A renderer class is a function with a static language property. Any other
			function is a loader, which returns the class, possibly as a promise.
		*/

		try {
			if (typeof renderer == 'function' && typeof renderer.language != 'string') {
				renderer = await renderer();
			}
		}
		catch(error) {
			throw new RendererError('The renderer option must be a renderer class, or a function that returns one');
		}

		if (typeof renderer != 'function' || typeof renderer.language != 'string') {
			throw new RendererError('The renderer option must be a renderer class, or a function that returns one');
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
			to continue when it has room again. Only a graphics printer speaks this, the
			status characteristic of an ordinary printer carries status bytes that must
			never be read as flow control.
		*/

		if (this.#graphics) {
			if (this.#matches(value, FlowControl.pause)) {
				this.#pause();
			}

			if (this.#matches(value, FlowControl.resume)) {
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
			console.log('Did not receive a resume from the printer within ' + timeout + ' ms, continuing anyway');

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
	 * Compare a notification with a known packet
	 *
	 * @param  {DataView}    value      The bytes of the notification
	 * @param  {Array}       packet     The bytes of the packet to compare it with
	 * @return {boolean}                Whether the notification is that packet
	 */
	#matches(value, packet) {
		if (!value || value.byteLength != packet.length) {
			return false;
		}

		for (let i = 0; i < packet.length; i++) {
			if (value.getUint8(i) != packet[i]) {
				return false;
			}
		}

		return true;
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
	 * Write one chunk to the printer, if there still is one
	 *
	 * @param  {Uint8Array}  data       The bytes to write
	 */
	async #write(data) {
		if (!this.#characteristics.print) {
			return;
		}

		await this.#characteristics.print.writeValueWithResponse(data);
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
			if (!this.#device.name.startsWith(filter.namePrefix)) {
				return false;
			}
		}

		return true;
	}
	
	async listen() {
		/*
			The notify characteristic of a graphics printer is already subscribed during
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
				A graphics printer does not understand the language the application
				encoded the receipt in, so the whole job is rendered to images first and
				then wrapped in the packets of the printer, one packet per write. The
				raw bytes are never sent to such a printer, they would print garbage.
			*/

			if (this.#graphics) {
				let packets = this.#wrapper(this.#renderer.render(this.#join(commands)), this.#graphics);

				for (let data of packets) {
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