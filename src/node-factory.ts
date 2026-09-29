// ============================================================
// factory: the easy way to get a hardware-backed printer
// ============================================================

import { SerialPortTransport } from './node-serial';
import { JimpProcessor } from './node-jimp';
import { ThermalPrinter, type ThermalPrinterOptions } from './printer';
import type { PrintAction } from './printer';
import type { BitmapOptions, BitmapResult, ImageSource } from './image';
import { imageToBitmap } from './image';

export interface CreatePrinterOptions extends ThermalPrinterOptions {
  /** serial device path, e.g. /dev/cu.usbserial-A5069RR4 */
  path: string;
}

/**
 * creates a printer wired to a real serial port with the default
 * jimp image processor. convenience wrapper around
 * `new ThermalPrinter(...)`.
 */
export function createPrinter(options: CreatePrinterOptions): ThermalPrinter {
  const { path, ...printerOptions } = options;
  return new ThermalPrinter(
    ({ openTimeoutMs }) =>
      new SerialPortTransport({
        path,
        baudRate: printerOptions.baudRate ?? 9600,
        openTimeoutMs,
      }),
    printerOptions,
  );
}

/**
 * decodes an image source (file bytes, base64 or data-URL string)
 * into dithered bitmap rows using the default jimp processor.
 */
export async function imageToBitmapRows(
  source: ImageSource,
  options?: BitmapOptions,
): Promise<BitmapResult> {
  return imageToBitmap(new JimpProcessor(), source, options);
}

export type { PrintAction };