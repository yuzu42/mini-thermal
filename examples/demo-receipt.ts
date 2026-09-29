// ============================================================
// demo receipt
// ============================================================
//
// usage:
//   npm run demo -- --port /dev/cu.usbserial-A5069RR4
//   npm run demo -- --port /dev/cu.usbserial-A5069RR4 --density 15
//   npm run demo -- --image ./logo.png --no-image

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
import {
  createPrinter,
  imageToBitmapRows,
  cmdJustify,
  cmdBold,
  cmdDoubleHeight,
  cmdFeed,
  text,
  textWrapped,
  divider,
  DENSITY,
  type PrintAction,
} from '../src/node';

// ------------------------------------------------------------
// CLI args
// ------------------------------------------------------------

const args = process.argv.slice(2);
function argValue(name: string, fallback?: string): string | undefined {
  const i = args.indexOf(`--${name}`);
  if (i === -1) return fallback;
  return args[i + 1];
}
const hasFlag = (name: string) => args.includes(`--${name}`);

const PORT = argValue('port') ?? process.env.PRINTER_PORT ?? '/dev/cu.usbserial-A5069RR4';
const DENSITY_ARG = argValue('density');
const NO_IMAGE = hasFlag('no-image');
const IMAGE = argValue('image') ?? path.resolve(__dirname, '../assets/logo.png');
const DRY_RUN = hasFlag('dry-run');

// a tiny embedded logo (1×1 fallback PNG, base64) in case --no-image
// wasn't passed but no file is present
const FALLBACK_LOGO_B64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

