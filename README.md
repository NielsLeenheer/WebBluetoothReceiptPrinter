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

The constructor optionally takes an object with options. These are only needed for printers that can only print graphics, see [Cat printers](#cat-printers).

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
-   `columns`<br>
    The number of columns of the printer. This property is only present for printers that can only print graphics, such as the cat printers, where the driver knows the exact print width. For all other printers this property is absent and you decide the number of columns yourself.

<br>

## Cat printers

The cheap Bluetooth Low Energy printers that are sold as cat printers, or Meow printers, have no fonts and no barcode engine. They print 384 dots wide and only accept bitmap rows.

You can still use `ReceiptPrinterEncoder` the way you always do. You just have to give this library a renderer, which turns the encoded receipt into images before it is sent to the printer. The renderer lives in a separate package, [`@point-of-sale/receipt-printer-renderer`](https://github.com/NielsLeenheer/ReceiptPrinterRenderer), which you install yourself. It is an optional peer dependency, so it is only in your bundle when you actually use it.

```js
import { EscPosRenderer } from '@point-of-sale/receipt-printer-renderer';

const receiptPrinter = new WebBluetoothReceiptPrinter({
    renderer: EscPosRenderer
});
```

You do not know beforehand which printer the user is going to pick, so you can also pass a function that returns the renderer class. The function may be asynchronous, which allows you to load the package only when a cat printer is actually connected.

```js
const receiptPrinter = new WebBluetoothReceiptPrinter({
    renderer: () => import('@point-of-sale/receipt-printer-renderer').then(m => m.EscPosRenderer)
});
```

The constructor accepts the following options:

-   `renderer`<br>
    A renderer class, or a function that returns a renderer class, possibly as a promise. Required for printers that can only print graphics. When such a printer is connected without a renderer, connecting fails with an error.
-   `rendererOptions`<br>
    An object with additional options for the renderer, such as `font`. The `width`, `commands`, `maxHeight` and `codepageMapping` options belong to the printer and to the renderer and are always set by this library.

The `connected` event reports the language and the code page mapping of the renderer, not of the printer, because that is the language you have to encode your receipt in. With the ESC/POS renderer you get `esc-pos` and `epson`. It also reports `columns`, which is 32 for these 384 dot printers.

```js
receiptPrinter.addEventListener('connected', device => {
    let encoder = new ReceiptPrinterEncoder({
        language:        device.language,
        codepageMapping: device.codepageMapping,
        columns:         device.columns
    });
});
```

These printers have no cutter and no cash drawer, so cutting and opening the drawer do nothing. The driver feeds the paper at the end of every receipt instead, so that the last printed line clears the print head and can be torn off.

Because the buffer of these printers is small, they tell the driver to stop writing when they cannot keep up and to continue when they have room again. The driver does that for you. If the printer forgets to ask the driver to continue, it continues by itself after three seconds and logs that it did.

The promise that `print()` returns resolves when the last packet has been written. If the printer disappears halfway through, by a `disconnect()` or because the link dropped, the promise resolves as well, even though the receipt is only partly printed. It does not reject, so that an application that never expected a rejection does not end up with an unhandled one every time a printer is switched off. The paper is the only place where you can see what did and did not print.

Unlike other errors, a problem with the renderer makes `connect()` reject with an error instead of only logging it. That happens when no renderer was passed and a cat printer is connected, and when the renderer option is not a renderer class or a function that returns one. A printer that cannot print what you send it would otherwise silently print nothing at all, which is hard to diagnose.

```js
try {
    await receiptPrinter.connect();
}
catch(error) {
    console.error(error);
}
```

### Supported models

Known to work are GB01, GB02, GB03, GT01, MX05 and MX06, and printers that are sold under another name but use the same service and characteristics. The MXW01 and newer models use a different protocol and are not supported.

### Breaking change in version 3

Version 2 and earlier reported the language `meow` for these printers and passed everything you gave them straight through, which meant your application had to build the packets of the protocol itself. That is gone. The driver now renders and packs the receipt, and a cat printer without a renderer refuses to connect. If you were building the packets yourself, encode the receipt with `ReceiptPrinterEncoder` and pass a renderer instead.

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
