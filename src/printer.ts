// ============================================================
// ThermalPrinter — job execution, port lifecycle, mutex + cooldown
// ============================================================
//
// one instance wraps one physical printer. unlike the original
// driver's module-level singletons, all state lives on the instance,
// so tests and multi-printer setups work naturally.
//
// usage pattern (single shared device):
//   const lock = printer.tryAcquire();       // sync, race-free
//   if (!lock.ok) return busy();
//   try { await printer.print(job); }
//   finally { printer.release(); }

import {
  DC2,
  DEFAULT_BAUD_RATE,
  DEFAULT_COOLDOWN_MS,
  DEFAULT_DOT_PRINT_MS,
  DEFAULT_OPEN_TIMEOUT_MS,
  DEFAULT_SETTLE_MS,
  type PacingProfile,
} from './constants';
import { cmdInit, cmdPrintDensity } from './commands';
import { pacedWrite, sleep } from './pacing';
import type { ByteTransport } from './transport';
import type { BitmapResult } from './image';

/** a print job is an ordered list of actions */
export type PrintAction =
  | { type: 'chunks'; data: Uint8Array[] }
  | { type: 'bitmap'; data: BitmapResult };

export interface PrinterState {
  status: 'READY' | 'BUSY';
  /** convenience for status LEDs: green = ready, red = busy/cooldown */
  ledColor: 'green' | 'red';
  cooldownRemainingMs: number;
}

export interface ThermalPrinterOptions {
  /** target baud rate for pacing math (default 9600) */
  baudRate?: number;
  /** density byte sent after init on each job (0–63). omit to keep the printer's own default */
  density?: number;
  /** cooldown between jobs in ms (default 10 000) */
  cooldownMs?: number;
  /** settle time after a job before closing the port (default 2000) */
  settleMs?: number;
  /** per-bitmap-row delay in ms (default 20) */
  dotPrintMs?: number;
  /** open timeout for the transport in ms (default 10 000) */
  openTimeoutMs?: number;
  /** pacing overrides — change only if your printer behaves differently */
  pacing?: Partial<PacingProfile>;
  /**
   * skip all write delays (dry runs against mock transports, CI).
   * never enable with real hardware.
   */
  noPace?: boolean;
  /** optional logger (defaults to console with a `[mini-thermal]` prefix) */
  log?: (message: string) => void;
}

export interface AcquireResult extends PrinterState {
  /** true if the caller now owns the printer lock */
  ok: boolean;
}

/**
 * drives a single thermal printer over a {@link ByteTransport}.
 * the transport is injected — `mini-thermal/node` provides the
 * serialport-backed one.
 */
export class ThermalPrinter {
  readonly baudRate: number;
  private readonly cooldownMs: number;
  private readonly settleMs: number;
  private readonly dotPrintMs: number;
  private readonly openTimeoutMs: number;
  private readonly density?: number;
  private readonly pacing: Partial<PacingProfile> | false;
  private readonly log: (message: string) => void;

  private printing = false;
  private lastPrintEnd = 0;
  private transport: ByteTransport | null = null;

  constructor(
    private readonly createTransport: (opts: { openTimeoutMs: number }) => ByteTransport,
    options: ThermalPrinterOptions = {},
  ) {
    this.baudRate = options.baudRate ?? DEFAULT_BAUD_RATE;
    this.cooldownMs = options.cooldownMs ?? DEFAULT_COOLDOWN_MS;
    this.settleMs = options.settleMs ?? DEFAULT_SETTLE_MS;
    this.dotPrintMs = options.dotPrintMs ?? DEFAULT_DOT_PRINT_MS;
    this.openTimeoutMs = options.openTimeoutMs ?? DEFAULT_OPEN_TIMEOUT_MS;
    this.density = options.density;
    this.pacing = options.noPace ? false : (options.pacing ?? {});
    this.log = options.log ?? ((m) => console.log(`[mini-thermal] ${m}`));
  }

  // ----------------------------------------------------------
  // concurrency & cooldown
  // ----------------------------------------------------------

