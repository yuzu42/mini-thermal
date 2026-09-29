# mini-thermal

A TypeScript driver library for Adafruit-style mini thermal printers (384-dot head) over serial, written after a semester of hardware trial-and-error.

The magic numbers were measured against several hardware tests and are documented below.

## Install

```bash
npm install mini-thermal
```

Node ≥ 18. `serialport` and `jimp` ship as regular dependencies; the core (`mini-thermal`) is runtime-agnostic (pure `Uint8Array`), so browser/Web-Serial transports can be added easily.

## Quick start

```ts
import { createPrinter, imageToBitmapRows, cmdJustify, cmdBold, cmdDoubleHeight, cmdFeed, text, divider, DENSITY } from 'mini-thermal/node';

const printer = createPrinter({ path: '/dev/cu.usbserial-A5069RR4', density: DENSITY.DEFAULT });

const lock = printer.tryAcquire();            // sync: call before any await!
if (!lock.ok) {
  console.log(`busy, cooldown ${lock.cooldownRemainingMs}ms`);
} else {
  try {
    const logo = await imageToBitmapRows(logoBytes, { maxWidth: 384, maxHeight: 600 });
    await printer.print([
      { type: 'bitmap', data: logo },
      { type: 'chunks', data: [
        cmdFeed(1), cmdJustify('C'), text('HELLO WORLD'), cmdFeed(4),
      ]},
    ]);
  } finally {
    printer.release();
  }
}
```

You can find available ports using `listSerialPorts()`.

## Hardware notes (probably important stuff)

### Wiring

| FTDI adapter pin | Printer pin | Wire |
|---|---|---|
| TX | RX | yellow |
| RX | TX | green |
| GND | GND | black |
| — | VH (5–9 V) | external PSU, **min. 1.5 A** |

The adapter's logic supply does not power the motor/heater. The VH pin needs its own supply.

### Pacing (RX-buffer protection)

After every write the driver sleeps for the simulated transmit time plus per-command penalties measured on hardware:

| Delay | Trigger | Default |
|---|---|---|
| transmit time | `bytes × 10 bits / baud` | — |
| base margin | every write | 10 ms |
| newline | each `0x0a` byte | 60 ms |
| line feed | each line of `ESC d n` | 80 ms per line |
| init | each `ESC @` | 150 ms |
| bitmap row | after each `DC2 *` row | 20 ms |
| settle | after a whole job, before closing the port | 2000 ms |

Override per-printer via `pacing: Partial<PacingProfile>` in options; disable entirely with `noPace: true` (mocks/CI only, never on hardware).

### Serial flags

The transport opens with `hupcl: false` and `autoOpen: false`:

- `hupcl: false` stops the FTDI adapter from toggling DTR on open/close. A DTR blip resets the printer mid-job.
- `autoOpen: false` keeps open failures inside our own timeout handling instead of throwing from the constructor.

You should always close the port before your process exits (a crash that leaves the serial device locked makes the next open fail with `Resource temporarily unavailable` until the adapter is re-plugged). `printer.close()` is idempotent; wire it to `SIGTERM`/`SIGINT`.

### Print density (heat)

`DC2 # n` packs two nibbles: upper = **heat dots** (0–3 → 20/40/60/80 dots firing simultaneously), lower = **heat time** (0–15, pulse duration). Higher = darker.

| Preset | Value | Notes |
|---|---|---|
| `DENSITY.LIGHT` | 0x00 | printer factory default, usually too faint |
| `DENSITY.DEFAULT` | 0x0F | max heat time, minimum dots; good starting point |
| `DENSITY.DARK` | 0x2F | max heat time, second dot level |
| `DENSITY.MAX` | 0x3F | maximum darkness, may overheat or smear |

Cheap paper stock often needs more heat; pass `density` in printer options.

### Geometry

- print head: **384 dots** = 48 bytes per row
- standard font: **32 chars per line**
- default image print width: **256 px** (multiple of 8, faster than full-width)
- image width is always floored to a multiple of 8 (bit-packed rows), height capped (default 300; the demo uses 600 for logos)

