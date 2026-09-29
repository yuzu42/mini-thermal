// ============================================================
// time-based write pacing
// ============================================================
//
// the printer has a tiny RX buffer (64–256 bytes) and no hardware
// flow control. bytes pushed faster than the print head consumes are
// silently dropped — corrupting whatever command they belonged to.
// the fix measured on hardware: after each write, sleep for the
// simulated transmit time plus per-command penalties.

import type { ByteTransport } from './transport';
import { DEFAULT_PACING, type PacingProfile } from './constants';

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * computes the delay (ms) to wait after writing `data` at `baudRate`.
 *
 * - transmit time: bytes × 10 bits (8N1) at the baud rate
 * - + `baseMs` flat margin
 * - + `newlineMs` per 0x0a byte (the printer feeds & prints a line)
 * - + `feedMs` × n for every ESC d n (cmdFeed) found in the buffer
 * - + `initMs` for every ESC @ (cmdInit) found in the buffer
 */
export function computeWriteDelay(
  data: Uint8Array,
  baudRate: number,
  pacing: Partial<PacingProfile> = {},
): number {
  const { baseMs, newlineMs, feedMs, initMs } = { ...DEFAULT_PACING, ...pacing };
  const transmitMs = Math.ceil((data.length * 10 * 1000) / baudRate);

  let delay = transmitMs + baseMs;

  // newline delay
  let newlineCount = 0;
  for (const b of data) if (b === 0x0a) newlineCount++;
  if (newlineCount > 0) delay += newlineCount * newlineMs;

  // ESC d (cmdFeed) delay
  for (let idx = 0; idx <= data.length - 3; idx++) {
    if (data[idx] === 0x1b && data[idx + 1] === 0x64) {
      const lines = data[idx + 2] ?? 1;
      delay += lines * feedMs;
    }
  }

  // ESC @ (cmdInit) delay
  for (let idx = 0; idx <= data.length - 2; idx++) {
    if (data[idx] === 0x1b && data[idx + 1] === 0x40) {
      delay += initMs;
    }
  }

  return delay;
}

/**
 * writes `data` to the transport, then sleeps for the computed
 * transmit + penalty delay (see {@link computeWriteDelay}).
 *
 * pass `false` as the pacing profile to skip all delays — dry runs and
 * tests against a mock transport only; never with real hardware.
 */
export async function pacedWrite(
  transport: ByteTransport,
  data: Uint8Array,
  baudRate: number,
  pacing: Partial<PacingProfile> | false = {},
): Promise<void> {
  await transport.write(data);
  if (pacing === false) return;
  const delay = computeWriteDelay(data, baudRate, pacing);
  if (delay > 0) await sleep(delay);
}