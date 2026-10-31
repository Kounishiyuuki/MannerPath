import { test } from "node:test";
import assert from "node:assert/strict";
import jpeg from "jpeg-js";
import { JpegStructureError, validateJpegStructure } from "../src/reports/jpeg-structure.ts";

function encoded(width = 64, height = 48): Uint8Array {
  const data = new Uint8Array(width * height * 4).map((_, i) => (i * 13) & 255);
  return new Uint8Array(jpeg.encode({ data, width, height }, 85).data);
}
const cat = (...parts: (Uint8Array | number[])[]) => new Uint8Array(parts.flatMap((p) => [...p]));
const segment = (marker: number, body: number[]) => [0xff, marker, (body.length + 2) >> 8, (body.length + 2) & 255, ...body];
/** Offset of the first `FF marker` among the header segments (before SOS). */
function offsetOf(bytes: Uint8Array, marker: number): number {
  let p = 2;
  while (bytes[p + 1] !== marker) { if (bytes[p + 1] === 0xda) throw new Error("marker not found"); p += 2 + bytes[p + 2] * 256 + bytes[p + 3]; }
  return p;
}
const afterApp0 = (bytes: Uint8Array) => offsetOf(bytes, 0xe0) + 18;
const insertAfterApp0 = (bytes: Uint8Array, seg: number[]) => cat(bytes.subarray(0, afterApp0(bytes)), seg, bytes.subarray(afterApp0(bytes)));
const code = (bytes: Uint8Array, max?: number) => {
  try { validateJpegStructure(bytes, max); return "ok"; } catch (e) { assert.ok(e instanceof JpegStructureError, String(e)); return e.code; }
};
const ascii = (s: string) => [...s].map((c) => c.charCodeAt(0));

test("accepts the baseline JFIF shape, with and without a restart interval", () => {
  const valid = encoded();
  assert.deepEqual(validateJpegStructure(valid), { width: 64, height: 48 });
  assert.equal(code(insertAfterApp0(valid, segment(0xdd, [0, 4]))), "ok");
});

test("rejects every metadata carrier: EXIF/GPS, XMP, ICC, comments, JFIF thumbnails", () => {
  const valid = encoded();
  const exifGps = segment(0xe1, [...ascii("Exif\0\0MM\0*"), 0, 0, 0, 8, 0, 1, 0x88, 0x25, 0, 4, 0, 0, 0, 1, 0, 0, 0, 26]);
  assert.equal(code(insertAfterApp0(valid, exifGps)), "forbiddenSegment");
  assert.equal(code(insertAfterApp0(valid, segment(0xe1, ascii("http://ns.adobe.com/xap/1.0/\0<x:xmpmeta/>")))), "forbiddenSegment");
  assert.equal(code(insertAfterApp0(valid, segment(0xe2, ascii("ICC_PROFILE\0")))), "forbiddenSegment");
  assert.equal(code(insertAfterApp0(valid, segment(0xed, ascii("Photoshop 3.0\0")))), "forbiddenSegment");
  assert.equal(code(insertAfterApp0(valid, segment(0xfe, ascii("lat=35.68 lon=139.76")))), "forbiddenSegment");
  const app0 = offsetOf(valid, 0xe0);
  const thumb = cat(valid.subarray(0, app0), segment(0xe0, [...ascii("JFIF\0"), 1, 1, 0, 0, 1, 0, 1, 1, 1, 9, 9, 9]), valid.subarray(app0 + 18));
  assert.equal(code(thumb), "badJfif");
  assert.equal(code(insertAfterApp0(valid, [...valid.subarray(app0, app0 + 18)])), "badJfif");
  assert.equal(code(cat(valid.subarray(0, app0), valid.subarray(app0 + 18))), "badJfif");
});