  /**
   * atomically attempts to acquire the printer. MUST be called
   * synchronously (before any `await`) so the check-and-set is
   * race-free on Node's single thread. on success the caller owns
   * the lock and MUST call {@link release} in a `finally`.
   */
  tryAcquire(): AcquireResult {
    if (this.printing) {
      return { ok: false, status: 'BUSY', ledColor: 'red', cooldownRemainingMs: this.cooldownMs };
    }
    const elapsed = Date.now() - this.lastPrintEnd;
    if (elapsed < this.cooldownMs) {
      return {
        ok: false,
        status: 'BUSY',
        ledColor: 'red',
        cooldownRemainingMs: this.cooldownMs - elapsed,
      };
    }
    this.printing = true;
    return { ok: true, status: 'READY', ledColor: 'green', cooldownRemainingMs: 0 };
  }

  /**
   * releases the printer lock and anchors the cooldown timer at
   * completion time — a second job can never start while the first
   * still holds the port.
   */
  release(): void {
    this.printing = false;
    this.lastPrintEnd = Date.now();
  }

  /** current state for status LEDs / endpoints */
  getState(): PrinterState {
    if (this.printing) {
      return { status: 'BUSY', ledColor: 'red', cooldownRemainingMs: this.cooldownMs };
    }
    const elapsed = Date.now() - this.lastPrintEnd;
    if (elapsed < this.cooldownMs) {
      return {
        status: 'BUSY',
        ledColor: 'red',
        cooldownRemainingMs: this.cooldownMs - elapsed,
      };
    }
    return { status: 'READY', ledColor: 'green', cooldownRemainingMs: 0 };
  }

  /** whether a print job is currently in flight (lock held) */
  get busy(): boolean {
    return this.printing;
  }

  // ----------------------------------------------------------
  // port lifecycle
  // ----------------------------------------------------------

  /** opens the transport (idempotent). */
  async open(): Promise<void> {
    if (this.transport?.isOpen) return;
    if (!this.transport) {
      this.transport = this.createTransport({ openTimeoutMs: this.openTimeoutMs });
    }
    await this.transport.open();
  }

  /**
   * closes the transport if one is open. used by graceful shutdown
   * paths so process termination never leaves the serial device
   * locked (an orphaned FTDI lock blocks all future opens).
   */
  async close(): Promise<void> {
    const t = this.transport;
    this.transport = null;
    if (t && t.isOpen) await t.close();
  }

  // ----------------------------------------------------------
  // printing
  // ----------------------------------------------------------

  /**
   * prints a job: opens the transport, sends init (+ density, if
   * configured), executes the actions in order (text chunks are
   * paced writes; bitmaps go row-by-row with dot-print delays),
   * waits for the mechanics to settle and closes the transport.
   * on error the transport is closed before rethrowing.
   *
   * does NOT manage the lock — pair with tryAcquire/release so
   * callers can decide how BUSY is surfaced.
   */
  async print(job: PrintAction[]): Promise<void> {
    await this.open();
    const transport = this.transport!;

    const header: Uint8Array[] = [cmdInit()];
    if (this.density !== undefined) {
      header.push(cmdPrintDensity(this.density));
    }

    this.log('Commencing print job...');
    try {
      for (const chunk of header) {
        await pacedWrite(transport, chunk, this.baudRate, this.pacing);
      }
      for (const action of job) {
        if (action.type === 'chunks') {
          for (const chunk of action.data) {
            await pacedWrite(transport, chunk, this.baudRate, this.pacing);
          }
        } else {
          await this.printBitmapRows(transport, action.data);
        }
      }
      this.log('Waiting for mechanical print completion...');
      if (this.pacing !== false) await sleep(this.settleMs);
      this.log('✓ Print job complete.');
    } finally {
      await this.close();
      this.log('Port closed.');
    }
  }

  /** sends a bitmap row-by-row using the Adafruit DC2 * command. */
  private async printBitmapRows(transport: ByteTransport, bitmap: BitmapResult): Promise<void> {
    const { rows, bytesPerRow } = bitmap;
    for (let i = 0; i < rows.length; i++) {
      // DC2 * 1 <bytesPerRow> [row data]
      const payload = new Uint8Array(4 + bytesPerRow);
      payload[0] = DC2;
      payload[1] = 0x2a; // '*'
      payload[2] = 1;
      payload[3] = bytesPerRow;
      payload.set(rows[i]!, 4);

      await pacedWrite(transport, payload, this.baudRate, this.pacing);
      if (this.pacing !== false) await sleep(this.dotPrintMs);

      if ((i + 1) % 24 === 0 || (i + 1) === rows.length) {
        this.log(`Bitmap rows printed: ${i + 1}/${rows.length}`);
      }
    }
    this.log(`Bitmap complete: ${rows.length} rows sent.`);
  }
}