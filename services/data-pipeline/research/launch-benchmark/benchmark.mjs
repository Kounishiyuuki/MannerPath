// Launch-region density / tile payload benchmark for choosing DATA_TILE_ZOOM (ADR-0005).
// Research code: no dependencies, deterministic output. Not production pipeline code.
//
// Usage: node benchmark.mjs [taito.csv] [osm_23wards.json] > results.json
import { readFileSync, existsSync } from "node:fs";
import { gzipSync } from "node:zlib";

const ZOOMS = [13, 14, 15, 16];
const KS = [1, 3, 5];
const MAX_RING = 8;
const ORIGIN_SAMPLE = 1000;

// ---------- tile math (Web Mercator slippy XYZ) ----------
function tileOf(lat, lon, z) {
  const n = 2 ** z;
  const x = Math.floor(((lon + 180) / 360) * n);
  const r = (lat * Math.PI) / 180;
  const y = Math.floor(((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * n);
  return [x, y];
}
// Ground width of one tile at latitude; Mercator is conformal so height is the same.
const tileMeters = (lat, z) => (40075016.686 * Math.cos((lat * Math.PI) / 180)) / 2 ** z;
function haversine(aLat, aLon, bLat, bLon) {
  const R = 6371008.8, rad = Math.PI / 180;
  const dLat = (bLat - aLat) * rad, dLon = (bLon - aLon) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(aLat * rad) * Math.cos(bLat * rad) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

// ---------- input parsing ----------
// RFC 4180 CSV; the Taito file has a BOM, CRLF and a quoted field with an embedded newline.
function parseCsv(text) {
  text = text.replace(/^\uFEFF/, "");
  const rows = []; let row = [], field = "", q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (c === '"') q = false;
      else field += c;
    } else if (c === '"') q = true;
    else if (c === ",") { row.push(field); field = ""; }
    else if (c === "\n") { row.push(field.replace(/\r$/, "")); rows.push(row); row = []; field = ""; }
    else field += c;
  }
  if (field || row.length) { row.push(field); rows.push(row); }
  const [header, ...body] = rows;
  return body.filter((r) => r.length > 1).map((r) => Object.fromEntries(header.map((h, i) => [h, r[i] ?? ""])));
}

// ---------- estimated spot DTO (benchmark-only; the real DTO schema is not fixed) ----------
// Field set follows docs/API.md + ARCHITECTURE.md §6. String contents are taken from real
// Taito records so byte sizes reflect real Japanese names/addresses.
function makeDto(template, lat, lon, i) {
  const hasTimes = template["利用開始時間"] !== "終日利用可能";
  const heatedOnly = /加熱式たばこ専用/.test(template["名称"] + template["特記事項"]);
  return {
    id: "sp_" + i.toString(36).padStart(22, "0"),
    lat: Number(lat.toFixed(6)),
    lon: Number(lon.toFixed(6)),
    name: template["名称"],
    address: (template["設置位置"] + " " + template["方書"]).trim(),
    spotType: "publicSmokingArea",
    accessType: "public",
    paperCigarette: heatedOnly ? "no" : "unknown",
    heatedTobacco: heatedOnly ? "yes" : "unknown",
    lifecycle: "active",
    evidenceQuality: 3,
    lastVerifiedAt: "2026-08-18",
    hours: hasTimes ? { open: template["利用開始時間"], close: template["利用終了時間"] } : { allDay: true },
    notes: template["特記事項"] || undefined,
    sources: ["taito-public-smoking-areas"],
  };
}
const SOURCES = [{ id: "taito-public-smoking-areas", name: "台東区 公衆喫煙所", license: "CC BY 4.0" }];
function tileBody(z, x, y, dtos) {
  return JSON.stringify({ schemaVersion: 1, tile: `${z}/${x}/${y}`, revision: 1, generatedAt: "2026-09-20T00:00:00Z", spots: dtos, sources: dtos.length ? SOURCES : [] });
}

// ---------- stats helpers ----------
function pct(sorted, p) { return sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))] : 0; }
function summary(values) {
  const s = [...values].sort((a, b) => a - b);
  const mean = s.reduce((a, b) => a + b, 0) / (s.length || 1);
  return { n: s.length, mean: +mean.toFixed(2), p50: pct(s, 0.5), p90: pct(s, 0.9), p99: pct(s, 0.99), max: s.at(-1) ?? 0 };
}
function rng(seed) { return () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32); }

