// Local synthetic data only. Never a publication decision or a production dataset.
import { createHash } from "node:crypto";
import { SEED_AREAS } from "../../src/coverage/seed-areas.ts";

export const CORPUS_VERSION = "synthetic-community.v1";
export const CORPUS_SEED = 151152;
export const PROFILES = { small: 1000, medium: 10000, large: 50000, stress: 100000 } as const;
export type Profile = keyof typeof PROFILES;
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
/** A lazy stream: fixed seed and profile repeat exactly; no million-row array. Five reports per spot. */
export function* syntheticSpots(profile: Profile, seed = CORPUS_SEED): Generator<SyntheticSpot> {
  for (let i = 0; i < PROFILES[profile]; i++) {
    // Every seed receives spots before concentrating one quarter of the rest in the six urban areas.
    const dense = i >= SEED_AREAS.length && i % 4 === 0;
    const area = dense ? SEED_AREAS.find((s) => s.id === DENSE_AREAS[Math.floor(i / 4) % DENSE_AREAS.length])! : SEED_AREAS[i % SEED_AREAS.length];
    const spread = dense ? 0.001 : 0.007;
    yield { ordinal: i, spotId: syntheticId("sp", i), applicationId: syntheticId("ca", i), seedAreaId: area.id,
      prefecture: area.prefecture, latitude: Math.round((area.latitude + (random(i * 2, seed) - .5) * spread) * 1e5) / 1e5,
      longitude: Math.round((area.longitude + (random(i * 2 + 1, seed) - .5) * spread) * 1e5) / 1e5,
      scenario: SCENARIOS[i % SCENARIOS.length], dense,
      reportIds: Array.from({ length: 5 }, (_, j) => syntheticId("rp", i * 5 + j)) };
  }
}
export function corpusDigest(profile: Profile, seed = CORPUS_SEED): string {
  const hash = createHash("sha256");
  for (const spot of syntheticSpots(profile, seed)) hash.update(JSON.stringify(spot) + "\n");
  return hash.digest("hex");
}
