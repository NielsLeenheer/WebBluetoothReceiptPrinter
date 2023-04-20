import EventEmitter from "./event-emitter.js";
import CallbackQueue from "./callback-queue.js";

const DeviceProfiles = [

	/* Zjiang ZJ-5805 */
	{
		filters: [
			{ services: [ '000018f0-0000-1000-8000-00805f9b34fb' ] }
		],
		
		service:			'000018f0-0000-1000-8000-00805f9b34fb',
		characteristic:		'00002af1-0000-1000-8000-00805f9b34fb',

		language:			'esc-pos',
		codepageMapping:	'zjiang'
	}
]


class WebBluetoothReceiptPrinter {

	constructor() {
        this._internal = {
            emitter:    		new EventEmitter(),
			queue:				new CallbackQueue(),
            device:     		null,
			characteristic:		null,
			profile:			null
        }

		navigator.bluetooth.addEventListener('disconnect', event => {
			if (this._internal.device == event.device) {
				this._internal.emitter.emit('disconnected');
			}
		});
	}

	async connect() {
		try {
			let device = await navigator.bluetooth.requestDevice({ 
				filters: DeviceProfiles.map(i => i.filters).reduce((a, b) => a.concat(b))
			});
			
			if (device) {
				await this.open(device);
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
			await this.open(device);
		}
	}

	async open(device) {
		this._internal.device = device;

		let server = await this._internal.device.gatt.connect();
		let services = await server.getPrimaryServices();

		this._internal.profile = DeviceProfiles.find(
			item => services.some(service => item.service == service.uuid)
		);

		let service = await server.getPrimaryService(this._internal.profile.service);
		let characteristic = await service.getCharacteristic(this._internal.profile.characteristic);

		this._internal.characteristic = characteristic;
		
		this._internal.emitter.emit('connected', {
			type:				'bluetooth',
			name: 				this._internal.device.name,
			id: 				this._internal.device.id,
			language: 			this._internal.profile.language,
			codepageMapping:	this._internal.profile.codepageMapping
		});
	}

	async disconnect() {
		if (!this._internal.device) {
			return;
		}

		await this._internal.device.gatt.disconnect();

		this._internal.device = null;
		this._internal.characteristic = null;
		this._internal.profile = null;

		this._internal.emitter.emit('disconnected');
	}
	
	print(command) {
		return new Promise(resolve => {
			const maxLength = 100;
			let chunks = Math.ceil(command.length / maxLength);
	
			if (chunks === 1) {
				let data = command;

				this._internal.queue.add(() => this._internal.characteristic.writeValue(data));
			} else {
				for (let i = 0; i < chunks; i++) {
					let byteOffset = i * maxLength;
					let length = Math.min(command.length, byteOffset + maxLength);
					let data = command.slice(byteOffset, length);

					this._internal.queue.add(() => this._internal.characteristic.writeValue(data));
				}
			}
	
			this._internal.queue.add(() => resolve());
		});
	}

	addEventListener(n, f) {
		this._internal.emitter.on(n, f);
	}
}

export default WebBluetoothReceiptPrinter;