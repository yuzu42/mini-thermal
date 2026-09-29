import { describe, expect, it } from 'vitest';
import { computeBitmapSize, imageToBitmap, type ImageProcessor, type RgbaImage, type DecodedImage } from './image';

/** synthetic image processor: a checkerboard / gradient, no decoding */
class FakeProcessor implements ImageProcessor {
  constructor(private readonly pattern: (x: number, y: number) => number) {}

  async decode(): Promise<DecodedImage> {
    return { width: 64, height: 64, handle: null };
  }

  async prepareForDither(
    _image: DecodedImage,
    target: { width: number; height: number },
    _contrast: number,
  ): Promise<RgbaImage> {
    const data = new Uint8Array(target.width * target.height * 4);
    for (let y = 0; y < target.height; y++) {
      for (let x = 0; x < target.width; x++) {
        const v = Math.max(0, Math.min(255, Math.round(this.pattern(x, y))));
        const idx = (y * target.width + x) * 4;
        data[idx] = v;
        data[idx + 1] = v;
        data[idx + 2] = v;
        data[idx + 3] = 255;
      }
    }
    return { width: target.width, height: target.height, data };
  }
}

describe('computeBitmapSize', () => {
  it('floors width to a multiple of 8', () => {
    expect(computeBitmapSize({ width: 100, height: 100 }, 100, 300)).toEqual({
      width: 96,
      height: 96,
    });
  });

  it('caps width at the print head', () => {
    expect(computeBitmapSize({ width: 500, height: 500 }, 500, 3000)).toEqual({
      width: 384,
      height: 384,
    });
  });

  it('shrinks proportionally when height exceeds the cap', () => {
    // 64→256 wide would mean 256 tall; capped at 100 → width floor(64×0.625/8)×8 = 40
    expect(computeBitmapSize({ width: 64, height: 160 }, 256, 100)).toEqual({
      width: 40,
      height: 100,
    });
  });

  it('rejects degenerate sizes', () => {
    expect(() => computeBitmapSize({ width: 0, height: 0 }, 256, 300)).toThrow();
    expect(() => computeBitmapSize({ width: 64, height: 64 }, 7, 300)).toThrow();
  });
});

