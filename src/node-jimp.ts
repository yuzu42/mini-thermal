// ============================================================
// jimp-backed ImageProcessor
// ============================================================
//
// implements decode → resize → greyscale → contrast, IN THAT ORDER.
// the order matches the reference driver exactly (jimp's greyscale
// uses ITU Rec 709 luminance; contrast is the jimp formula
// floor(factor × (v − 127) + 127), factor = (1 + c) / (1 − c)) —
// deviating from it changes the dither output.

import { Jimp } from 'jimp';
import type { DecodedImage, ImageProcessor, ImageSource, RgbaImage } from './image';

/** full instance type returned by Jimp.fromBuffer (class value → use ReturnType) */
type JimpImage = Awaited<ReturnType<typeof Jimp.fromBuffer>>;

/** strips a data-URL prefix if present, returns raw encoded bytes */
function sourceToBytes(source: ImageSource): Uint8Array {
  if (typeof source === 'string') {
    const base64 = source.replace(/^data:image\/\w+;base64,/, '');
    return Uint8Array.from(Buffer.from(base64, 'base64'));
  }
  return source;
}

/**
 * jimp adapter. one instance can process any number of images
 * (jimp itself is stateless per-image).
 */
export class JimpProcessor implements ImageProcessor {
  async decode(source: ImageSource): Promise<DecodedImage> {
    const bytes = sourceToBytes(source);
    // jimp requires Buffer | ArrayBuffer — copy the view's bytes into one
    const img = await Jimp.fromBuffer(
      typeof Buffer !== 'undefined' &&
        bytes.byteOffset === 0 &&
        bytes.byteLength === bytes.buffer.byteLength
        ? (bytes.buffer as ArrayBuffer)
        : Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength),
    );
    return { width: img.width, height: img.height, handle: img };
  }

  async prepareForDither(
    image: DecodedImage,
    target: { width: number; height: number },
    contrast: number,
  ): Promise<RgbaImage> {
    const img = image.handle as JimpImage;
    img.resize({ w: target.width, h: target.height });
    img.greyscale();
    img.contrast(contrast);
    // copy so the core can reason about a plain RGBA buffer
    const data = Uint8Array.from(img.bitmap.data);
    return { width: img.width, height: img.height, data };
  }
}