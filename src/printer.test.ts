import { describe, expect, it, vi } from 'vitest';
import { ThermalPrinter, type ThermalPrinterOptions } from './printer';
import { MockTransport } from './transport';
import { cmdInit, cmdPrintDensity, text } from './commands';
import type { BitmapResult } from './image';

function fakeBitmap(rows = 2, bytesPerRow = 48): BitmapResult {
  const row = new Uint8Array(bytesPerRow).fill(0xff);
  return { rows: Array.from({ length: rows }, () => row.slice()), width: 384, height: rows, bytesPerRow };
}

function makePrinter(options: Partial<ThermalPrinterOptions> = {}) {
  const transport = new MockTransport();
  const printer = new ThermalPrinter(() => transport, { noPace: true, log: () => {}, ...options });
  return { printer, transport };
}

describe('ThermalPrinter', () => {
  it('acquires, prints, releases with cooldown-anchored-at-completion semantics', () => {
    const { printer } = makePrinter();
    const lock = printer.tryAcquire();
    expect(lock.ok).toBe(true);
    expect(printer.busy).toBe(true);
    // while held: second acquire fails
    expect(printer.tryAcquire().ok).toBe(false);
    printer.release();
    // after release: cooldown window active
    const state = printer.getState();
    expect(state.status).toBe('BUSY');
    expect(state.cooldownRemainingMs).toBeGreaterThan(0);
    expect(printer.tryAcquire().ok).toBe(false);
  });

  it('tryAcquire after cooldown elapse succeeds', async () => {
    const { printer } = makePrinter({ cooldownMs: 20 });
    expect(printer.tryAcquire().ok).toBe(true);
    printer.release();
    expect(printer.tryAcquire().ok).toBe(false);
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(printer.tryAcquire().ok).toBe(true);
  });

  it('print sends init (+density) then chunks in order and closes the port', async () => {
    const { printer, transport } = makePrinter();
    await printer.print([{ type: 'chunks', data: [text('hello'), text('world')] }]);

    const stream = transport.stream;
    // init + "hello\n" + "world\n" — density omitted → just init
    const expected = [
      ...cmdInit(),
      ...text('hello'),
      ...text('world'),
    ];
    expect([...stream]).toEqual(expected);
    expect(transport.wasClosed).toBe(true);
  });

  it('print sends density when configured', async () => {
    const transport = new MockTransport();
    const printer = new ThermalPrinter(() => transport, { noPace: true, density: 15, log: () => {} });
    await printer.print([{ type: 'chunks', data: [text('x')] }]);
    const stream = [...transport.stream];
    // init is 2 bytes, density (DC2 # 15) is 3 bytes
    expect(stream.slice(0, 2)).toEqual([...cmdInit()]);
    expect(stream.slice(2, 5)).toEqual([...cmdPrintDensity(15)]);
  });

  it('print interleaves chunks and bitmaps (DC2 * rows)', async () => {
    const { printer, transport } = makePrinter();
    const bitmap = fakeBitmap(2);
    await printer.print([
      { type: 'chunks', data: [text('a')] },
      { type: 'bitmap', data: bitmap },
      { type: 'chunks', data: [text('b')] },
    ]);

    const writes = transport.writes.map((w) => [...w]);
    // init, a, row0, row1, b
    expect(writes.length).toBe(5);
    expect(writes[0]).toEqual([...cmdInit()]);
    expect(writes[1]).toEqual([...text('a')]);
    // DC2 * 1 48 header + row data
    expect(writes[2]!.slice(0, 4)).toEqual([0x12, 0x2a, 1, 48]);
    expect(writes[2]!.slice(4)).toEqual(Array(48).fill(0xff));
    expect(writes[3]!.slice(0, 4)).toEqual([0x12, 0x2a, 1, 48]);
    expect(writes[4]).toEqual([...text('b')]);
  });

  it('closes the transport even when a write fails mid-job', async () => {
    class FailingTransport extends MockTransport {
      override async write(data: Uint8Array): Promise<void> {
        if (data.includes(0x0a)) throw new Error('boom');
        return super.write(data);
      }
    }
    const transport = new FailingTransport();
    const printer = new ThermalPrinter(() => transport, { noPace: true, log: () => {} });
    await expect(
      printer.print([{ type: 'chunks', data: [text('hello')] }]),
    ).rejects.toThrow('boom');
    expect(transport.wasClosed).toBe(true);
  });

  it('pacing writes with the expected delays (integration with real timers)', async () => {
    vi.useFakeTimers();
    try {
      const transport = new MockTransport();
      const printer = new ThermalPrinter(() => transport, { log: () => {} }); // pacing on
      const promise = printer.print([{ type: 'chunks', data: [text('x')] }]);
      // "x\n" = 2 bytes → 2×10×1000/9600 = 2.08 → ceil 3ms transmit + 10 base + 60 newline = 73ms
      // init 2 bytes → 3ms + 10 base + 150 init = 163ms. settle 2000ms on top.
      await vi.advanceTimersByTimeAsync(73 + 163 + 2000 + 100);
      await promise;
      expect(transport.writes.length).toBe(2); // init + text
    } finally {
      vi.useRealTimers();
    }
  });

  it('getState reports READY for a fresh printer', () => {
    const { printer } = makePrinter();
    const state = printer.getState();
    expect(state).toEqual({ status: 'READY', ledColor: 'green', cooldownRemainingMs: 0 });
  });
});

describe('MockTransport', () => {
  it('rejects writes before open', async () => {
    const t = new MockTransport();
    await expect(t.write(Uint8Array.of(1))).rejects.toThrow('before open');
  });

  it('copies writes defensively', async () => {
    const t = new MockTransport();
    await t.open();
    const data = Uint8Array.of(1, 2, 3);
    await t.write(data);
    data[0] = 99;
    expect(t.writes[0]![0]).toBe(1);
  });
});