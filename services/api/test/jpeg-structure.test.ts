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

// A synthetic 96×72 gradient (no third-party content) encoded by macOS ImageIO the way ReportPhotos.normalize does
// (q0.85, APP1–15/COM removed): APP0, SOF0 4:2:0, DHT×4, DQT×2, DRI, one scan with RST0–RST3, EOI.
const IMAGEIO = Uint8Array.from(atob("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"), (c) => c.charCodeAt(0));
const rstOffsets = (bytes: Uint8Array) => { const out: number[] = []; const sos = offsetOf(bytes, 0xda);
  for (let i = sos + 2 + bytes[sos + 3]; i < bytes.length - 2; i++) if (bytes[i] === 0xff && bytes[i + 1] >= 0xd0 && bytes[i + 1] <= 0xd7) out.push(i);
  return out; };

test("accepts the baseline JFIF shape from jpeg-js and from ImageIO (restart interval with RST markers)", () => {
  assert.deepEqual(validateJpegStructure(encoded()), { width: 64, height: 48 });
  assert.deepEqual(validateJpegStructure(IMAGEIO), { width: 96, height: 72 });
  assert.equal(rstOffsets(IMAGEIO).length, 4);
});

test("restart markers must match the interval exactly and run in order", () => {
  assert.equal(code(insertAfterApp0(encoded(), segment(0xdd, [0, 4]))), "badRestart"); // interval without markers
  const swapped = IMAGEIO.slice(), [a, b] = rstOffsets(IMAGEIO);
  [swapped[a + 1], swapped[b + 1]] = [swapped[b + 1], swapped[a + 1]];
  assert.equal(code(swapped), "badEntropyData");
  const middle = rstOffsets(IMAGEIO)[2], last = rstOffsets(IMAGEIO)[3];
  assert.equal(code(cat(IMAGEIO.subarray(0, middle), IMAGEIO.subarray(middle + 2))), "badEntropyData"); // RST3 where RST2 belongs
  assert.equal(code(cat(IMAGEIO.subarray(0, last), IMAGEIO.subarray(last + 2))), "badRestart"); // final marker missing
  const extra = rstOffsets(IMAGEIO)[3];
  assert.equal(code(cat(IMAGEIO.subarray(0, extra + 2), [0xff, 0xd4], IMAGEIO.subarray(extra + 2))), "badEntropyData");
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
  assert.equal(code(cat(valid.subarray(0, dataStart), [0xff, 0xd0], valid.subarray(dataStart))), "badEntropyData"); // RST without DRI
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
