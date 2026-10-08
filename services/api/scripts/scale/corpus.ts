// Local synthetic data only. Never a publication decision or a production dataset.
import { createHash } from "node:crypto";
import { SEED_AREAS } from "../../src/coverage/seed-areas.ts";
import { tileForCoordinate, DATA_TILE_ZOOM } from "../../src/geo/tile.ts";

export const CORPUS_VERSION = "synthetic-community.v1";
export const CORPUS_SEED = 151152;
export const PROFILES = { small: 1000, medium: 10000, large: 50000, stress: 100000 } as const;
export type Profile = keyof typeof PROFILES;

// Configuration-only coordinate distributions for the nationwide capacity validation
// (docs/research/2026-10-08-nationwide-capacity-validation.md). They change ONLY the latitude/longitude a
// synthetic spot receives; every spot still flows through the same intake/moderation/reconciliation/publish/
// promotion code. "mixed" is the pre-existing #156 blend and is byte-identical to before (its digest is pinned).
//  - sparse:       scattered across the Japanese archipelago's bounding box (nationwide, ~1 spot per tile).
//  - concentrated: split between the Tokyo and Osaka metros (dense, many tiles inside two cities).
//  - extreme:      every spot inside ONE z14 tile, to probe the tile-parts.v1 hard gate (128 parts) by density.
export const DISTRIBUTIONS = ["mixed", "sparse", "concentrated", "extreme"] as const;
export type Distribution = typeof DISTRIBUTIONS[number];
const JAPAN = { latMin: 24.0, latMax: 45.5, lonMin: 123.0, lonMax: 146.0 };
const TOKYO = { latitude: 35.681, longitude: 139.767 };
const OSAKA = { latitude: 34.702, longitude: 135.496 };
const EXTREME_SEED = { latitude: 35.6896, longitude: 139.7006 };
const round5 = (n: number) => Math.round(n * 1e5) / 1e5;
/** Geometric centre of the z14 tile a coordinate falls in: placing the extreme regime here keeps jitter in-tile. */
function tileCentre(lat: number, lon: number, z: number) {
  const t = tileForCoordinate(lat, lon, z), n = 2 ** z;
  const lonC = ((t.x + 0.5) / n) * 360 - 180;
  const latC = (Math.atan(Math.sinh(Math.PI * (1 - (2 * (t.y + 0.5)) / n))) * 180) / Math.PI;
  return { latitude: latC, longitude: lonC };
}
const EXTREME_CENTRE = tileCentre(EXTREME_SEED.latitude, EXTREME_SEED.longitude, DATA_TILE_ZOOM);
/** The coordinate a spot receives under a distribution. Deterministic in (index, seed). */
function coordinate(distribution: Distribution, i: number, seed: number, mixed: { latitude: number; longitude: number }) {
  const r1 = random(i * 2, seed), r2 = random(i * 2 + 1, seed);
  if (distribution === "mixed") return mixed;
  if (distribution === "sparse") {
    return { latitude: round5(JAPAN.latMin + r1 * (JAPAN.latMax - JAPAN.latMin)),
      longitude: round5(JAPAN.lonMin + r2 * (JAPAN.lonMax - JAPAN.lonMin)) };
  }
  if (distribution === "concentrated") {
    const metro = i % 2 === 0 ? TOKYO : OSAKA; // urban spread spans many tiles inside each city
    return { latitude: round5(metro.latitude + (r1 - 0.5) * 0.12), longitude: round5(metro.longitude + (r2 - 0.5) * 0.12) };
  }
  // extreme: jitter +/-0.003deg around the tile centre stays well inside the ~0.022deg z14 tile.
  return { latitude: round5(EXTREME_CENTRE.latitude + (r1 - 0.5) * 0.006), longitude: round5(EXTREME_CENTRE.longitude + (r2 - 0.5) * 0.006) };
}
export const SCENARIOS = ["reported", "visitedConfirmed", "communityVerified", "stale", "needsRecheck", "correction", "relocation", "conflicting", "duplicate", "absence", "accessRefinement", "typeRefinement"] as const;
export const DENSE_AREAS = ["tokyo-shinjuku", "tokyo-shibuya", "tokyo-ikebukuro", "osaka-umeda", "fukuoka-hakata", "hokkaido-susukino"] as const;
const alphabet = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
export function syntheticId(prefix: string, number: number): string {
  let n = BigInt(number + 1), encoded = "";
  for (let i = 0; i < 25; i++) { encoded = alphabet[Number(n & 31n)] + encoded; n >>= 5n; }
  return `${prefix}_Z${encoded}`;
}
function random(index: number, seed: number): number {
  let x = (index ^ seed) >>> 0;
  x = Math.imul(x ^ (x >>> 16), 0x45d9f3b);
  x = Math.imul(x ^ (x >>> 16), 0x45d9f3b);
  return ((x ^ (x >>> 16)) >>> 0) / 4294967296;
}
export interface SyntheticSpot {
  ordinal: number; spotId: string; applicationId: string; seedAreaId: string; prefecture: string;
  latitude: number; longitude: number; scenario: typeof SCENARIOS[number]; dense: boolean;
  reportIds: string[];
}
/** A lazy stream: fixed seed, profile and distribution repeat exactly; no million-row array. Five reports per spot. */
export function* syntheticSpots(profile: Profile, seed = CORPUS_SEED, distribution: Distribution = "mixed"): Generator<SyntheticSpot> {
  for (let i = 0; i < PROFILES[profile]; i++) {
    // Every seed receives spots before concentrating one quarter of the rest in the six urban areas.
    const dense = i >= SEED_AREAS.length && i % 4 === 0;
    const area = dense ? SEED_AREAS.find((s) => s.id === DENSE_AREAS[Math.floor(i / 4) % DENSE_AREAS.length])! : SEED_AREAS[i % SEED_AREAS.length];
    const spread = dense ? 0.001 : 0.007;
    const mixed = { latitude: Math.round((area.latitude + (random(i * 2, seed) - .5) * spread) * 1e5) / 1e5,
      longitude: Math.round((area.longitude + (random(i * 2 + 1, seed) - .5) * spread) * 1e5) / 1e5 };
    const { latitude, longitude } = coordinate(distribution, i, seed, mixed);
    yield { ordinal: i, spotId: syntheticId("sp", i), applicationId: syntheticId("ca", i), seedAreaId: area.id,
      prefecture: area.prefecture, latitude, longitude,
      scenario: SCENARIOS[i % SCENARIOS.length], dense,
      reportIds: Array.from({ length: 5 }, (_, j) => syntheticId("rp", i * 5 + j)) };
  }
}
export function corpusDigest(profile: Profile, seed = CORPUS_SEED, distribution: Distribution = "mixed"): string {
  const hash = createHash("sha256");
  for (const spot of syntheticSpots(profile, seed, distribution)) hash.update(JSON.stringify(spot) + "\n");
  return hash.digest("hex");
}
