// PoC for the Workers Free CPU budget (docs/release/V1_FREE_TIER_ARCHITECTURE.md, option B). NOT wired into any route.
//
// The iPhone already re-renders every photo into a fresh bitmap and re-encodes it (ReportPhotos.normalize), so the
// server's job can shrink from "decode and re-encode" to "accept only the exact container shape that encoder emits".
// This is a structure check, not a decode: it proves there is no metadata segment, thumbnail, trailing data or
// unsupported coding mode, and that every table the scan names exists. It does NOT prove the entropy-coded data
// decodes cleanly; whoever decodes the image (the operator's local Admin) must still use a bounded, memory-safe
// decoder. Linear in the input, no allocation proportional to the pixel count.

export const JPEG_MAX_BYTES = 2 * 1024 * 1024;
export const JPEG_MAX_DIMENSION = 2048;
export const JPEG_MAX_PIXELS = 2_000_000;

export type JpegStructureFailure =
  | "tooLarge" | "notJpeg" | "truncated" | "fillBytes" | "forbiddenSegment" | "badJfif" | "badQuantTable"
  | "badHuffmanTable" | "badFrame" | "dimensions" | "badRestart" | "badScan" | "missingTable" | "badEntropyData"
  | "trailingData";

export class JpegStructureError extends Error {
  readonly code: JpegStructureFailure;
  constructor(code: JpegStructureFailure) { super(code); this.code = code; }
}

const fail = (code: JpegStructureFailure): never => { throw new JpegStructureError(code); };

interface Component { id: number; quantTable: number; h: number; v: number }

/** Returns the frame size when `bytes` is exactly a baseline JFIF JPEG of the shape the iPhone encoder emits. */
export function validateJpegStructure(bytes: Uint8Array, maxBytes = JPEG_MAX_BYTES): { width: number; height: number } {
  if (bytes.length > maxBytes) fail("tooLarge");
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) fail("notJpeg");
  const quant = new Set<number>(), dcTables = new Set<number>(), acTables = new Set<number>();
  let jfif = false, restartInterval = 0, width = 0, height = 0;
  let components: Component[] | null = null;
  let position = 2;
  for (;;) {
    if (position + 4 > bytes.length) fail("truncated");
    if (bytes[position] !== 0xff) fail("truncated");
    const marker = bytes[position + 1];
    if (marker === 0xff) fail("fillBytes");
    const length = bytes[position + 2] * 256 + bytes[position + 3];
    const start = position + 4, end = position + 2 + length;
    if (length < 2 || end > bytes.length) fail("truncated");
    if (marker === 0xda) { position = scanHeader(bytes, start, end, components, quant, dcTables, acTables); break; }
    switch (marker) {
      case 0xe0: { // APP0: exactly one JFIF header without a thumbnail.
        if (jfif || length !== 16) fail("badJfif");
        const id = bytes.subarray(start, start + 5);
        if (!(id[0] === 0x4a && id[1] === 0x46 && id[2] === 0x49 && id[3] === 0x46 && id[4] === 0)) fail("badJfif");
        if (bytes[start + 12] !== 0 || bytes[start + 13] !== 0) fail("badJfif");
        jfif = true; break;
      }
      case 0xdb: { // DQT
        let p = start;
        while (p < end) {
          const precision = bytes[p] >> 4, id = bytes[p] & 15;
          if (precision > 1 || id > 3) fail("badQuantTable");
          p += 1 + 64 * (precision + 1);
          quant.add(id);
        }
        if (p !== end) fail("badQuantTable");
        break;
      }
      case 0xc4: { // DHT
        let p = start;
        while (p < end) {
          if (p + 17 > end) fail("badHuffmanTable");
          const tableClass = bytes[p] >> 4, id = bytes[p] & 15;
          if (tableClass > 1 || id > 3) fail("badHuffmanTable");
          let count = 0;
          for (let i = 1; i <= 16; i++) count += bytes[p + i];
          if (count === 0 || count > 256) fail("badHuffmanTable");
          p += 17 + count;
          (tableClass === 0 ? dcTables : acTables).add(id);
        }
        if (p !== end) fail("badHuffmanTable");
        break;
      }
      case 0xc0: { // SOF0, baseline only, exactly once.
        if (components || length < 8) fail("badFrame");
        const precision = bytes[start], count = bytes[start + 5];
        height = bytes[start + 1] * 256 + bytes[start + 2];
        width = bytes[start + 3] * 256 + bytes[start + 4];
        if (precision !== 8 || (count !== 1 && count !== 3) || length !== 8 + 3 * count) fail("badFrame");
        if (!width || !height || width > JPEG_MAX_DIMENSION || height > JPEG_MAX_DIMENSION || width * height > JPEG_MAX_PIXELS) fail("dimensions");
        components = [];
        for (let i = 0; i < count; i++) {
          const p = start + 6 + 3 * i, h = bytes[p + 1] >> 4, v = bytes[p + 1] & 15;
          if (h < 1 || h > 2 || v < 1 || v > 2 || bytes[p + 2] > 3) fail("badFrame");
          if (components.some((c) => c.id === bytes[p])) fail("badFrame");
          components.push({ id: bytes[p], quantTable: bytes[p + 2], h, v });
        }
        break;
      }
      case 0xdd: // DRI
        if (length !== 4) fail("badRestart");
        restartInterval = bytes[start] * 256 + bytes[start + 1];
        break;
      default: // APP1–APP15 (EXIF/GPS/XMP/ICC/maker notes), COM, progressive/lossless/arithmetic frames, DNL, DHP…
        fail("forbiddenSegment");
    }
    position = end;
  }
  if (!jfif) fail("badJfif");
  // Restart markers must be exactly RST0, RST1, … RST7, RST0, … once per interval, so their count follows from the frame.
  const frame = components as unknown as Component[];
  const hMax = Math.max(...frame.map((c) => c.h)), vMax = Math.max(...frame.map((c) => c.v));
  const mcus = frame.length === 1 ? Math.ceil(width / 8) * Math.ceil(height / 8)
    : Math.ceil(width / (8 * hMax)) * Math.ceil(height / (8 * vMax));
  const expectedRestarts = restartInterval > 0 ? Math.ceil(mcus / restartInterval) - 1 : 0;
  entropyData(bytes, position, expectedRestarts);
  return { width, height };
}

