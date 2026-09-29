import { describe, expect, it } from 'vitest';
import { computeWriteDelay } from './pacing';
import { DEFAULT_PACING } from './constants';

const { baseMs, newlineMs, feedMs, initMs } = DEFAULT_PACING;

describe('computeWriteDelay', () => {
  it('transmit time: bytes × 10 bits at baud rate, plus base margin', () => {
    // 100 bytes at 9600 baud = 1000 bits = ~104.2ms + 10 base
    expect(computeWriteDelay(Uint8Array.of(1, 2, 3), 9600)).toBe(
      Math.ceil((3 * 10 * 1000) / 9600) + baseMs,
    );
    expect(computeWriteDelay(new Uint8Array(100), 9600)).toBe(105 + baseMs);
  });

  it('adds newline penalty per 0x0a byte', () => {
    const data = Uint8Array.of(0x0a, 0x0a, 0x0a);
    expect(computeWriteDelay(data, 9600)).toBe(
      Math.ceil((3 * 10 * 1000) / 9600) + baseMs + 3 * newlineMs,
    );
  });

  it('adds feed penalty per ESC d n line count', () => {
    const data = Uint8Array.of(0x1b, 0x64, 0x03); // feed 3
    expect(computeWriteDelay(data, 9600)).toBe(
      Math.ceil((3 * 10 * 1000) / 9600) + baseMs + 3 * feedMs,
    );
  });

  it('adds init penalty for ESC @', () => {
    const data = Uint8Array.of(0x1b, 0x40);
    expect(computeWriteDelay(data, 9600)).toBe(
      Math.ceil((2 * 10 * 1000) / 9600) + baseMs + initMs,
    );
  });

  it('handles multi-command buffers (init + feed + newline text)', () => {
    const data = new Uint8Array([
      0x1b, 0x40,             // init
      0x1b, 0x64, 0x04,       // feed 4
      0x41, 0x42, 0x0a,       // "AB\n"
    ]);
    const expected =
      Math.ceil((8 * 10 * 1000) / 9600) + baseMs + initMs + 4 * feedMs + 1 * newlineMs;
    expect(computeWriteDelay(data, 9600)).toBe(expected);
  });

  it('pacing overrides replace individual penalties', () => {
    const data = Uint8Array.of(0x1b, 0x64, 0x02);
    const custom = { feedMs: 100 };
    expect(computeWriteDelay(data, 9600, custom)).toBe(
      Math.ceil((3 * 10 * 1000) / 9600) + baseMs + 2 * 100,
    );
  });

  it('does not mistake other ESC commands for feeds or inits', () => {
    // ESC E 1 (bold) must not trigger any penalty
    const data = Uint8Array.of(0x1b, 0x45, 0x01);
    expect(computeWriteDelay(data, 9600)).toBe(
      Math.ceil((3 * 10 * 1000) / 9600) + baseMs,
    );
  });
});