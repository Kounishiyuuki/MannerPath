import jpeg from 'jpeg-js';
import { decode, encode } from 'fast-png';

export const MAX_PHOTO_BYTES = 5 * 1024 * 1024;
export const MAX_PHOTO_DIMENSION = 4096;
export const MAX_PHOTO_PIXELS = 2_000_000;
export class PhotoSanitizationError extends Error {
  readonly code: 'photo_too_large' | 'unsupported_photo_type' | 'invalid_photo' | 'photo_dimensions_exceeded';
  constructor(code: PhotoSanitizationError['code']) { super(code); this.code = code; }
}
export interface SanitizedEvidencePhoto {
  bytes: Uint8Array; contentSha256: string; mediaType: 'image/png'; byteLength: number; width: number; height: number;
}
function invalid(): never { throw new PhotoSanitizationError('invalid_photo'); }
function dimensions(width: number, height: number) {
  if (!width || !height) invalid();
  if (width > MAX_PHOTO_DIMENSION || height > MAX_PHOTO_DIMENSION || width * height > MAX_PHOTO_PIXELS)
    throw new PhotoSanitizationError('photo_dimensions_exceeded');
}
function orientation(exif: Uint8Array): number {
  if (exif.length < 14 || String.fromCharCode(...exif.subarray(0, 6)) !== 'Exif\0\0') return 1;
  const tiff = exif.subarray(6), view = new DataView(tiff.buffer, tiff.byteOffset, tiff.byteLength);
  const little = tiff[0] === 0x49 && tiff[1] === 0x49;
  if (!little && !(tiff[0] === 0x4d && tiff[1] === 0x4d)) invalid();
  if (view.getUint16(2, little) !== 42) invalid();
  const offset = view.getUint32(4, little);
  if (offset + 2 > tiff.length) invalid();
  const count = view.getUint16(offset, little);
  if (offset + 2 + count * 12 + 4 > tiff.length) invalid();
  for (let i = 0; i < count; i++) {
    const entry = offset + 2 + i * 12;
    if (view.getUint16(entry, little) === 0x112) {
      if (view.getUint16(entry + 2, little) !== 3 || view.getUint32(entry + 4, little) !== 1) invalid();
      const value = view.getUint16(entry + 8, little);
      if (value < 1 || value > 8) invalid();
      return value;
    }
  }
  return 1;
}
function jpegHeader(bytes: Uint8Array) {
  let position = 2, width = 0, height = 0, rotation = 1;
  if (bytes.length < 4 || bytes[bytes.length - 2] !== 0xff || bytes[bytes.length - 1] !== 0xd9) invalid();
  while (position < bytes.length - 2) {
    if (bytes[position++] !== 0xff) invalid();
    while (bytes[position] === 0xff) position++;
    const marker = bytes[position++];
    if (marker === 0xda) break;
    if (position + 2 > bytes.length) invalid();
    const length = bytes[position] * 256 + bytes[position + 1];
    if (length < 2 || position + length > bytes.length) invalid();
    if (marker === 0xe1) rotation = orientation(bytes.subarray(position + 2, position + length));
    if ([0xc0, 0xc1, 0xc2].includes(marker)) {
      if (length < 8) invalid();
      height = bytes[position + 3] * 256 + bytes[position + 4];
      width = bytes[position + 5] * 256 + bytes[position + 6];
      dimensions(width, height);
    }
    position += length;
  }
  dimensions(width, height);
  return { width, height, rotation };
}
function crc(bytes: Uint8Array) {
  let value = 0xffffffff;
  for (const byte of bytes) { value ^= byte; for (let bit = 0; bit < 8; bit++) value = (value >>> 1) ^ ((value & 1) ? 0xedb88320 : 0); }
  return (value ^ 0xffffffff) >>> 0;
}
async function pngPixels(bytes: Uint8Array) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let position = 8, width = 0, height = 0, channels = 0, ended = false, idatEnded = false;
  const chunks: Uint8Array[] = [bytes.subarray(0, 8)], compressed: Uint8Array[] = [];
  while (position < bytes.length) {
    if (position + 12 > bytes.length) invalid();
    const length = view.getUint32(position);
    if (length > bytes.length - position - 12) invalid();
    const type = String.fromCharCode(...bytes.subarray(position + 4, position + 8));
    const data = bytes.subarray(position + 8, position + 8 + length);
    if (crc(bytes.subarray(position + 4, position + 8 + length)) !== view.getUint32(position + 8 + length)) invalid();
    if (position === 8 && type !== 'IHDR') invalid();
    if (type === 'IHDR') {
      if (position !== 8 || length !== 13) invalid();
      width = view.getUint32(position + 8); height = view.getUint32(position + 12); dimensions(width, height);
      if (data[8] !== 8 || ![2, 6].includes(data[9]) || data[10] || data[11] || data[12]) invalid();
      channels = data[9] === 2 ? 3 : 4;
    } else if (type === 'IDAT') {
      if (idatEnded || !length) invalid();
      compressed.push(data);
    } else if (type === 'IEND') {
      if (length || !compressed.length) invalid();
      ended = true;
    } else {
      if (compressed.length) idatEnded = true;
      // Unsupported critical chunks / animations fail closed. Ancillary metadata is discarded.
      if (!(bytes[position + 4] & 32) || ['acTL', 'eXIf', 'tRNS'].includes(type)) invalid();
    }
    if (['IHDR', 'IDAT', 'IEND'].includes(type)) chunks.push(bytes.subarray(position, position + 12 + length));
    position += 12 + length;
    if (ended) break;
  }
  if (!ended || position !== bytes.length) invalid();
  const expected = height * (1 + width * channels);
  const compressedData = concatenate(compressed);
  const stream = new Blob([compressedData]).stream().pipeThrough(new DecompressionStream('deflate'));
  const reader = stream.getReader(); let total = 0;
  try {
    for (;;) {
      const result = await reader.read(); if (result.done) break;
      total += result.value.byteLength;
      if (total > expected) { await reader.cancel(); invalid(); }
    }
  } finally { reader.releaseLock(); }
  if (total !== expected) invalid();
  const decoded = decode(concatenate(chunks), { checkCrc: true });
  if (channels === 4) return { data: decoded.data as Uint8Array, width, height, rotation: 1 };
  const rgba = new Uint8Array(width * height * 4);
  for (let pixel = 0; pixel < width * height; pixel++) {
    rgba[pixel * 4] = decoded.data[pixel * channels]; rgba[pixel * 4 + 1] = decoded.data[pixel * channels + 1];
    rgba[pixel * 4 + 2] = decoded.data[pixel * channels + 2]; rgba[pixel * 4 + 3] = channels === 4 ? decoded.data[pixel * channels + 3] : 255;
  }
  return { data: rgba, width, height, rotation: 1 };
}
function concatenate(chunks: Uint8Array[]) {
  const result = new Uint8Array(chunks.reduce((sum, chunk) => sum + chunk.length, 0)); let offset = 0;
  for (const chunk of chunks) { result.set(chunk, offset); offset += chunk.length; } return result;
}
function rotate(data: Uint8Array, width: number, height: number, rotation: number) {
  if (rotation === 1) return { data, width, height };
  const swapped = rotation >= 5, outputWidth = swapped ? height : width, outputHeight = swapped ? width : height;
  const output = new Uint8Array(data.length);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    let targetX = x, targetY = y;
    switch (rotation) {
      case 2: targetX = width - 1 - x; break;
      case 3: targetX = width - 1 - x; targetY = height - 1 - y; break;
      case 4: targetY = height - 1 - y; break;
      case 5: targetX = y; targetY = x; break;
      case 6: targetX = height - 1 - y; targetY = x; break;
      case 7: targetX = height - 1 - y; targetY = width - 1 - x; break;
      case 8: targetX = y; targetY = width - 1 - x; break;
    }
    const source = (y * width + x) * 4, target = (targetY * outputWidth + targetX) * 4;
    for (let channel = 0; channel < 4; channel++) output[target + channel] = data[source + channel];
  }
  return { data: output, width: outputWidth, height: outputHeight };
}
/** Raw bytes and transient EXIF never leave this boundary. Only freshly encoded pixels are returned. */
export async function sanitizeEvidencePhoto(input: Uint8Array, declaredMediaType: string): Promise<SanitizedEvidencePhoto> {
  if (input.length > MAX_PHOTO_BYTES) throw new PhotoSanitizationError('photo_too_large');
  if (!['image/jpeg', 'image/png'].includes(declaredMediaType)) throw new PhotoSanitizationError('unsupported_photo_type');
  try {
    let pixels;
    if (declaredMediaType === 'image/jpeg') {
      if (input[0] !== 0xff || input[1] !== 0xd8) invalid();
      const header = jpegHeader(input);
      const decoded = jpeg.decode(input, { useTArray: true, formatAsRGBA: true, tolerantDecoding: false, maxResolutionInMP: 2, maxMemoryUsageInMB: 48 });
      if (decoded.width !== header.width || decoded.height !== header.height) invalid();
      pixels = rotate(decoded.data, header.width, header.height, header.rotation);
    } else {
      if (![137,80,78,71,13,10,26,10].every((byte, i) => input[i] === byte)) invalid();
      const decoded = await pngPixels(input); pixels = decoded;
    }
    const bytes = encode({ width: pixels.width, height: pixels.height, data: pixels.data, depth: 8, channels: 4 });
    const hash = await crypto.subtle.digest('SHA-256', bytes);
    return { bytes, contentSha256: Array.from(new Uint8Array(hash), byte => byte.toString(16).padStart(2, '0')).join(''), mediaType: 'image/png', byteLength: bytes.length, width: pixels.width, height: pixels.height };
  } catch (error) {
    if (error instanceof PhotoSanitizationError) throw error;
    invalid();
  }
}
