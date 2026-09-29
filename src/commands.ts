// ============================================================
// ESC/POS command builders (Adafruit thermal printer dialect)
// ============================================================
//
// every builder returns a fresh Uint8Array so buffers can be pushed into
// a print job as-is. byte sequences match the reference driver exactly.

import { ESC, GS, DC2 } from './constants';

/** ESC @ — initialize / reset the printer */
export function cmdInit(): Uint8Array {
  return Uint8Array.of(ESC, 0x40);
}

/** ESC a n — justification: left / center / right */
export function cmdJustify(align: 'L' | 'C' | 'R'): Uint8Array {
  return Uint8Array.of(ESC, 0x61, align === 'L' ? 0 : align === 'C' ? 1 : 2);
}

/** ESC E n — bold on/off */
export function cmdBold(on: boolean): Uint8Array {
  return Uint8Array.of(ESC, 0x45, on ? 1 : 0);
}

/** GS B n — white-on-black (inverse) mode on/off */
export function cmdInverse(on: boolean): Uint8Array {
  return Uint8Array.of(GS, 0x42, on ? 1 : 0);
}

/** ESC ! n — double height on/off (leaves width untouched) */
export function cmdDoubleHeight(on: boolean): Uint8Array {
  return Uint8Array.of(ESC, 0x21, on ? 0x10 : 0x00);
}

/** GS ! n — font size S / M (double) / L (quadruple) */
export function cmdSize(size: 'S' | 'M' | 'L'): Uint8Array {
  return Uint8Array.of(GS, 0x21, size === 'S' ? 0x00 : size === 'M' ? 0x11 : 0x22);
}

/** ESC d n — feed (and print) n blank lines */
export function cmdFeed(lines: number): Uint8Array {
  return Uint8Array.of(ESC, 0x64, lines);
}

/**
 * DC2 # n — set print density (heat).
 *
 * n packs two nibbles: upper = “heat dots” (0–3 → 20/40/60/80 dots
 * firing simultaneously), lower = “heat time” (0–15, pulse duration).
 * higher = darker. useful when switching paper stock — cheap paper
 * often needs more heat.
 *
 * @param density 0–63; clamped & rounded. see the DENSITY presets.
 */
export function cmdPrintDensity(density: number): Uint8Array {
  const n = Math.max(0, Math.min(63, Math.round(density)));
  return Uint8Array.of(DC2, 0x23, n);
}

/**
 * encode a text line: latin1 bytes + trailing newline, ready to send.
 * latin1 means each UTF-16 code unit is truncated to one byte — send
 * only characters your printer's charset actually renders (use
 * {@link sanitize} for umlauts).
 */
export function text(str: string): Uint8Array {
  const out = new Uint8Array(str.length + 1);
  for (let i = 0; i < str.length; i++) out[i] = str.charCodeAt(i) & 0xff;
  out[str.length] = 0x0a;
  return out;
}

/** like {@link text} but without the trailing newline */
export function textNoNewline(str: string): Uint8Array {
  const out = new Uint8Array(str.length);
  for (let i = 0; i < str.length; i++) out[i] = str.charCodeAt(i) & 0xff;
  return out;
}