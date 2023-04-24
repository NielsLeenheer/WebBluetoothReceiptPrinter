import resolve from '@rollup/plugin-node-resolve';
import commonjs from '@rollup/plugin-commonjs';
import terser from '@rollup/plugin-terser';

export default [
	// browser-friendly UMD build
	{
		input: 'src/main.js',
		output: {
			name: 'WebBluetoothReceiptPrinter',
			file: 'dist/webbluetooth-receipt-printer.umd.js',
			format: 'umd'
		},
		plugins: [
			resolve(), 
			commonjs(),
            terser() 
		]
	},

	{
		input: 'src/main.js',
		output: { 
			file: 'dist/webbluetooth-receipt-printer.esm.js', 
			format: 'es' 
		},
		plugins: [
			resolve(),
			commonjs(),
            terser()
		]
	}
];