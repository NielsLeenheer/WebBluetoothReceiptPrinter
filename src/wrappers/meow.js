/*

	Cat printer wrapper

	Turns the items of a renderer into the packets of the cheap Bluetooth Low Energy
	"cat" printers, sold as Meow printers, models GB01, GB02, GB03, GT01, MX05 and
	MX06. The protocol is not published by the manufacturers, the details come from
	NaitLee's Cat-Printer project, whose printer_lib/commander.py is the reference
	implementation.

	Every command is one packet:

		51 78  cmd  00  lenL lenH  payload...  crc8  FF

	The CRC8 is computed over the payload only, with the standard table for polynomial
	0x07 and initial value 0.

	The printer buffer is small, so the driver sends one packet per write and paces the
	writes with the sleepAfterCommand of the profile. That is why this wrapper returns a
	list of packets instead of one buffer, unlike the Star raster wrapper of the USB
	driver.

*/

const Commands = {

	/* Get device state, also the first command of a print 	A3, payload 00 			*/
	getState:			0xa3,

	/* Update device 										A9, payload 00 			*/
	updateDevice:		0xa9,

	/* Set the resolution 									A4, payload 32 is 200 dpi */
	setDpi:				0xa4,

	/* Print speed 											BD, one byte 			*/
	setSpeed:			0xbd,

	/* Energy, the darkness 								AF, two bytes, LE 		*/
	setEnergy:			0xaf,

	/* Apply the energy that was set 						BE, payload 01 			*/
	applyEnergy:		0xbe,

	/* Lattice, begins and ends a print 					A6, eleven bytes 		*/
	lattice:			0xa6,

	/* One bitmap row of 384 dots 							A2, 48 bytes 			*/
	drawBitmap:			0xa2,

	/* Feed the paper 										A1, two bytes, LE 		*/
	feedPaper:			0xa1
};

/*
	The fixed payloads of the commands that always carry the same bytes.
*/

const Payloads = {
	getState:			[ 0x00 ],
	updateDevice:		[ 0x00 ],
	dpi200:				[ 0x32 ],
	applyEnergy:		[ 0x01 ],

	/* Lattice start, begin a print */
	latticeStart:		[ 0xaa, 0x55, 0x17, 0x38, 0x44, 0x5f, 0x5f, 0x5f, 0x44, 0x38, 0x2c ],

	/* Lattice end, finish a print */
	latticeEnd:			[ 0xaa, 0x55, 0x17, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x17 ]
};

/*
	The bytes around a packet. The header is a fixed magic of two bytes, the byte behind
	the command is always zero, and every packet ends with 0xff.
*/

const Framing = {
	magic:				[ 0x51, 0x78 ],
	pad:				0x00,
	end:				0xff
};

/*
	The flow control packets the printer sends on the notify characteristic. The driver
	stops writing on a pause and continues on a resume.
*/

const FlowControl = {
	pause:				[ 0x51, 0x78, 0xae, 0x01, 0x01, 0x00, 0x10, 0x70, 0xff ],
	resume:				[ 0x51, 0x78, 0xae, 0x01, 0x01, 0x00, 0x00, 0x00, 0xff ]
};

/*
	The defaults of the settings a print job opens with. The speed and the energy are
	the two values that decide whether the output is readable, they can be overridden
	from the graphics section of the profile.
*/

const Defaults = {
	width:				384,	/* the print head is 384 dots wide 					*/
	speed:				0x20,	/* a middle of the road print speed 				*/
	energy:				0x2ee0,	/* 12000, the darkness of the reference implementation */
	feed:				96		/* rows of the final feed, so the paper clears the head */
};

/*
	A table with the reverse of every byte. The renderer's rows are most significant bit
	first, the printer takes the least significant bit as the leftmost dot.
*/

const Reversed = new Uint8Array(256);

for (let i = 0; i < 256; i++) {
	let value = 0;

	for (let bit = 0; bit < 8; bit++) {
		value = (value << 1) | ((i >> bit) & 0x01);
	}

	Reversed[i] = value;
}

/*
	The table of the CRC8 with polynomial 0x07 and initial value 0.
*/

const CrcTable = new Uint8Array(256);

for (let i = 0; i < 256; i++) {
	let crc = i;

	for (let bit = 0; bit < 8; bit++) {
		crc = (crc & 0x80) ? ((crc << 1) ^ 0x07) & 0xff : (crc << 1) & 0xff;
	}

	CrcTable[i] = crc;
}


/**
 * Wrap a list of renderer items in cat printer packets
 *
 * Items are the output of a renderer: image and feed. The printer has no cutter and no
 * drawer, so cut and pulse items are ignored, the renderer drops them before they get
 * here. The result is a list of packets, one per command, because the driver sends one
 * packet per Bluetooth write.
 *
 * @param  {Array}       items      Items as returned by the renderer
 * @param  {object}      options    Optional settings, the graphics section of the profile
 * @return {Array}                  The packets of the job, each a Uint8Array
 */
