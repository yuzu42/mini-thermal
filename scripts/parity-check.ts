// ============================================================
// one-off parity harness (plan: “Parity check”)
// ============================================================
//
// proves the extraction preserves the reference driver's byte
// stream exactly. runs the ORIGINAL printer.ts helpers from the
// im-software backend (via tsx + a stubbed serialport) and the NEW
// library core over the same synthetic image + receipt layout, then
// asserts the emitted byte streams are identical.
//
// not part of the published package or the test suite — it depends
// on the im-software checkout. run manually:
//
//   IMPRINT_SOURCE=/path/to/im-software/backend/src/services/printer.ts \
//     npx tsx scripts/parity-check.ts

import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { imageToBitmap, type ImageProcessor } from '../src/image';
import { text, textNoNewline } from '../src/commands';
import { ThermalPrinter } from '../src/printer';
import { MockTransport } from '../src/transport';

const require = createRequire(import.meta.url);

// ------------------------------------------------------------
// 1. reference side: the original driver, with serial I/O stubbed
// ------------------------------------------------------------

interface RefBitmap { rows: Uint8Array[]; width: number; height: number; bytesPerRow: number }
interface RefModule {
  imageToBitmapRows(base64: string, options?: { maxWidth?: number; maxHeight?: number }): Promise<RefBitmap>;
  serialWrite(port: unknown, data: Uint8Array, baudRate: number): Promise<void>;
  printBitmapRows(port: unknown, bitmap: RefBitmap, baudRate: number): Promise<void>;
  cmdInit(): Uint8Array;
  cmdPrintDensity(n: number): Uint8Array;
  text(s: string): Uint8Array;
  textNoNewline(s: string): Uint8Array;
  wrapText(s: string, w?: number): string[];
  computeWriteDelay?(data: Uint8Array, baud: number): number;
}

const sourcePath = process.env.IMPRINT_SOURCE;
if (!sourcePath) {
  console.error('set IMPRINT_SOURCE to the im-software printer.ts path');
  process.exit(1);
}

// stub `serialport` before importing the reference module: its
// port object is replaced by a recorder.
const writes: Uint8Array[] = [];
const fakePort = {
  write(data: Uint8Array, cb?: (err?: Error | null) => void): void {
    writes.push(data.slice());
    cb?.(null);
  },
};

// createRequire + tsx loads the reference TS directly; it imports
// 'serialport' and 'jimp' at top level. serialport is only used for
// types & the port instance — both stubbed here. jimp is used for real.
const ref = require(sourcePath!) as RefModule;

// ------------------------------------------------------------
// 2. build a deterministic synthetic image (PNG via jimp)
// ------------------------------------------------------------

async function makeSyntheticPng(): Promise<string> {
  const { Jimp } = require('jimp') as typeof import('jimp');
  const img = new Jimp({ width: 80, height: 60, color: 0x808080ff });
  // deterministic gradient + checkerboard so dithering is exercised
  for (let y = 0; y < img.height; y++) {
    for (let x = 0; x < img.width; x++) {
      const v = (x * 3 + y * 5) % 256;
      const c = (x + y) % 2 === 0 ? v : 255 - v;
      // RGBA little-endian: r | g<<8 | b<<16 | a<<24 (jimp's int coding)
      const int = (c | (c << 8) | (c << 16) | (0xff << 24)) >>> 0;
      img.setPixelColor(int, x, y);
    }
  }
  const buf = await img.getBuffer('image/png');
  return `data:image/png;base64,${buf.toString('base64')}`;
}

// ------------------------------------------------------------
// 3. run both pipelines over the same input
// ------------------------------------------------------------

async function runReference(png: string): Promise<Uint8Array> {
  // bitmap via the original imageToBitmapRows (jimp-backed)
  const bitmap = await ref.imageToBitmapRows(png, { maxWidth: 384, maxHeight: 600 });
  const chunks = [
    ref.cmdInit(),
    ref.cmdPrintDensity(15),
    ref.text('PARITY HELLO'),
    ref.textNoNewline('no newline here\n'),
  ];
  for (const chunk of chunks) {
    // serialWrite sleeps — speed it up by monkey-patching global setTimeout? No:
    // instead call it but with the real delay; acceptable for a one-off.
    await ref.serialWrite(fakePort, chunk as unknown as Buffer, 9600);
  }
  await ref.printBitmapRows(fakePort as unknown as SerialPortLike, bitmap as any, 9600);
  return concat(writes);
}

type SerialPortLike = unknown;

function concat(list: Uint8Array[]): Uint8Array {
  const total = list.reduce((n, w) => n + w.length, 0);
  const out = new Uint8Array(total);
  let off = 0;
  for (const w of list) {
    out.set(w, off);
    off += w.length;
  }
  return out;
}

async function runNew(png: string): Promise<Uint8Array> {
  const processor = new (require('../src/node-jimp').JimpProcessor)() as ImageProcessor;
  const bitmap = await imageToBitmap(processor, png, {
    maxWidth: 384,
    maxHeight: 600,
    darken: 0.82,
    contrast: 0.25,
    align: 'center',
    dither: 'floyd-steinberg',
  });
  const transport = new MockTransport();
  const printer = new ThermalPrinter(() => transport, {
    baudRate: 9600,
    density: 15,
    noPace: true,
    log: () => {},
  });
  await printer.print([
    { type: 'chunks', data: [text('PARITY HELLO'), textNoNewline('no newline here\n')] },
    { type: 'bitmap', data: bitmap },
  ]);
  return transport.stream;
}

// ------------------------------------------------------------
// 4. diff
// ------------------------------------------------------------

async function main(): Promise<void> {
  const png = await makeSyntheticPng();

  console.log('Running reference driver...');
  const refStream = await runReference(png);
  console.log(`  → ${refStream.length} bytes`);

  console.log('Running new library...');
  const newStream = await runNew(png);
  console.log(`  → ${newStream.length} bytes`);

  if (refStream.length !== newStream.length) {
    console.error(`LENGTH MISMATCH: reference ${refStream.length} vs new ${newStream.length}`);
    for (let i = 0; i < Math.min(refStream.length, newStream.length); i++) {
      if (refStream[i] !== newStream[i]) {
        console.error(`first diff at byte ${i}: ref=${refStream[i]} new=${newStream[i]}`);
        break;
      }
    }
    process.exit(1);
  }
  for (let i = 0; i < refStream.length; i++) {
    if (refStream[i] !== newStream[i]) {
      console.error(`BYTE MISMATCH at ${i}: ref=${refStream[i]} new=${newStream[i]}`);
      process.exit(1);
    }
  }
  console.log('✓ PARITY OK — byte streams are identical.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});