async function main(): Promise<void> {
  const density =
    DENSITY_ARG !== undefined
      ? DENSITY_ARG.startsWith('0x') || DENSITY_ARG.startsWith('0X')
        ? parseInt(DENSITY_ARG, 16)
        : Number(DENSITY_ARG)
      : DENSITY.DEFAULT;

  console.log(`[demo] printer: ${PORT}${DRY_RUN ? ' (DRY RUN)' : ''}, density: ${density}`);

  // 1. decode logo → bitmap rows (skip with --no-image)
  let logoBitmap = null;
  if (!NO_IMAGE) {
    try {
      const source = fs.existsSync(IMAGE)
        ? fs.readFileSync(IMAGE)
        : `data:image/png;base64,${FALLBACK_LOGO_B64}`;
      console.log(`[demo] loading image: ${fs.existsSync(IMAGE) ? IMAGE : '(embedded 1×1 fallback)'}`);
      logoBitmap = await imageToBitmapRows(source, { maxWidth: 384, maxHeight: 600 });
    } catch (err) {
      console.warn('[demo] image failed, printing text-only receipt.', err);
    }
  }

  // 2. build the job
  const actions: PrintAction[] = [];
  let chunks: Uint8Array[] = [];

  // header — store identity
  chunks.push(cmdFeed(1));
  chunks.push(cmdJustify('C'));
  chunks.push(cmdBold(true));
  chunks.push(text('GREEN VALLEY ORGANICS'));
  chunks.push(cmdBold(false));
  chunks.push(text('Neighborhood organic grocery'));
  chunks.push(text('14 Meadow Lane'));
  chunks.push(text('98765 Riverton'));
  chunks.push(text('+1 555 014 2288'));
  chunks.push(cmdFeed(1));
  chunks.push(text(new Date().toLocaleString('en-US')));
  chunks.push(text('Receipt #0417'));
  chunks.push(text('Cashier: Sam / Lane 2'));
  chunks.push(text('All prices in EUR'));
  chunks.push(cmdFeed(1));
  chunks.push(text(`${divider('-', 13)} YOUR PURCHASE ${divider('-', 13)}`.slice(0, 32)));
  chunks.push(cmdJustify('L'));
  chunks.push(cmdFeed(1));

  // logo
  if (logoBitmap) {
    if (chunks.length > 0) {
      actions.push({ type: 'chunks', data: chunks });
      chunks = [];
    }
    actions.push({ type: 'bitmap', data: logoBitmap });
  }

  // item list
  chunks.push(cmdJustify('L'));
  chunks.push(cmdFeed(1));
  chunks.push(text('Avocados (2, organic)       3.50'));
  chunks.push(text('Sourdough loaf              4.25'));
  chunks.push(text('Oat milk 1L                 2.80'));
  chunks.push(text('Free-range eggs x6          3.90'));
  chunks.push(text('Kale, bunch                 2.40'));
  chunks.push(text('Tomatoes, 500g              3.15'));
  chunks.push(text('Fairtrade coffee 250g       7.99'));
  chunks.push(text('Dark chocolate 85%          2.75'));
  chunks.push(cmdFeed(1));

  // totals
  chunks.push(text(divider('-')));
  chunks.push(text('Subtotal                   30.74'));
  chunks.push(text('Member discount (5%)       -1.54'));
  chunks.push(text('VAT (7%)                    2.04'));
  chunks.push(text(divider('-')));
  chunks.push(cmdJustify('C'));
  chunks.push(cmdBold(true));
  chunks.push(cmdDoubleHeight(true));
  chunks.push(text('TOTAL: 31.24'));
  chunks.push(cmdDoubleHeight(false));
  chunks.push(cmdBold(false));
  chunks.push(cmdJustify('L'));
  chunks.push(text('Paid with card - Contactless'));
  chunks.push(cmdFeed(1));

  // loyalty program
  chunks.push(text(divider('-')));
  chunks.push(cmdJustify('C'));
  chunks.push(cmdBold(true));
  chunks.push(text('EARN 1 POINT PER 2 EUR SPENT'));
  chunks.push(cmdBold(false));
  chunks.push(text('You earned 15 points today'));
  chunks.push(text('Balance: 145 points'));
  chunks.push(cmdJustify('L'));
  chunks.push(text(divider('-')));
  chunks.push(cmdFeed(1));

  // newsletter / coupon — word-wrapped via the lib helper
  chunks.push(cmdBold(true));
  chunks.push(text('A LITTLE THANK YOU:'));
  chunks.push(cmdBold(false));
  const message =
    'Show this receipt within two weeks and get 10% off your next ' +
    'basket of fresh, seasonal produce - straight from local farms.';
  for (const line of textWrapped(message)) chunks.push(line);
  chunks.push(text(divider('-')));
  chunks.push(cmdFeed(1));

  // sustainability note — the double-height block
  chunks.push(cmdJustify('C'));
  chunks.push(text('THIS RECEIPT WAS PRINTED'));
  chunks.push(text('ON RECYCLED PAPER'));
  chunks.push(cmdFeed(1));
  chunks.push(cmdDoubleHeight(true));
  chunks.push(cmdBold(true));
  chunks.push(cmdJustify('C'));
  chunks.push(text('THANK YOU'));
  chunks.push(cmdDoubleHeight(false));
  chunks.push(cmdBold(false));
  chunks.push(text('For shopping sustainably'));
  chunks.push(cmdFeed(1));

  // footer
  chunks.push(text(divider('=')));
  chunks.push(cmdJustify('C'));
  chunks.push(text('Questions about your order?'));
  chunks.push(text('hello@greenvalley.example'));
  chunks.push(text('Returns accepted within 14 days'));
  chunks.push(cmdFeed(4)); // push receipt past the tear bar

  actions.push({ type: 'chunks', data: chunks });

  // 3. print with lock/cooldown semantics, release on shutdown
  const printer = DRY_RUN
    ? null
    : createPrinter({ path: PORT, baudRate: 9600, density, log: (m) => console.log(`[demo] ${m}`) });

  if (!printer) {
    console.log('[demo] dry run: not sending anything. job summary:');
    console.log(`  ${actions.length} actions, ${chunks.length} trailing chunks`);
    return;
  }

  const lock = printer.tryAcquire();
  if (!lock.ok) {
    console.log(`[demo] printer busy (cooldown ${lock.cooldownRemainingMs}ms) — try again later.`);
    return;
  }

  try {
    await printer.print(actions);
  } catch (err) {
    console.error('[demo] print failed:', err);
    process.exitCode = 1;
  } finally {
    printer.release();
  }
}

// graceful shutdown: release the serial lock on SIGINT/SIGTERM
for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    console.log(`\n[demo] ${signal} received.`);
    process.exit(0);
  });
}

main().catch((err) => {
  console.error('[demo] fatal:', err);
  process.exit(1);
});