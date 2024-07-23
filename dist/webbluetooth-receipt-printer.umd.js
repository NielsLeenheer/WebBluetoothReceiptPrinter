!function(e,t){"object"==typeof exports&&"undefined"!=typeof module?module.exports=t():"function"==typeof define&&define.amd?define(t):(e="undefined"!=typeof globalThis?globalThis:e||self).WebBluetoothReceiptPrinter=t()}(this,(function(){"use strict";class e{constructor(e){this._events={}}on(e,t){this._events[e]=this._events[e]||[],this._events[e].push(t)}emit(e,...t){let i=this._events[e];i&&i.forEach((e=>{setTimeout((()=>e(...t)),0)}))}}class t{constructor(){this._queue=[],this._working=!1}add(e){let t=this;this._queue.push(e),this._working||async function e(){if(!t._queue.length)return void(t._working=!1);t._working=!0;let i=t._queue.shift();await i(),e()}()}}const i=[{filters:[{namePrefix:"TM-P"}],functions:{print:{service:"49535343-fe7d-4ae5-8fa9-9fafd205e455",characteristic:"49535343-8841-43f4-a8d4-ecbe34729bb3"},status:{service:"49535343-fe7d-4ae5-8fa9-9fafd205e455",characteristic:"49535343-1e4d-4bd9-ba61-23c647249616"}},language:"esc-pos",codepageMapping:"epson"},{filters:[{namePrefix:"STAR L"}],functions:{print:{service:"49535343-fe7d-4ae5-8fa9-9fafd205e455",characteristic:"49535343-8841-43f4-a8d4-ecbe34729bb3"},status:{service:"49535343-fe7d-4ae5-8fa9-9fafd205e455",characteristic:"49535343-1e4d-4bd9-ba61-23c647249616"}},language:"star-line",codepageMapping:"star"},{filters:[{name:"BlueTooth Printer",services:["000018f0-0000-1000-8000-00805f9b34fb"]}],functions:{print:{service:"000018f0-0000-1000-8000-00805f9b34fb",characteristic:"00002af1-0000-1000-8000-00805f9b34fb"},status:{service:"000018f0-0000-1000-8000-00805f9b34fb",characteristic:"00002af0-0000-1000-8000-00805f9b34fb"}},language:"esc-pos",codepageMapping:"zjiang"},{filters:[{name:"Printer001",services:["000018f0-0000-1000-8000-00805f9b34fb"]}],functions:{print:{service:"000018f0-0000-1000-8000-00805f9b34fb",characteristic:"00002af1-0000-1000-8000-00805f9b34fb"},status:{service:"000018f0-0000-1000-8000-00805f9b34fb",characteristic:"00002af0-0000-1000-8000-00805f9b34fb"}},language:"esc-pos",codepageMapping:"xprinter"},{filters:[{services:["000018f0-0000-1000-8000-00805f9b34fb"]}],functions:{print:{service:"000018f0-0000-1000-8000-00805f9b34fb",characteristic:"00002af1-0000-1000-8000-00805f9b34fb"},status:{service:"000018f0-0000-1000-8000-00805f9b34fb",characteristic:"00002af0-0000-1000-8000-00805f9b34fb"}},language:"esc-pos",codepageMapping:"default"}];class s{}return class extends s{#e;#t;#i=null;#s=null;#a={print:null,status:null};constructor(){super(),this.#e=new e,this.#t=new t,navigator.bluetooth.addEventListener("disconnect",(e=>{this.#i==e.device&&this.#e.emit("disconnected")}))}async connect(){let e=i.map((e=>e.filters)).reduce(((e,t)=>e.concat(t))),t=i.map((e=>Object.values(e.functions).map((e=>e.service)))).reduce(((e,t)=>e.concat(t))).filter(((e,t,i)=>i.indexOf(e)===t));try{let i=await navigator.bluetooth.requestDevice({filters:e,optionalServices:t});i&&await this.#c(i)}catch(e){console.log("Could not connect! "+e)}}async reconnect(e){if(!navigator.bluetooth.getDevices)return;let t=(await navigator.bluetooth.getDevices()).find((t=>t.id==e.id));t&&await this.#c(t)}async#c(e){this.#i=e;let t=await this.#i.gatt.connect(),s=(await t.getPrimaryServices()).map((e=>e.uuid));this.#s=i.find((e=>e.filters.some((e=>this.#r(e,s)))));let a=await t.getPrimaryService(this.#s.functions.print.service);if(this.#a.print=await a.getCharacteristic(this.#s.functions.print.characteristic),this.#s.functions.status){let e=await t.getPrimaryService(this.#s.functions.status.service);this.#a.status=await e.getCharacteristic(this.#s.functions.status.characteristic)}this.#e.emit("connected",{type:"bluetooth",name:this.#i.name,id:this.#i.id,language:await this.#n(this.#s.language),codepageMapping:await this.#n(this.#s.codepageMapping)})}async#n(e){return"function"==typeof e?await e(this.#i):e}#r(e,t){if(e.services)for(let i of e.services)if(!t.includes(i))return!1;return(!e.name||this.#i.name==e.name)&&!(e.namePrefix&&!this.#i.name.startsWith(e.namePrefix))}async listen(){return!!this.#a.status&&(await this.#a.status.startNotifications(),this.#a.status.addEventListener("characteristicvaluechanged",(e=>{this.#e.emit("data",e.target.value)})),!0)}async disconnect(){this.#i&&(await this.#i.gatt.disconnect(),this.#i=null,this.#a.print=null,this.#a.status=null,this.#s=null,this.#e.emit("disconnected"))}print(e){return new Promise((t=>{let i=Math.ceil(e.length/100);if(1===i){let t=e;this.#t.add((()=>this.#a.print.writeValueWithResponse(t)))}else for(let t=0;t<i;t++){let i=100*t,s=Math.min(e.length,i+100),a=e.slice(i,s);this.#t.add((()=>this.#a.print.writeValueWithResponse(a)))}this.#t.add((()=>t()))}))}addEventListener(e,t){this.#e.on(e,t)}}}));
//# sourceMappingURL=webbluetooth-receipt-printer.umd.js.map
