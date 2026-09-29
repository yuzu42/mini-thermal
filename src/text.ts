// ============================================================
// text helpers: latin1 encoding, word wrap, dividers, sanitization
// ============================================================

import { LINE_WIDTH_CHARS } from './constants';
import { text } from './commands';

/** encode a string as latin1 bytes (code units truncated to one byte). */
export function toLatin1(str: string): Uint8Array {
  const out = new Uint8Array(str.length);
  for (let i = 0; i < str.length; i++) out[i] = str.charCodeAt(i) & 0xff;
  return out;
}

/** a full-width divider line, e.g. `divider('=')` → "================". */
export function divider(char = '-', width = LINE_WIDTH_CHARS): string {
  return char.repeat(width);
}

/**
 * word-wraps a string to the printer's line width (32 chars in the
 * standard font), breaking at spaces so the printer never pushes a
 * stray trailing character onto its own line. words longer than
 * `width` are broken at an interior hyphen where possible, otherwise
 * hard-split. existing newlines are preserved; runs of multiple
 * spaces collapse to one.
 *
 * @returns one string per physical line.
 */
export function wrapText(str: string, width = LINE_WIDTH_CHARS): string[] {
  const out: string[] = [];
  for (const rawLine of str.split('\n')) {
    let line = '';
    const flush = () => {
      out.push(line);
      line = '';
    };
    const place = (word: string) => {
      // a single token wider than the line: break it (prefer after a hyphen).
      while (word.length > width) {
        if (line) flush();
        const hyphen = word.lastIndexOf('-', width - 1);
        const cut = hyphen > 0 ? hyphen + 1 : width;
        out.push(word.slice(0, cut));
        word = word.slice(cut);
      }
      if (!word) return;
      if (!line) line = word;
      else if (line.length + 1 + word.length <= width) line += ' ' + word;
      else {
        flush();
        line = word;
      }
    };
    for (const word of rawLine.split(/ +/)) if (word) place(word);
    flush(); // keep the (possibly empty) line so blank lines survive
  }
  return out;
}

/** like {@link text} but word-wrapped to `width`; returns one buffer per line. */
export function textWrapped(str: string, width = LINE_WIDTH_CHARS): Uint8Array[] {
  return wrapText(str, width).map(text);
}

/**
 * default transliteration map: German umlauts & ß → ASCII pairs.
 * the printer's charset cannot render these.
 */
export const DEFAULT_TRANSLITERATIONS: Readonly<Record<string, string>> = {
  ä: 'ae',
  ö: 'oe',
  ü: 'ue',
  Ä: 'Ae',
  Ö: 'Oe',
  Ü: 'Ue',
  ß: 'ss',
};

/**
 * sanitizes a string for thermal printer output by transliterating
 * characters the printer cannot render (ä→ae, ß→ss, …).
 * pass a custom map to extend or override the defaults.
 */
export function sanitize(
  str: string,
  map: Readonly<Record<string, string>> = DEFAULT_TRANSLITERATIONS,
): string {
  let out = '';
  for (const ch of str) out += map[ch] ?? ch;
  return out;
}