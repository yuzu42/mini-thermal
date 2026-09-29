// ============================================================
// serialport-backed ByteTransport
// ============================================================
//
// encapsulates every hardware-earned serialport setting:
//   - hupcl: false — stops the FTDI adapter from toggling DTR on
//     open/close, which would reset the printer mid-job
//   - autoOpen: false — the port is only opened once WE decide,
//     so open errors surface through our own timeout handling
//   - open timeout — a wedged open (e.g. after an unclean exit)
//     must never hang the caller forever

import { SerialPort } from 'serialport';
import type { ByteTransport } from './transport';

export interface SerialPortTransportOptions {
  /** device path, e.g. /dev/cu.usbserial-A5069RR4 or COM3 */
  path: string;
  baudRate: number;
  /** open timeout in ms; the open attempt is aborted after this long */
  openTimeoutMs?: number;
  /** error handler — serialport errors after open (disconnects etc.) */
  onError?: (err: Error) => void;
}

/**
 * the production transport. exactly one instance per device path;
 * the OS won't allow a second open while one is held.
 */
export class SerialPortTransport implements ByteTransport {
  private port: SerialPort | null = null;
  private readonly path: string;
  private readonly baudRate: number;
  private readonly openTimeoutMs: number;
  private readonly onError: (err: Error) => void;

  constructor(options: SerialPortTransportOptions) {
    this.path = options.path;
    this.baudRate = options.baudRate;
    this.openTimeoutMs = options.openTimeoutMs ?? 10_000;
    this.onError = options.onError ?? ((err) => console.warn(`[mini-thermal] SerialPort error: ${err.message}`));
  }

  private ensurePort(): SerialPort {
    if (!this.port) {
      // hupcl:false — see file header; autoOpen:false — we control opening
      this.port = new SerialPort({
        path: this.path,
        baudRate: this.baudRate,
        hupcl: false,
        autoOpen: false,
      });
      this.port.on('error', (err) => this.onError(err));
    }
    return this.port;
  }

  async open(): Promise<void> {
    if (this.port?.isOpen) return;
    const port = this.ensurePort();
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(
        () => reject(new Error(`Port open timed out after ${this.openTimeoutMs}ms`)),
        this.openTimeoutMs,
      );
      port.open((err) => {
        clearTimeout(timeout);
        if (err) return reject(new Error(`Cannot open port: ${err.message}`));
        resolve();
      });
    });
  }

  async write(data: Uint8Array): Promise<void> {
    if (!this.port?.isOpen) throw new Error('SerialPortTransport: write before open()');
    await new Promise<void>((resolve, reject) => {
      this.port!.write(data as Buffer, (err) => {
        if (err) return reject(err);
        resolve();
      });
    });
  }

  async close(): Promise<void> {
    const port = this.port;
    if (!port || !port.isOpen) return;
    await new Promise<void>((resolve) => port.close(() => resolve()));
  }

  get isOpen(): boolean {
    return this.port?.isOpen ?? false;
  }
}

/** lists available serial ports — helps users find their printer */
export async function listSerialPorts(): Promise<{ path: string; manufacturer?: string }[]> {
  const ports = await SerialPort.list();
  return ports.map((p) => ({ path: p.path, manufacturer: p.manufacturer }));
}