test("rejects other coding modes and malformed frames", () => {
  const valid = encoded(), sof = offsetOf(valid, 0xc0);
  for (const marker of [0xc1, 0xc2, 0xc3, 0xc9, 0xcb]) {
    const v = valid.slice(); v[sof + 1] = marker; assert.equal(code(v), "forbiddenSegment");
  }
  const precision = valid.slice(); precision[sof + 4] = 12; assert.equal(code(precision), "badFrame");
  const sampling = valid.slice(); sampling[sof + 11] = 0x31; assert.equal(code(sampling), "badFrame");
  const twice = insertAfterApp0(valid, [...valid.subarray(sof, sof + 2 + valid[sof + 3])]);
  assert.equal(code(twice), "badFrame");
});

test("dimension limits: long side, pixel count, zero", () => {
  const valid = encoded(), sof = offsetOf(valid, 0xc0);
  const sized = (w: number, h: number) => { const v = valid.slice(); v[sof + 5] = h >> 8; v[sof + 6] = h & 255; v[sof + 7] = w >> 8; v[sof + 8] = w & 255; return v; };
  assert.equal(code(sized(2048, 976)), "ok");
  assert.equal(code(sized(2049, 10)), "dimensions");
  assert.equal(code(sized(1500, 1500)), "dimensions");
  assert.equal(code(sized(0, 48)), "dimensions");
});

test("rejects appended payloads, truncation, stray markers and fill bytes", () => {
  const valid = encoded();
  assert.equal(code(cat(valid, ascii("PK\x03\x04zip"))), "trailingData");
  assert.equal(code(cat(valid, [0xff, 0xd9])), "badEntropyData");
  assert.equal(code(valid.subarray(0, valid.length - 40)), "trailingData");
  assert.equal(code(valid.subarray(0, 30)), "truncated");
  const sos = offsetOf(valid, 0xda), dataStart = sos + 2 + valid[sos + 3];
  assert.equal(code(cat(valid.subarray(0, dataStart), [0xff, 0xd0], valid.subarray(dataStart))), "badEntropyData");
  assert.equal(code(cat(valid.subarray(0, dataStart), [0xff, 0xe1], valid.subarray(dataStart))), "badEntropyData");
  assert.equal(code(cat(valid.subarray(0, dataStart), [0xff, 0x00], valid.subarray(dataStart))), "ok");
  const app0 = offsetOf(valid, 0xe0);
  assert.equal(code(cat(valid.subarray(0, app0), [0xff], valid.subarray(app0))), "fillBytes");
  const overflow = valid.slice(); overflow[app0 + 2] = 0xff; assert.equal(code(overflow), "truncated");
});

test("scan must name defined tables and be one baseline scan of all components", () => {
  const valid = encoded(), sos = offsetOf(valid, 0xda);
  const missing = valid.slice(); missing[sos + 6] = 0x33; assert.equal(code(missing), "missingTable");
  const selector = valid.slice(); selector[sos + 5] = 99; assert.equal(code(selector), "badScan");
  const progressive = valid.slice(); progressive[sos + 2 + valid[sos + 3] - 2] = 1; assert.equal(code(progressive), "badScan");
});

test("size cap and non-JPEG input", () => {
  const valid = encoded();
  assert.equal(code(valid, valid.length - 1), "tooLarge");
  assert.equal(code(new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 0, 0])), "notJpeg");
  assert.equal(code(new Uint8Array(0)), "notJpeg");
});

test("fuzz: random corruption only ever yields a typed result, in linear time", () => {
  const valid = encoded(320, 240);
  let seed = 7; const rand = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
  const started = performance.now(); const outcomes = new Map<string, number>();
  for (let i = 0; i < 5000; i++) {
    const v = valid.slice();
    for (let k = 1 + Math.floor(rand() * 4); k > 0; k--) v[Math.floor(rand() * v.length)] = Math.floor(rand() * 256);
    const cut = rand() < 0.2 ? v.subarray(0, Math.floor(rand() * v.length)) : v;
    const c = code(cut); outcomes.set(c, (outcomes.get(c) ?? 0) + 1);
  }
  assert.ok(performance.now() - started < 5000);
  assert.ok(outcomes.size > 3, JSON.stringify([...outcomes]));
});
