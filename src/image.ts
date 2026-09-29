// ============================================================
// image pipeline: decode → scale → greyscale → contrast → darken
//                 → dither → pack into DC2 * bitmap rows
// ============================================================
//
// image DECODING and RESIZING are runtime-specific (jimp on Node) and
// live behind the ImageProcessor interface. everything after that —
// grayscale extraction, darkening, Floyd-Steinberg dithering and
// 1-bit packing onto the 384-dot head — is pure math and lives here.
//
// all “magic numbers” (18% darken, 0.25 contrast, 128 thresholds,
// center-on-page) were tuned on real hardware and are defaults, not
// constants — pass options to change them.

import {
  PRINT_HEAD_WIDTH,
  PRINT_HEAD_BYTES,
  DEFAULT_IMAGE_PRINT_WIDTH,
  DEFAULT_IMAGE_MAX_HEIGHT,
} from './constants';

/** raw RGBA pixels, 4 bytes per pixel */
export interface RgbaImage {
  width: number;
  height: number;
  /** RGBA8888 data, length = width × height × 4 */
  data: Uint8Array;
}

/**
 * an image decoded by an {@link ImageProcessor}. `handle` is opaque and
 * adapter-owned (e.g. the Jimp instance) — the core only reads the
 * dimensions and hands it back for preprocessing.
 */
export interface DecodedImage {
  width: number;
  height: number;
  handle: unknown;
}

/** image input: raw encoded bytes (PNG/JPEG/…) or a data-URL / base64 string */
export type ImageSource = Uint8Array | string;

/**
 * runtime-specific image backend. the Node adapter wraps jimp:
 * decode → resize → greyscale → contrast, in exactly that order
 * (order matters for output parity).
 */
export interface ImageProcessor {
  /** decodes an encoded image to its natural size. */
  decode(source: ImageSource): Promise<DecodedImage>;
  /**
   * resizes to exactly `target` and applies greyscale + contrast.
   * must return RGBA data of exactly the target dimensions.
   */
  prepareForDither(
    image: DecodedImage,
    target: { width: number; height: number },
    contrast: number,
  ): Promise<RgbaImage>;
}

/** packed 1-bit bitmap, ready for the DC2 * row command */
export interface BitmapResult {
  /** one Uint8Array per pixel row; `bytesPerRow` bytes each */
  rows: Uint8Array[];
  /** page width the rows are packed for (always the full print head) */
  width: number;
  /** printed image height in pixels (= number of rows) */
  height: number;
  /** bytes per row (print head width / 8 = 48) */
  bytesPerRow: number;
}

export interface BitmapOptions {
  /** target print width in px; rounded down to a multiple of 8, capped at 384. default 256 */
  maxWidth?: number;
  /** cap on printed height; the image shrinks to fit. default 300 */
  maxHeight?: number;
  /** horizontal placement on the 384-dot page. default 'center' */
  align?: 'left' | 'center' | 'right';
  /**
   * grayscale multiplier applied before dithering. default 0.82 —
   * thermal output looks washed out without ~18% pre-darkening.
   * 1 = no darkening.
   */
  darken?: number;
  /** contrast adjustment passed to the image processor, −1…+1. default 0.25 */
  contrast?: number;
  /** dithering mode. default 'floyd-steinberg' */
  dither?: 'floyd-steinberg' | 'threshold';
  /** cut-over for 'threshold' mode. default 128 */
  threshold?: number;
}

/**
 * computes the printed image size for a source image:
 * width floored to a multiple of 8 (bit-packed rows) and capped at the
 * print head; height scaled proportionally, then capped at `maxHeight`
 * (shrinking width proportionally, again multiple-of-8).
 */
export function computeBitmapSize(
  natural: { width: number; height: number },
  maxWidth: number,
  maxHeight: number,
): { width: number; height: number } {
  if (natural.width < 1 || natural.height < 1) {
    throw new Error(`computeBitmapSize: invalid natural size ${natural.width}x${natural.height}`);
  }

  let width = Math.floor(maxWidth / 8) * 8;
  if (width > PRINT_HEAD_WIDTH) width = PRINT_HEAD_WIDTH;
  if (width < 8) throw new Error(`computeBitmapSize: maxWidth ${maxWidth} too small (min 8)`);

  const scale = width / natural.width;
  let height = Math.floor(natural.height * scale);

  // cap the height to ensure quick, clean prints without stretching
  if (height > maxHeight) {
    height = maxHeight;
    width = Math.floor((natural.width * (height / natural.height)) / 8) * 8;
  }

  if (width < 8 || height < 1) {
    throw new Error(`computeBitmapSize: degenerate target ${width}x${height}`);
  }
  return { width, height };
}