// ---------- benchmark ----------
function runScenario(name, points, origins, templates) {
  const out = { scenario: name, spots: points.length, zooms: {} };
  const emptyGzip = gzipSync(tileBody(15, 0, 0, [])).length;
  for (const z of ZOOMS) {
    const tiles = new Map();
    points.forEach((p, i) => {
      const [x, y] = tileOf(p.lat, p.lon, z);
      const k = `${x}/${y}`;
      if (!tiles.has(k)) tiles.set(k, { x, y, pts: [], dtos: [] });
      const t = tiles.get(k);
      t.pts.push(p);
      t.dtos.push(makeDto(templates[i % templates.length], p.lat, p.lon, i));
    });
    const gz = new Map();
    const raw = [];
    for (const [k, t] of tiles) {
      const body = tileBody(z, t.x, t.y, t.dtos);
      raw.push(Buffer.byteLength(body));
      gz.set(k, gzipSync(body).length);
    }
    // Nearest-k search by ring expansion: fetch ring r of tiles around the origin tile until the
    // k-th nearest candidate is within the guaranteed-covered distance r * tileWidth.
    const search = {};
    for (const k of KS) {
      const req = [], bytes = [], spotsFetched = [], unresolved = [];
      for (const o of origins) {
        const [ox, oy] = tileOf(o.lat, o.lon, z);
        const w = tileMeters(o.lat, z);
        let r = 0, done = false, nReq = 0, nBytes = 0, cand = [];
        const seen = new Set();
        while (!done && r <= MAX_RING) {
          for (let dx = -r; dx <= r; dx++) for (let dy = -r; dy <= r; dy++) {
            if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
            const key = `${ox + dx}/${oy + dy}`;
            if (seen.has(key)) continue;
            seen.add(key); nReq++;
            const t = tiles.get(key);
            nBytes += t ? gz.get(key) : emptyGzip;
            if (t) for (const p of t.pts) cand.push(haversine(o.lat, o.lon, p.lat, p.lon));
          }
          cand.sort((a, b) => a - b);
          if (cand.length >= k && cand[k - 1] <= r * w) done = true; else r++;
        }
        req.push(nReq); bytes.push(nBytes); spotsFetched.push(cand.length);
        if (!done) unresolved.push(1);
      }
      search[`k${k}`] = { requests: summary(req), gzipBytes: summary(bytes), spotsFetched: summary(spotsFetched), unresolvedWithinMaxRing: unresolved.length };
    }
    // Fixed 3x3 neighbourhood (ARCHITECTURE.md §4): requests are always 9.
    const nine = origins.map((o) => {
      const [ox, oy] = tileOf(o.lat, o.lon, z);
      let b = 0;
      for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) { const key = `${ox + dx}/${oy + dy}`; b += gz.get(key) ?? emptyGzip; }
      return b;
    });
    out.zooms[z] = {
      tileWidthMetersAt35_7N: Math.round(tileMeters(35.7, z)),
      occupiedTiles: tiles.size,
      spotsPerOccupiedTile: summary([...tiles.values()].map((t) => t.pts.length)),
      tileRawBytes: summary(raw),
      tileGzipBytes: summary([...gz.values()]),
      emptyTileGzipBytes: emptyGzip,
      fixed3x3: { guaranteedRadiusMeters: Math.round(tileMeters(35.7, z)), gzipBytes: summary(nine) },
      nearestK: search,
    };
  }
  return out;
}

const taitoPath = process.argv[2] ?? new URL("../../fixtures/taito-public-smoking-areas/20260818_koshukitsuenjo.csv", import.meta.url).pathname;
const osmPath = process.argv[3] ?? new URL("./.cache/osm_23wards.json", import.meta.url).pathname;
const taito = parseCsv(readFileSync(taitoPath, "utf8"));
const taitoPts = taito.map((r) => ({ lat: +r["緯度"], lon: +r["経度"] }));
const rand = rng(20260920);
const results = { generatedBy: "benchmark.mjs", zooms: ZOOMS, originSample: ORIGIN_SAMPLE, scenarios: [] };

// Origins for Taito: uniform over the dataset's bounding box (the ward's populated core).
const lats = taitoPts.map((p) => p.lat), lons = taitoPts.map((p) => p.lon);
const bb = [Math.min(...lats), Math.max(...lats), Math.min(...lons), Math.max(...lons)];
const taitoOrigins = Array.from({ length: ORIGIN_SAMPLE }, () => ({ lat: bb[0] + rand() * (bb[1] - bb[0]), lon: bb[2] + rand() * (bb[3] - bb[2]) }));
results.scenarios.push(runScenario("taito-official", taitoPts, taitoOrigins, taito));

if (existsSync(osmPath)) {
  const osm = JSON.parse(readFileSync(osmPath, "utf8"));
  const pos = (e) => (e.type === "node" ? { lat: e.lat, lon: e.lon } : e.center);
  const smoking = osm.elements.filter((e) => e.tags?.amenity === "smoking_area").map(pos).filter(Boolean);
  const konbini = osm.elements.filter((e) => e.tags?.shop === "convenience").map(pos).filter(Boolean);
  // Origins: a deterministic sample of convenience-store positions, as a proxy for "somewhere on a
  // street in the 23 wards" (avoids sampling the bay or rivers). Jittered by up to ±250 m so an
  // origin never coincides with a stress-scenario spot.
  const osmOrigins = Array.from({ length: ORIGIN_SAMPLE }, () => {
    const b = konbini[Math.floor(rand() * konbini.length)];
    return { lat: b.lat + (rand() - 0.5) * 0.0045, lon: b.lon + (rand() - 0.5) * 0.0055 };
  });
  results.osmSnapshot = osm.osm3s?.timestamp_osm_base;
  results.scenarios.push(runScenario("osm-smoking-area-23wards (density proxy)", smoking, osmOrigins, taito));
  results.scenarios.push(runScenario("stress: osm smoking_area + every konbini (hypothetical upper bound)", [...smoking, ...konbini], osmOrigins, taito));
}
console.log(JSON.stringify(results, null, 1));
