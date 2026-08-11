import sharp from 'sharp';
import { config } from '../config.js';

/**
 * Normalise any uploaded image into a width-constrained buffer suitable for
 * the multimodal models, and return it as base64 + mimeType.
 *
 * - Auto-orients EXIF rotation.
 * - Down-scales to config.maxImageWidth (default 1600px).
 * - Keeps PNG for fine line-art charts, JPEG otherwise (quality 85).
 */
export async function processImage(buffer) {
  const image = sharp(buffer, { failOn: 'none' }).rotate(); // honour EXIF orientation
  const meta = await image.metadata();

  const pipeline = meta.width && meta.width > config.maxImageWidth
    ? image.resize({ width: config.maxImageWidth, withoutEnlargement: true })
    : image;

  const isPng = /png/i.test(meta.format || '');
  const useJpeg = !isPng || meta.hasAlpha;

  let outBuffer;
  let mimeType;

  if (useJpeg) {
    outBuffer = await pipeline.clone().jpeg({ quality: 85, mozjpeg: true }).toBuffer();
    mimeType = 'image/jpeg';
  } else {
    outBuffer = await pipeline.clone().png({ compressionLevel: 9 }).toBuffer();
    mimeType = 'image/png';
  }

  return {
    buffer: outBuffer,
    base64: outBuffer.toString('base64'),
    mimeType,
    width: meta.width,
    height: meta.height,
  };
}