function scanHeader(bytes: Uint8Array, start: number, end: number, components: Component[] | null,
  quant: Set<number>, dc: Set<number>, ac: Set<number>): number {
  if (!components) fail("badScan");
  const frame = components as Component[];
  const count = bytes[start];
  // Baseline, one interleaved scan holding every component: anything else would be a second scan or progression.
  if (count !== frame.length || end - start !== 4 + 2 * count) fail("badScan");
  for (let i = 0; i < count; i++) {
    const component = frame[i], selector = bytes[start + 1 + 2 * i], tables = bytes[start + 2 + 2 * i];
    if (selector !== component.id) fail("badScan");
    if (!quant.has(component.quantTable) || !dc.has(tables >> 4) || !ac.has(tables & 15)) fail("missingTable");
  }
  const p = start + 1 + 2 * count;
  if (bytes[p] !== 0 || bytes[p + 1] !== 63 || bytes[p + 2] !== 0) fail("badScan");
  return end;
}

/**
 * After the scan header only stuffed 0xFF00, the expected RSTn sequence and one final EOI may appear. A single
 * non-interleaved component (grayscale) counts 8×8 blocks; an interleaved scan counts MCUs of the largest sampling.
 */
function entropyData(bytes: Uint8Array, from: number, expectedRestarts: number) {
  const last = bytes.length - 2;
  if (last < from || bytes[last] !== 0xff || bytes[last + 1] !== 0xd9) fail("trailingData");
  let restarts = 0;
  let p = bytes.indexOf(0xff, from);
  while (p !== -1 && p < last) {
    const next = bytes[p + 1];
    if (next === 0xd0 + (restarts % 8) && restarts < expectedRestarts) restarts++;
    else if (next !== 0) fail("badEntropyData");
    p = bytes.indexOf(0xff, p + 2);
  }
  if (restarts !== expectedRestarts) fail("badRestart");
}