### Image pipeline

`imageToBitmapRows(source, options)` decodes (PNG/JPEG, raw bytes or data-URL), then it will:

1. resize to the computed size (multiple-of-8 width)
2. greyscale (ITU Rec 709 luminance) + contrast **+0.25**
3. darken ×0.82. Thermal output looks washed out without ~18 % pre-darkening; it shifts the dithering equilibrium so light grays print solid.
4. Floyd-Steinberg dithering (or `dither: 'threshold'` for hard two-tone)
5. pack to 1-bit rows, by default centered on the 384-dot page (`align: 'left' | 'center' | 'right'`)

Transparency prints as white. All numbers are options (`darken`, `contrast`, `threshold`).

### Charset

The printer's charset doesn't render umlauts, so `sanitize()` transliterates (ä→ae, ß→ss, …) with an extensible map (`sanitize(str, myMap)`). Text is encoded as latin1; characters outside it are truncated to their low byte (garbage in, garbage out).

## API surface

| Entry | Exports |
|---|---|
| `mini-thermal` | constants, command builders (`cmdInit`, `cmdJustify`, `cmdBold`, `cmdInverse`, `cmdDoubleHeight`, `cmdSize`, `cmdFeed`, `cmdPrintDensity`, `text`, `textNoNewline`), text helpers (`wrapText`, `textWrapped`, `divider`, `sanitize`, `toLatin1`), pacing (`computeWriteDelay`, `pacedWrite`), `ByteTransport` + `MockTransport`, image pipeline (`imageToBitmap`, `computeBitmapSize`, types), `ThermalPrinter` |
| `mini-thermal/node` | everything above + `SerialPortTransport`, `listSerialPorts`, `JimpProcessor`, `createPrinter`, `imageToBitmapRows` |

### ThermalPrinter

- `new ThermalPrinter(createTransport, options)` — transport injected; core stays runtime-agnostic
- `tryAcquire()` / `release()` / `getState()`: call `tryAcquire` synchronously (before any `await`). The lock is held for the whole job and the cooldown timer anchors at job *completion*, so a second job can never open the port while the first still holds it
- `print(job)` — opens port, sends `ESC @` (+ density if set), executes actions (chunks / bitmaps), settles, closes. Closes the port even on error.
- `open()` / `close()` — explicit lifecycle for shutdown paths
- `busy` — in-flight flag

### Options

`baudRate` (9600), `density`, `cooldownMs` (10 s), `settleMs` (2000), `dotPrintMs` (20), `openTimeoutMs` (10 s), `pacing` overrides, `noPace`, `log`.

## Example

`examples/demo-receipt.ts` prints a complete receipt (logo bitmap, header, profile sections, big reveal factor, footer) using only the public API:

```bash
npm run demo -- --port /dev/cu.usbserial-A5069RR4
npm run demo -- --dry-run          # build & lock/cooldown logic, no hardware
npm run demo -- --no-image         # text-only
npm run demo -- --image ./foo.png  # custom image
npm run demo -- --density 0x2f     # darker print
```

## Development

```bash
npm test          # vitest (56 tests)
npm run typecheck
npm run build     # tsup → dist/ (ESM + CJS + d.ts)
npm run demo      # examples/demo-receipt.ts (needs hardware)
```

`scripts/parity-check.ts` is a one-off harness that proves this library emits a **byte-identical stream** to the reference driver it was extracted from (init + density + text + 288-row dithered bitmap):

```bash
IMPRINT_SOURCE=/path/to/im-software/backend/src/services/printer.ts npx tsx scripts/parity-check.ts
# → ✓ PARITY OK — byte streams are identical.
```

## Known limitations / future work

- write-only: no status read-back (`ESC v` paper-out) yet. RX is wired and the command set supports it.
- no native barcode commands (`GS k`) yet
- umlauts are handled by lossy transliteration; a codepage option (`ESC R n`) would render them natively

## License

MIT — see [LICENSE](LICENSE).