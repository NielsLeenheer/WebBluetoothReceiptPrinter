import { expect } from 'chai';
import { wrap, packet, crc8, reverseBits } from '../src/wrappers/meow.js';

/*
	The expected bytes are written out in full, so that a mistake in the wrapper cannot
	hide behind the same mistake in the test.

	A packet is:

		51 78  cmd  00  lenL lenH  payload...  crc8  FF

	The CRC8 is over the payload only, polynomial 0x07, initial value 0, no reflection
	and no final xor. Computed by hand for the three values below:

		[ 00 ]	crc starts at 00, xor 00 is 00, and shifting a zero eight times stays
				zero, so the result is 00.

		[ 01 ]	crc starts at 00, xor 01 is 01. Seven shifts without the top bit set
				give 80, the eighth shift drops the top bit and xors the polynomial:
				(80 << 1) & ff is 00, xor 07 is 07. So the result is 07.

		[ 41 ]	'A'. crc is 41. The shifts, with ^07 whenever the top bit was set:
				41 -> 82 -> 03 -> 06 -> 0c -> 18 -> 30 -> 60 -> c0. So the result is c0.

	The job opens with the settings below, which are the defaults of the wrapper:

		A3 00							get device state
		A4 32							set the resolution to 200 dpi
		BD 20							print speed
		AF e0 2e						energy 0x2ee0, 12000, little endian
		BE 01							apply the energy
		A9 00							update device
		A6 aa 55 17 38 44 5f 5f 5f 44 38 2c		lattice start

	and closes with:

		A6 aa 55 17 00 00 00 00 00 00 00 17		lattice end
		A1 60 00						feed 96 rows, so the paper leaves the head
*/

const start = [
	0x51, 0x78, 0xa3, 0x00, 0x01, 0x00, 0x00, 0x00, 0xff,
	0x51, 0x78, 0xa4, 0x00, 0x01, 0x00, 0x32, 0x9e, 0xff,
	0x51, 0x78, 0xbd, 0x00, 0x01, 0x00, 0x20, 0xe0, 0xff,
	0x51, 0x78, 0xaf, 0x00, 0x02, 0x00, 0xe0, 0x2e, 0x89, 0xff,
	0x51, 0x78, 0xbe, 0x00, 0x01, 0x00, 0x01, 0x07, 0xff,
	0x51, 0x78, 0xa9, 0x00, 0x01, 0x00, 0x00, 0x00, 0xff,
	0x51, 0x78, 0xa6, 0x00, 0x0b, 0x00,
	0xaa, 0x55, 0x17, 0x38, 0x44, 0x5f, 0x5f, 0x5f, 0x44, 0x38, 0x2c, 0xa1, 0xff
];

const end = [
	0x51, 0x78, 0xa6, 0x00, 0x0b, 0x00,
	0xaa, 0x55, 0x17, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x17, 0x11, 0xff,
	0x51, 0x78, 0xa1, 0x00, 0x02, 0x00, 0x60, 0x00, 0xf5, 0xff
];

/* The packets of a job, flattened, so that they can be compared as one sequence */

function bytes(packets) {
	return packets.reduce((all, item) => all.concat(Array.from(item)), []);
}

/* One row of 384 dots, most significant bit first, as the renderer produces it */

function row(fill) {
	let data = new Uint8Array(48);

	for (let i = 0; i < 48; i++) {
		data[i] = fill(i);
	}

	return data;
}


