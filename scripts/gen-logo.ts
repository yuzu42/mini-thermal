// one-off generator for assets/logo.png — the demo receipt image.
// dark frame + diagonal stripes + center blob: enough edges and
// grays to make Floyd-Steinberg dithering visible on thermal paper.
import { Jimp } from 'jimp';
import fs from 'node:fs';

const W = 96;
const H = 96;
const img = new Jimp({ width: W, height: H, color: 0xffffffff });

for (let y = 0; y < H; y++) {
  for (let x = 0; x < W; x++) {
    const frame = x < 6 || y < 6 || x >= W - 6 || y >= H - 6;
    const stripe = (x + y) % 16 < 8;
    const r = Math.sqrt((x - W / 2) ** 2 + (y - H / 2) ** 2);
    const blob = r < 20;
    const v = frame ? 0 : blob ? 40 : stripe ? 90 : 230;
    img.setPixelColor((v | (v << 8) | (v << 16) | (0xff << 24)) >>> 0, x, y);
  }
}

const buf = await img.getBuffer('image/png');
fs.writeFileSync('assets/logo.png', buf);
console.log(`assets/logo.png written: ${buf.length} bytes`);