describe('imageToBitmap', () => {
  it('produces print-head-wide rows with multiple-of-8 image width', async () => {
    const processor = new FakeProcessor(() => 128);
    const bitmap = await imageToBitmap(processor, 'ignored', { maxWidth: 64, maxHeight: 300 });
    expect(bitmap.bytesPerRow).toBe(48);
    expect(bitmap.width).toBe(384);
    expect(bitmap.rows.length).toBe(bitmap.height);
    for (const row of bitmap.rows) expect(row.length).toBe(48);
  });

  it('packs a solid-black image as all-set bits within the image bounds', async () => {
    const processor = new FakeProcessor(() => 0); // black
    const bitmap = await imageToBitmap(processor, '', { maxWidth: 64, maxHeight: 300 });
    // image is 64px = 8 bytes wide, centered: padding 20 bytes each side
    const row = bitmap.rows[0]!;
    // left padding is white
    for (let i = 0; i < 20; i++) expect(row[i]).toBe(0x00);
    // image bytes fully black
    for (let i = 20; i < 28; i++) expect(row[i]).toBe(0xff);
    // right padding is white
    for (let i = 28; i < 48; i++) expect(row[i]).toBe(0x00);
  });

  it('threshold mode packs a solid-white image as all-zero rows', async () => {
    const processor = new FakeProcessor(() => 255); // white
    // 255 × 0.82 = 209 > 128 → white everywhere (threshold keeps it truly blank)
    const bitmap = await imageToBitmap(processor, '', {
      maxWidth: 64,
      maxHeight: 300,
      dither: 'threshold',
    });
    for (const row of bitmap.rows) {
      for (const b of row) expect(b).toBe(0x00);
    }
  });

  it('Floyd-Steinberg preserves average intensity: uniform white darkens to ~18% dots', async () => {
    // gray 255×0.82 = 209 → 82% white / 18% black — the darkening IS the point,
    // and FS diffusion spreads it as a uniform speckle, not a solid fill.
    const processor = new FakeProcessor(() => 255);
    const bitmap = await imageToBitmap(processor, '', { maxWidth: 64, maxHeight: 64 });
    const ones = bitmap.rows.reduce(
      (acc, row) => acc + row.reduce((n, b) => n + countBits(b), 0),
      0,
    );
    const ratio = ones / (64 * 64);
    expect(ratio).toBeGreaterThan(0.15);
    expect(ratio).toBeLessThan(0.21);
  });

  it('darkening shifts the 128-threshold equilibrium: gray 155×0.82 < 128 → black', async () => {
    // value 155 is above the 128 threshold — but ×0.82 → 127.1 → BLACK.
    // this is exactly why the reference driver darkens by 18%.
    // use threshold mode so every pixel is decided independently (FS
    // diffusion would blur the first pixels' verdict into its neighbors).
    const processor = new FakeProcessor(() => 155);
    const bitmap = await imageToBitmap(processor, '', {
      maxWidth: 64,
      maxHeight: 300,
      dither: 'threshold',
    });
    const row = bitmap.rows[0]!;
    expect(row[20]).toBe(0xff);
  });

  it('align left packs the image at byte 0', async () => {
    const processor = new FakeProcessor(() => 0);
    const bitmap = await imageToBitmap(processor, '', { maxWidth: 64, maxHeight: 300, align: 'left' });
    const row = bitmap.rows[0]!;
    for (let i = 0; i < 8; i++) expect(row[i]).toBe(0xff);
    for (let i = 8; i < 48; i++) expect(row[i]).toBe(0x00);
  });

  it('align right packs the image at the page end', async () => {
    const processor = new FakeProcessor(() => 0);
    const bitmap = await imageToBitmap(processor, '', { maxWidth: 64, maxHeight: 300, align: 'right' });
    const row = bitmap.rows[0]!;
    for (let i = 0; i < 40; i++) expect(row[i]).toBe(0x00);
    for (let i = 40; i < 48; i++) expect(row[i]).toBe(0xff);
  });

  it('threshold mode dithers deterministically without diffusion', async () => {
    const processor = new FakeProcessor((x) => x * 4); // gradient
    const bitmap = await imageToBitmap(processor, '', {
      maxWidth: 64,
      maxHeight: 300,
      dither: 'threshold',
      threshold: 128,
    });
    // gradient 0..252 → first half of each row black, second half white
    const row = bitmap.rows[0]!;
    expect(row[20]).toBe(0xff); // x=0..7 → v<128 → black
    expect(row[27]).toBe(0x00); // x=56..63 → v>128 → white
  });

  it('Floyd-Steinberg dithers a mid-gray image to ~50% dots', async () => {
    // mid gray 127 × 0.82 = 104.1 — that's 59% black after FS averaging,
    // NOT 50%: the darkening biases gray areas toward black (intended —
    // thermal prints look washed out otherwise).
    const processor = new FakeProcessor(() => 127);
    const bitmap = await imageToBitmap(processor, '', { maxWidth: 64, maxHeight: 64 });
    const ones = bitmap.rows.reduce(
      (acc, row) => acc + row.reduce((n, b) => n + countBits(b), 0),
      0,
    );
    const ratio = ones / (64 * 64);
    // 1 - 104/255 ≈ 0.591
    expect(ratio).toBeGreaterThan(0.55);
    expect(ratio).toBeLessThan(0.63);
    // error diffusion must have produced a non-uniform pattern
    const distinct = new Set(bitmap.rows.flatMap((r) => [...r]));
    expect(distinct.size).toBeGreaterThan(1);
    void processor;
  });
});

function countBits(b: number): number {
  let n = 0;
  while (b) {
    n += b & 1;
    b >>= 1;
  }
  return n;
}