/** in-place Floyd-Steinberg dithering: grayscale float array → 0/255 */
function ditherFloydSteinberg(gray: Float64Array, width: number, height: number): void {
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * width + x;
      const old = gray[i]!;
      const newVal = old < 128 ? 0 : 255;
      gray[i] = newVal;
      const err = old - newVal;
      if (x + 1 < width) gray[i + 1] = gray[i + 1]! + (err * 7) / 16;
      if (y + 1 < height) {
        if (x > 0) gray[(y + 1) * width + x - 1] = gray[(y + 1) * width + x - 1]! + (err * 3) / 16;
        gray[(y + 1) * width + x] = gray[(y + 1) * width + x]! + (err * 5) / 16;
        if (x + 1 < width)
          gray[(y + 1) * width + x + 1] = gray[(y + 1) * width + x + 1]! + (err * 1) / 16;
      }
    }
  }
}

/** in-place hard threshold: no error diffusion, crisp two-tone output */
function ditherThreshold(gray: Float64Array, threshold: number): void {
  for (let i = 0; i < gray.length; i++) {
    gray[i] = gray[i]! < threshold ? 0 : 255;
  }
}

/**
 * converts an image to packed, dithered bitmap rows for the DC2 *
 * command. the image is scaled (multiple-of-8 width), preprocessed
 * (greyscale + contrast via the processor), darkened, dithered and
 * packed onto the physical page according to `align`.
 */
export async function imageToBitmap(
  processor: ImageProcessor,
  source: ImageSource,
  options: BitmapOptions = {},
): Promise<BitmapResult> {
  const maxWidth = options.maxWidth ?? DEFAULT_IMAGE_PRINT_WIDTH;
  const maxHeight = options.maxHeight ?? DEFAULT_IMAGE_MAX_HEIGHT;
  const darken = options.darken ?? 0.82;
  const contrast = options.contrast ?? 0.25;
  const threshold = options.threshold ?? 128;
  const align = options.align ?? 'center';

  const decoded = await processor.decode(source);
  const { width, height } = computeBitmapSize(
    { width: decoded.width, height: decoded.height },
    maxWidth,
    maxHeight,
  );
  const prepared = await processor.prepareForDither(decoded, { width, height }, contrast);

  // extract grayscale (channel 0 — preprocessed images are grey already)
  // and handle transparency: transparent pixels print as white.
  const gray = new Float64Array(width * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = (y * width + x) * 4;
      const r = prepared.data[idx] ?? 0;
      const a = prepared.data[idx + 3] ?? 255;
      gray[y * width + x] = a < 128 ? 255 : r * darken;
    }
  }

  if (options.dither === 'threshold') {
    ditherThreshold(gray, threshold);
  } else {
    ditherFloydSteinberg(gray, width, height);
  }

  // pack each row, placed on the physical page according to align
  const bytesPerImageRow = width / 8;
  const paddingBytes =
    align === 'left'
      ? 0
      : align === 'right'
        ? PRINT_HEAD_BYTES - bytesPerImageRow
        : Math.floor((PRINT_HEAD_BYTES - bytesPerImageRow) / 2);

  const rows: Uint8Array[] = [];
  for (let y = 0; y < height; y++) {
    const row = new Uint8Array(PRINT_HEAD_BYTES); // zeros = white
    for (let x = 0; x < width; x++) {
      if (gray[y * width + x]! < 128) {
        const byteIdx = paddingBytes + Math.floor(x / 8);
        const bitIdx = 7 - (x % 8);
        row[byteIdx] = row[byteIdx]! | (1 << bitIdx);
      }
    }
    rows.push(row);
  }

  return { rows, width: PRINT_HEAD_WIDTH, height, bytesPerRow: PRINT_HEAD_BYTES };
}