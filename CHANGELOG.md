# Changelog

## 0.1.0 — 2026-09-29

Initial release. Extracted from the Superfive exhibition installation's
production driver (`backend/src/services/printer.ts`), preserving every
hardware observation gathered there:

- ESC/POS + Adafruit DC2 command builders (`cmdInit`, `cmdJustify`,
  `cmdBold`, `cmdInverse`, `cmdDoubleHeight`, `cmdSize`, `cmdFeed`,
  `cmdPrintDensity`, `text`, `textNoNewline`) with density presets.
- Time-paced writes (`pacedWrite` / `computeWriteDelay`): transmit-time
  simulation at the configured baud rate plus empirically tuned per-newline
  (60 ms), per-feed-line (80 ms) and init (150 ms) delays — the printer has a
  tiny RX buffer and no hardware flow control.
- Text helpers: `wrapText` / `textWrapped` (hyphen-aware word wrap for the
  32-char standard font), `divider`, `sanitize` (extensible umlaut
  transliteration).
- Image pipeline: decode → resize (multiple-of-8 widths) → greyscale →
  contrast → 18 % darken → Floyd-Steinberg dithering (optional threshold
  mode) → 1-bit packing, centered on the 384-dot print head (left/right
  alignment options).
- `ThermalPrinter`: per-job port lifecycle (`hupcl: false`, `autoOpen: false`,
  open timeout), row-by-row DC2 * bitmap printing with 20 ms dot timing,
  post-job settle, and an in-flight mutex + completion-anchored cooldown
  (`tryAcquire` / `release` / `getState`).
- Node adapters: `SerialPortTransport` (serialport), `JimpProcessor` (jimp),
  `createPrinter` factory, `listSerialPorts`.
- Runtime-agnostic core: all bytes are `Uint8Array`; transport and image
  decoding sit behind small interfaces (`ByteTransport`, `ImageProcessor`) so
  Web Serial or other runtimes can be added without touching the core.
- `MockTransport` for tests and dry runs; vitest suite with byte-level golden
  tests.