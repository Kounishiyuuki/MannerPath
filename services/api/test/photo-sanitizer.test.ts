import assert from 'node:assert/strict';
import { test } from 'node:test';
import jpeg from 'jpeg-js';
import { encode, decode } from 'fast-png';
import { sanitizeEvidencePhoto, MAX_PHOTO_BYTES } from '../src/reports/photo-sanitizer.ts';
const rgba = new Uint8Array([255,0,0,255, 0,255,0,255]);
const png = () => encode({ width: 2, height: 1, channels: 4, data: rgba });
const jpg = () => new Uint8Array(jpeg.encode({ width: 2, height: 1, data: rgba }, 90).data);
function join(...arrays: Uint8Array[]) { const result = new Uint8Array(arrays.reduce((sum, value) => sum + value.length, 0)); let offset = 0; for (const array of arrays) { result.set(array, offset); offset += array.length; } return result; }
function exifJPEG(rotation = 1) {
  const exif = new Uint8Array(112);
  exif.set([69,120,105,102,0,0, 73,73,42,0,8,0,0,0, 1,0, 18,1,3,0,1,0,0,0,rotation,0,0,0, 0,0,0,0]);
  exif.set(new TextEncoder().encode('GPSLatitude=35.0;GPSLongitude=139;Device=PRIVATE;Timestamp=2026'), 32);
  const segment = join(new Uint8Array([255,225,(exif.length+2)>>8,(exif.length+2)&255]), exif);
  const original = jpg(); return join(original.subarray(0,2), segment, original.subarray(2));
}
const rejects = (bytes: Uint8Array, type: string, code: string) => assert.rejects(sanitizeEvidencePhoto(bytes, type), (error: any) => error.code === code);
test('valid JPEG PNG deterministic normalized server metadata', async () => {
  for (const [bytes, type] of [[png(), 'image/png'], [jpg(), 'image/jpeg']] as const) {
    const first = await sanitizeEvidencePhoto(bytes, type), second = await sanitizeEvidencePhoto(bytes, type);
    assert.equal(first.mediaType, 'image/png'); assert.equal(first.width, 2); assert.equal(first.height, 1);
    assert.equal(first.byteLength, first.bytes.length); assert.equal(first.contentSha256, second.contentSha256);
    assert.deepEqual(first.bytes, second.bytes);
    assert.equal(first.contentSha256, Buffer.from(await crypto.subtle.digest('SHA-256', first.bytes)).toString('hex'));
  }
});
test('GPS device timestamp EXIF discarded and identity independent', async () => {
  const sanitized = await sanitizeEvidencePhoto(exifJPEG(), 'image/jpeg');
  assert.deepEqual(sanitized.bytes, (await sanitizeEvidencePhoto(jpg(), 'image/jpeg')).bytes);
  for (const marker of ['Exif', 'GPS', 'PRIVATE', 'Timestamp']) assert.equal(Buffer.from(sanitized.bytes).includes(Buffer.from(marker)), false);
});
test('PNG text metadata discarded', async () => {
  const annotated = encode({ width: 2, height: 1, channels: 4, data: rgba, text: { GPS: '35,139', Device: 'PRIVATE', Timestamp: '2026' } });
  assert.deepEqual((await sanitizeEvidencePhoto(annotated, 'image/png')).bytes, (await sanitizeEvidencePhoto(png(), 'image/png')).bytes);
});
test('eight EXIF orientations normalize', async () => {
  for (let orientation = 1; orientation <= 8; orientation++) {
    const result = await sanitizeEvidencePhoto(exifJPEG(orientation), 'image/jpeg');
    assert.equal(result.width, orientation >= 5 ? 1 : 2); assert.equal(result.height, orientation >= 5 ? 2 : 1);
    assert.equal(decode(result.bytes).data.length, 8);
  }
});
test('fake MIME unsupported oversize malformed CRC failures rejected', async () => {
  await rejects(png(), 'image/jpeg', 'invalid_photo'); await rejects(jpg(), 'image/png', 'invalid_photo');
  await rejects(png(), 'image/svg+xml', 'unsupported_photo_type');
  await rejects(new Uint8Array(MAX_PHOTO_BYTES + 1), 'image/png', 'photo_too_large');
  await rejects(png().subarray(0,30), 'image/png', 'invalid_photo'); await rejects(jpg().subarray(0,30), 'image/jpeg', 'invalid_photo');
  const corrupt = png(); corrupt[corrupt.length-1] ^= 1; await rejects(corrupt, 'image/png', 'invalid_photo');
});
test('dimensions preflight rejects JPEG before decoder', async () => {
  const image = jpg();
  for (let i = 2; i < image.length - 8; i++) if (image[i] === 255 && image[i+1] === 192) { image[i+5] = 0x20; image[i+6] = 0; break; }
  await rejects(image, 'image/jpeg', 'photo_dimensions_exceeded');
});
function chunk(type: string, data: Uint8Array) {
  const bytes = new Uint8Array(data.length + 12), view = new DataView(bytes.buffer);
  view.setUint32(0, data.length); bytes.set(new TextEncoder().encode(type), 4); bytes.set(data, 8);
  let checksum = 0xffffffff;
  for (const byte of bytes.subarray(4, 8 + data.length)) { checksum ^= byte; for (let bit = 0; bit < 8; bit++) checksum = (checksum >>> 1) ^ ((checksum & 1) ? 0xedb88320 : 0); }
  view.setUint32(8 + data.length, (checksum ^ 0xffffffff) >>> 0); return bytes;
}
function craftedPng(width: number, height: number, idat: Uint8Array, extra?: Uint8Array) {
  const header = new Uint8Array(13), view = new DataView(header.buffer);
  view.setUint32(0, width); view.setUint32(4, height); header[8] = 8; header[9] = 6;
  return join(new Uint8Array([137,80,78,71,13,10,26,10]), chunk('IHDR', header), ...(extra ? [extra] : []), chunk('IDAT', idat), chunk('IEND', new Uint8Array()));
}
test('PNG dimension and pixel count bounds precede inflate; EXIF rejected', async () => {
  await rejects(craftedPng(4097, 1, new Uint8Array([1])), 'image/png', 'photo_dimensions_exceeded');
  await rejects(craftedPng(2000, 1001, new Uint8Array([1])), 'image/png', 'photo_dimensions_exceeded');
  await rejects(craftedPng(1, 1, new Uint8Array([1]), chunk('eXIf', new Uint8Array([1]))), 'image/png', 'invalid_photo');
});
test('PNG decompression bomb, truncated compressed stream and invalid filters rejected', async () => {
  const { deflateSync } = await import('node:zlib');
  await rejects(craftedPng(1, 1, deflateSync(new Uint8Array(1_000_000))), 'image/png', 'invalid_photo');
  await rejects(craftedPng(1, 1, deflateSync(new Uint8Array(5)).subarray(0, 5)), 'image/png', 'invalid_photo');
  await rejects(craftedPng(1, 1, deflateSync(new Uint8Array([255,0,0,0,0]))), 'image/png', 'invalid_photo');
});
test('JPEG orientation transforms actual pixel order', async () => {
  const first = decode((await sanitizeEvidencePhoto(exifJPEG(1), 'image/jpeg')).bytes).data;
  const mirror = decode((await sanitizeEvidencePhoto(exifJPEG(2), 'image/jpeg')).bytes).data;
  assert.deepEqual([...mirror], [...first.slice(4,8), ...first.slice(0,4)]);
  const rotated = decode((await sanitizeEvidencePhoto(exifJPEG(6), 'image/jpeg')).bytes).data;
  assert.deepEqual([...rotated], [...first]);
});