describe('meow', () => {

	describe('crc8()', () => {

		it('should return 00 for a single zero byte', () => {
			expect(crc8([ 0x00 ])).to.equal(0x00);
		});

		it('should return 07 for a single one byte', () => {
			expect(crc8([ 0x01 ])).to.equal(0x07);
		});

		it('should return c0 for the letter A', () => {
			expect(crc8([ 0x41 ])).to.equal(0xc0);
		});

		it('should return 00 for an empty payload', () => {
			expect(crc8([])).to.equal(0x00);
		});

		it('should return a1 for the lattice start payload', () => {
			expect(crc8([ 0xaa, 0x55, 0x17, 0x38, 0x44, 0x5f, 0x5f, 0x5f, 0x44, 0x38, 0x2c ])).to.equal(0xa1);
		});

		it('should return 11 for the lattice end payload', () => {
			expect(crc8([ 0xaa, 0x55, 0x17, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x17 ])).to.equal(0x11);
		});

		it('should accept a typed array', () => {
			expect(crc8(new Uint8Array([ 0x41 ]))).to.equal(0xc0);
		});
	});

	describe('reverseBits()', () => {

		it('should turn the leftmost bit into the rightmost one', () => {
			expect(reverseBits(0x80)).to.equal(0x01);
		});

		it('should turn the rightmost bit into the leftmost one', () => {
			expect(reverseBits(0x01)).to.equal(0x80);
		});

		it('should leave a symmetrical byte alone', () => {
			expect(reverseBits(0x00)).to.equal(0x00);
			expect(reverseBits(0xff)).to.equal(0xff);
			expect(reverseBits(0x81)).to.equal(0x81);
		});

		it('should reverse an asymmetrical byte', () => {
			expect(reverseBits(0xa0)).to.equal(0x05);
			expect(reverseBits(0x0f)).to.equal(0xf0);
			expect(reverseBits(0x4d)).to.equal(0xb2);
		});
	});

	describe('packet()', () => {

		it('should frame a one byte payload', () => {
			expect(Array.from(packet(0xa1, [ 0x41 ]))).to.deep.equal([
				0x51, 0x78,		/* the magic of every packet 		*/
				0xa1,			/* the command 						*/
				0x00,			/* always zero 						*/
				0x01, 0x00,		/* the payload length, little endian */
				0x41,			/* the payload 						*/
				0xc0,			/* the CRC8 of the payload 			*/
				0xff			/* the end of the packet 			*/
			]);
		});

		it('should frame a payload of more than 255 bytes', () => {
			let payload = new Uint8Array(300);
			let result = packet(0xa2, payload);

			expect(result.length).to.equal(308);
			expect(Array.from(result.slice(0, 6))).to.deep.equal([ 0x51, 0x78, 0xa2, 0x00, 0x2c, 0x01 ]);
			expect(Array.from(result.slice(306))).to.deep.equal([ 0x00, 0xff ]);
		});

		it('should return a Uint8Array', () => {
			expect(packet(0xa1, [ 0x00 ])).to.be.an.instanceof(Uint8Array);
		});
	});

	describe('wrap([])', () => {

		it('should send the settings, the lattice and the final feed', () => {
			expect(bytes(wrap([], { width: 384 }))).to.deep.equal([ ...start, ...end ]);
		});

		it('should return one packet per command', () => {
			expect(wrap([], { width: 384 }).length).to.equal(9);
		});

		it('should return typed arrays', () => {
			for (let item of wrap([], { width: 384 })) {
				expect(item).to.be.an.instanceof(Uint8Array);
			}
		});
	});

	describe('wrap([ image of 384 by 2 ])', () => {

		/*
			The first row has the leftmost and the rightmost dot of the paper, the second
			row is a run of 0x4d bytes. Reversed those are 01 .. 80 and b2.
		*/

		let first = row(i => i == 0 ? 0x80 : (i == 47 ? 0x01 : 0x00));
		let second = row(() => 0x4d);

		let data = new Uint8Array(96);
		data.set(first, 0);
		data.set(second, 48);

		let items = [
			{ type: 'image', width: 384, height: 2, data: data }
		];

		let expected = [
			...start,

			/* 48 bytes, 80 .. 01 reversed to 01 .. 80 */
			0x51, 0x78, 0xa2, 0x00, 0x30, 0x00,
			0x01, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
			0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
			0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
			0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
			0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
			0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x80,
			0x81, 0xff,

			/* 48 bytes of 4d, reversed to b2 */
			0x51, 0x78, 0xa2, 0x00, 0x30, 0x00,
			0xb2, 0xb2, 0xb2, 0xb2, 0xb2, 0xb2, 0xb2, 0xb2,
			0xb2, 0xb2, 0xb2, 0xb2, 0xb2, 0xb2, 0xb2, 0xb2,
			0xb2, 0xb2, 0xb2, 0xb2, 0xb2, 0xb2, 0xb2, 0xb2,
			0xb2, 0xb2, 0xb2, 0xb2, 0xb2, 0xb2, 0xb2, 0xb2,
			0xb2, 0xb2, 0xb2, 0xb2, 0xb2, 0xb2, 0xb2, 0xb2,
			0xb2, 0xb2, 0xb2, 0xb2, 0xb2, 0xb2, 0xb2, 0xb2,
			0xb1, 0xff,

			...end
		];

		it('should send one bit reversed row per packet', () => {
			expect(bytes(wrap(items, { width: 384 }))).to.deep.equal(expected);
		});

		it('should reverse the first row to 01 in the first byte and 80 in the last', () => {
			let packets = wrap(items, { width: 384 });

			expect(packets[7][6]).to.equal(0x01);
			expect(packets[7][53]).to.equal(0x80);
		});

		it('should reverse every byte of the second row', () => {
			let packets = wrap(items, { width: 384 });

			expect(Array.from(packets[8].slice(6, 54))).to.deep.equal(new Array(48).fill(0xb2));
		});
	});

	describe('wrap([ image narrower than the print head ])', () => {

		let items = [
			{ type: 'image', width: 16, height: 1, data: new Uint8Array([ 0xff, 0x0f ]) }
		];

		it('should pad the row with zeroes up to 48 bytes', () => {
			let packets = wrap(items, { width: 384 });
			let expected = new Array(48).fill(0x00);

			expected[0] = 0xff;
			expected[1] = 0xf0;

			expect(Array.from(packets[7].slice(6, 54))).to.deep.equal(expected);
			expect(packets[7].length).to.equal(56);
		});
	});

	describe('wrap([ image wider than the print head ])', () => {

		it('should throw rather than drop the dots that fall off the paper', () => {
			let items = [
				{ type: 'image', width: 576, height: 1, data: new Uint8Array(72) }
			];

			expect(() => wrap(items, { width: 384 })).to.throw('wider than the print head');
		});

		it('should accept an image exactly as wide as the print head', () => {
			let items = [
				{ type: 'image', width: 384, height: 1, data: new Uint8Array(48) }
			];

			expect(() => wrap(items, { width: 384 })).to.not.throw();
		});
	});

	describe('wrap() with a width that is not a multiple of eight', () => {

		it('should throw', () => {
			expect(() => wrap([], { width: 380 })).to.throw('multiple of eight dots');
		});
	});

	describe('wrap([ feed ])', () => {

		it('should feed the given number of rows, little endian', () => {
			let items = [ { type: 'feed', height: 300 } ];

			expect(bytes(wrap(items, { width: 384 }))).to.deep.equal([
				...start,
				0x51, 0x78, 0xa1, 0x00, 0x02, 0x00, 0x2c, 0x01, 0x55, 0xff,
				...end
			]);
		});

		it('should feed nothing for a feed item without a height', () => {
			let items = [ { type: 'feed' } ];

			expect(bytes(wrap(items, { width: 384 }))).to.deep.equal([
				...start,
				0x51, 0x78, 0xa1, 0x00, 0x02, 0x00, 0x00, 0x00, 0x00, 0xff,
				...end
			]);
		});

		it('should clamp a negative or absurd height to the field', () => {
			expect(Array.from(wrap([ { type: 'feed', height: -5 } ], {})[7].slice(6, 8))).to.deep.equal([ 0x00, 0x00 ]);
			expect(Array.from(wrap([ { type: 'feed', height: 1e9 } ], {})[7].slice(6, 8))).to.deep.equal([ 0xff, 0xff ]);
			expect(Array.from(wrap([ { type: 'feed', height: NaN } ], {})[7].slice(6, 8))).to.deep.equal([ 0x00, 0x00 ]);
		});
	});

	describe('wrap([ cut, pulse, unknown ])', () => {

		it('should ignore the items the printer cannot perform', () => {
			let items = [
				{ type: 'cut', value: 'partial' },
				{ type: 'pulse', device: 0, on: 100, off: 500 },
				{ type: 'unknown', data: new Uint8Array([ 0x1b, 0x40 ]) }
			];

			expect(bytes(wrap(items, { width: 384 }))).to.deep.equal([ ...start, ...end ]);
		});
	});

	describe('wrap() options', () => {

		it('should take the speed, the energy and the final feed from the options', () => {
			let packets = wrap([], { width: 384, speed: 0x10, energy: 0x1234, feed: 0x0100 });

			expect(Array.from(packets[2].slice(6, 7))).to.deep.equal([ 0x10 ]);
			expect(Array.from(packets[3].slice(6, 8))).to.deep.equal([ 0x34, 0x12 ]);
			expect(Array.from(packets[8].slice(6, 8))).to.deep.equal([ 0x00, 0x01 ]);
		});

		it('should fall back to the defaults without options', () => {
			expect(bytes(wrap([]))).to.deep.equal([ ...start, ...end ]);
		});

		it('should clamp a speed and an energy that do not fit their field', () => {
			let packets = wrap([], { speed: 1000, energy: -1, feed: 1e9 });

			expect(Array.from(packets[2].slice(6, 7))).to.deep.equal([ 0xff ]);
			expect(Array.from(packets[3].slice(6, 8))).to.deep.equal([ 0x00, 0x00 ]);
			expect(Array.from(packets[8].slice(6, 8))).to.deep.equal([ 0xff, 0xff ]);
		});

		it('should fall back to the default for a value that is not a finite number', () => {
			let packets = wrap([], { speed: Infinity, energy: 'dark', feed: NaN });

			expect(Array.from(packets[2].slice(6, 7))).to.deep.equal([ 0x20 ]);
			expect(Array.from(packets[3].slice(6, 8))).to.deep.equal([ 0xe0, 0x2e ]);
			expect(Array.from(packets[8].slice(6, 8))).to.deep.equal([ 0x60, 0x00 ]);
		});
	});

});