function wrap(items, options) {
	options = Object.assign({}, options);

	let width = clamp(options.width, Defaults.width, 8, 0xffff);
	let speed = clamp(options.speed, Defaults.speed, 0, 0xff);
	let energy = clamp(options.energy, Defaults.energy, 0, 0xffff);
	let feed = clamp(options.feed, Defaults.feed, 0, 0xffff);

	if (width % 8 != 0) {
		throw new Error('The width of the print area must be a multiple of eight dots, not ' + width);
	}

	let stride = width / 8;

	let packets = [];

	/*
		Job start. The state of the device is asked for first, the way the reference
		implementation opens a print, then the settings, and the lattice command that
		begins the print.
	*/

	packets.push(packet(Commands.getState, Payloads.getState));
	packets.push(packet(Commands.setDpi, Payloads.dpi200));
	packets.push(packet(Commands.setSpeed, [ speed ]));
	packets.push(packet(Commands.setEnergy, [ energy & 0xff, energy >> 8 ]));
	packets.push(packet(Commands.applyEnergy, Payloads.applyEnergy));
	packets.push(packet(Commands.updateDevice, Payloads.updateDevice));
	packets.push(packet(Commands.lattice, Payloads.latticeStart));

	for (let item of items) {
		switch (item.type) {

			/* One packet per row, the bytes reversed and padded to the print width */

			case 'image':
				/*
					The renderer is constructed with the width of the print head, so it
					never produces a wider image. A caller that builds its own item list
					could, and the dots that fall off the paper would be silently lost.
				*/

				if (item.width > width) {
					throw new Error('An image item of ' + item.width + ' dots is wider than the print head of ' + width + ' dots');
				}

				let source = Math.ceil(item.width / 8);

				for (let y = 0; y < item.height; y++) {
					let row = new Uint8Array(stride);

					for (let x = 0; x < source; x++) {
						row[x] = Reversed[item.data[y * source + x] || 0x00];
					}

					packets.push(packet(Commands.drawBitmap, row));
				}

				break;

			/* Advance the paper without sending white rows, which is slow on this link */

			case 'feed':
				let height = clamp(item.height, 0, 0, 0xffff);

				packets.push(packet(Commands.feedPaper, [ height & 0xff, height >> 8 ]));
				break;

			/*
				The printer has no cutter and no drawer, so cut and pulse are not in the
				supported commands of the profile and the renderer never emits them. They
				are ignored here as well, in case a caller builds its own item list.
			*/
		}
	}

	/*
		Job end. The lattice command finishes the print, and the paper is fed so that
		the last printed row leaves the print head and can be torn off.
	*/

	packets.push(packet(Commands.lattice, Payloads.latticeEnd));
	packets.push(packet(Commands.feedPaper, [ feed & 0xff, feed >> 8 ]));

	return packets;
}

/**
 * Build one packet around a command and its payload
 *
 * @param  {number}      command    The command byte
 * @param  {Array}       payload    The bytes of the payload
 * @return {Uint8Array}             The complete packet
 */
function packet(command, payload) {
	let length = payload.length;
	let result = new Uint8Array(length + 8);

	result[0] = Framing.magic[0];
	result[1] = Framing.magic[1];
	result[2] = command;
	result[3] = Framing.pad;
	result[4] = length & 0xff;
	result[5] = length >> 8;

	result.set(payload, 6);

	result[length + 6] = crc8(payload);
	result[length + 7] = Framing.end;

	return result;
}

/**
 * Compute the CRC8 of a payload, polynomial 0x07 and initial value 0
 *
 * @param  {Array}       bytes      The bytes to compute the checksum over
 * @return {number}                 The checksum
 */
function crc8(bytes) {
	let crc = 0;

	for (let i = 0; i < bytes.length; i++) {
		crc = CrcTable[(crc ^ bytes[i]) & 0xff];
	}

	return crc;
}

/**
 * Reverse the bits of a byte, so that the printer draws them left to right
 *
 * @param  {number}      value      The byte
 * @return {number}                 The byte with its bits in the opposite order
 */
function reverseBits(value) {
	return Reversed[value & 0xff];
}

/**
 * Clamp a value that goes on the wire, so that a missing or absurd option or item
 * property cannot produce a packet the printer will choke on
 *
 * @param  {number}      value      The value, which may be anything at all
 * @param  {number}      fallback   The value to use when there is none
 * @param  {number}      min        The lowest value of the field
 * @param  {number}      max        The highest value of the field
 * @return {number}                 A whole number within the range
 */
function clamp(value, fallback, min, max) {
	if (typeof value != 'number' || !Number.isFinite(value)) {
		value = fallback;
	}

	return Math.min(max, Math.max(min, Math.round(value)));
}

export { wrap, packet, crc8, reverseBits, Commands, FlowControl };
