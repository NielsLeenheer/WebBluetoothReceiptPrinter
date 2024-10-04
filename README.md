# WebBluetoothReceiptPrinter

This is an library that allows you to print to a Bluetooth connected receipt printer using WebBluetooth.

<br>

[![npm](https://img.shields.io/npm/v/@point-of-sale/webbluetooth-receipt-printer)](https://www.npmjs.com/@point-of-sale/webbluetooth-receipt-printer)
![GitHub License](https://img.shields.io/github/license/NielsLeenheer/WebBluetoothReceiptPrinter)


> This library is part of [@point-of-sale](https://point-of-sale.dev), a collection of libraries for interfacing browsers and Node with Point of Sale devices such as receipt printers, barcode scanners and customer facing displays.

<br>

## What does this library do?

In order to print a receipt on a receipt printer you need to build the receipt and encode it as in the ESC/POS or StarPRNT language. You can use the [`ReceiptPrinterEncoder`](https://github.com/NielsLeenheer/ReceiptPrinterEncoder) library for this. You end up with an array of raw bytes that needs to be send to the printer. One way to do that is using this library and WebBluetooth.

<br>

## How to use it?

Load the `webbluetooth-receipt-printer.umd.js` file from the `dist` directory in the browser and instantiate a `WebBluetoothReceiptPrinter` object. 

```html
<script src='webbluetooth-receipt-printer.umd.js'></script>

<script>

    const receiptPrinter = new WebBluetoothReceiptPrinter();

</script>
```

Or import the `webbluetooth-receipt-printer.esm.js` module:

```js
import WebHIDBarcodeScanner from 'webbluetooth-receipt-printer.esm.js';

const receiptPrinter = new WebBluetoothReceiptPrinter();
```

<br>

## Connect to a receipt printer

The first time you have to manually connect to the receipt printer by calling the `connect()` function. This function must be called as the result of an user action, for example clicking a button. You cannot call this function on page load.

```js
function handleConnectButtonClick() {
    receiptPrinter.connect();
}
```

In the future, there is a way to reconnect to already connected printers. This functionality is still behind a flag in currently shipping browsers. To do it you can simply call the `reconnect()` function. You have to provide an object with the id of the previously connected receipt printer in order to find the correct printer and connect to it again. You can get this data by listening to the `connected` event and store it for later use. It is recommended to call this button on page load to prevent having to manually connect to a previously connected device. 

```js
receiptPrinter.reconnect(lastUsedDevice);
```

If there are no receipt printers connected that have been previously connected, or the id does not match up, this function will do nothing.

To find out when a receipt printer is connected you can listen for the `connected` event using the `addEventListener()` function.

```js
receiptPrinter.addEventListener('connected', device => {
    console.log(`Connected to ${device.name} (#${device.id})`);

    printerLanguage = device.language;
    printerCodepageMapping = device.codepageMapping;

    /* Store device for reconnecting */
    lastUsedDevice = device;
});
```

The callback of the `connected` event is passed an object with the following properties:

-   `type`<br>
    Type of the connection that is used, in this case it is always `bluetooth`.
-   `name`<br>
    The name of the receipt printer.
-   `id`<br>
    A unique id for the receipt printer. To be used to reconnect to the printer at a later time.
-   `language`<br>
    Language of the printer, which can be either `esc-pos` or `star-prnt`. This can be used as an option for `ReceiptPrinterEncoder` to encode in the correct language for the printer.
-   `codepageMapping`<br>
    Code page mapping of the printer, which can be used as an option for `ReceiptPrinterEncoder` to map non-ascii characters to the correct codepage supported by the printer. 

<br>

## Commands

Once connected you can use the following command to print receipts.

### Printing receipts

When you want to print a receipt, you can call the `print()` function with an array, or a typed array with bytes. The data must be properly encoded for the printer. 

For example:

```js
/* Encode the receipt */

let encoder = new ReceiptPrinterEncoder({
    language:  printerLanguage,
    codepageMapping: printerCodepageMapping
});

let data = encoder
    .initialize()
    .text('The quick brown fox jumps over the lazy dog')
    .newline()
    .qrcode('https://nielsleenheer.com')
    .encode();

/* Print the receipt */

receiptPrinter.print(data);
```

<br>

-----

<br>

This library has been created by Niels Leenheer under the [MIT license](LICENSE). Feel free to use it in your products. The  development of this library is sponsored by Salonhub.

<a href="https://salohub.nl"><img src="https://salonhub.nl/assets/images/salonhub.svg" width=140></a>
