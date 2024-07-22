import EventEmitter from "./event-emitter.js";
import CallbackQueue from "./callback-queue.js";

const DeviceProfiles = [

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

class ReceiptPrinter {}

class WebBluetoothReceiptPrinter extends ReceiptPrinter {

	#emitter;
	#queue;
	
	#device = null;
	#profile = null;
	#characteristics = {
		print: 	null,
		status: null
	};

	constructor() {
		super();

		this.#emitter = new EventEmitter();
		this.#queue = new CallbackQueue();

		navigator.bluetooth.addEventListener('disconnect', event => {
			if (this.#device == event.device) {
				this.#emitter.emit('disconnected');
			}
		});
	}

	async connect() {
		try {
			let device = await navigator.bluetooth.requestDevice({ 
				filters: DeviceProfiles.map(i => i.filters).reduce((a, b) => a.concat(b))
			});
			
			if (device) {
				await this.#open(device);
			}
		}
		catch(error) {
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

		/* Emit connected event */

		this.#emitter.emit('connected', {
			type:				'bluetooth',
			name: 				this.#device.name,
			id: 				this.#device.id,
			language: 			await this.#evaluate(this.#profile.language),
			codepageMapping:	await this.#evaluate(this.#profile.codepageMapping)
		});
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
		if (this.#characteristics.status) {	
			await this.#characteristics.status.startNotifications();

			this.#characteristics.status.addEventListener( "characteristicvaluechanged", (e) => {
				this.#emitter.emit('data', e.target.value);
			});

			return true;
		}

		return false;
	}

	async disconnect() {
		if (!this.#device) {
			return;
		}

		await this.#device.gatt.disconnect();

		this.#device = null;
		this.#characteristics.print = null;
		this.#characteristics.status = null;
		this.#profile = null;

		this.#emitter.emit('disconnected');
	}
	
	print(command) {
		return new Promise(resolve => {
			const maxLength = 100;
			let chunks = Math.ceil(command.length / maxLength);
	
			if (chunks === 1) {
				let data = command;

				this.#queue.add(() => this.#characteristics.print.writeValueWithResponse(data));
			} else {
				for (let i = 0; i < chunks; i++) {
					let byteOffset = i * maxLength;
					let length = Math.min(command.length, byteOffset + maxLength);
					let data = command.slice(byteOffset, length);

					this.#queue.add(() => this.#characteristics.print.writeValueWithResponse(data));
				}
			}
	
			this.#queue.add(() => resolve());
		});
	}

	addEventListener(n, f) {
		this.#emitter.on(n, f);
	}
}

export default WebBluetoothReceiptPrinter;