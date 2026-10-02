import type { DatabaseSync } from "node:sqlite";
import { literal } from "../src/pipeline/promotion.ts";
import { canonicalJson, D1_CAPACITY_POLICY, type PromotionV4Manifest } from "./promotion-v4-format.ts";
import { readV4Manifest, verifyPromotionV4, verifyV4File } from "./promotion-v4-verify.ts";

import { validateV4Tile } from "./promotion-v4-tiles.ts";

type Row = Record<string, unknown>;
function run(db: DatabaseSync, sql: string): void {
  if (Buffer.byteLength(sql) > D1_CAPACITY_POLICY.statementBytes) throw new Error("v4: control statement exceeds capacity policy");
  db.exec(sql);
}
function start(db: DatabaseSync, manifest: PromotionV4Manifest): void {
  const existing = db.prepare("SELECT * FROM promotion_v4_manifests WHERE id=1").get() as Row | undefined;
  if (existing) {
    if (existing.manifest_sha256 !== manifest.wholeBundleSha256) throw new Error("v4: wrong manifest for GREEN");
    return;
  }
  db.exec("BEGIN");
  try {
    run(db, `INSERT INTO promotion_v4_manifests (id,manifest_sha256,capacity_policy,expected_chunks) VALUES (1,${literal(manifest.wholeBundleSha256)},${literal(manifest.capacityPolicy)},${manifest.chunks.length});`);
    for (const s of manifest.sources) {
      run(db, `INSERT INTO promotion_v4_expected_sources (source_id,manifest_id,release_id,release_content_sha256,display_name,license_name,license_url,attribution_text,review_dependencies_json,expected_rows_json,observed_on) VALUES (${[s.sourceId, 1, s.releaseId, s.releaseContentSha256, s.displayName, s.licenseName, s.licenseUrl, s.attributionText, JSON.stringify(s.reviewDependencies), JSON.stringify(s.rows), s.observedOn].map(literal).join(",")});`);
      for (const r of s.additiveReleases ?? []) run(db, `INSERT INTO promotion_v4_expected_releases (release_id,source_id,release_content_sha256) VALUES (${r.releaseId},${literal(s.sourceId)},${literal(r.releaseContentSha256)});`);
    }
    for (const c of manifest.chunks) run(db, `INSERT INTO promotion_v4_expected_chunks (ordinal,manifest_id,sha256,bytes,statements,rows_json) VALUES (${c.ordinal},1,${literal(c.sha256)},${c.bytes},${c.statements},${literal(canonicalJson(c.rows))});`);
    for (const t of manifest.tiles) {
      run(db, `INSERT INTO promotion_v4_expected_tiles (tile_id,manifest_id,revision,spot_count,content_sha256,schema_version,part_count) VALUES (${literal(t.tileId)},1,${t.revision},${t.spotCount},${literal(t.contentSha256)},${t.schemaVersion},${t.parts.length});`);
      for (const p of t.parts) run(db, `INSERT INTO promotion_v4_expected_tile_parts (tile_id,part_index,spot_count,content_sha256) VALUES (${literal(t.tileId)},${p.partIndex},${p.spotCount},${literal(p.contentSha256)});`);
    }
    db.exec("COMMIT");
  } catch (error) { db.exec("ROLLBACK"); throw error; }
}
export function nextUnappliedChunk(db: DatabaseSync, digest: string): number | null {
  const manifest = db.prepare("SELECT manifest_sha256,expected_chunks FROM promotion_v4_manifests WHERE id=1").get() as Row | undefined;
  if (!manifest || manifest.manifest_sha256 !== digest) throw new Error("v4: wrong manifest");
  const next = db.prepare("SELECT min(e.ordinal) AS ordinal FROM promotion_v4_expected_chunks e LEFT JOIN promotion_v4_applied_chunks a USING(ordinal) WHERE a.ordinal IS NULL").get() as { ordinal: number | null };
  return next.ordinal;
}
/** Atomic payload+receipt, with a second digest check inside the transaction to close file replacement races. */
export async function applyV4Chunk(db: DatabaseSync, directory: string, digest: string, ordinal: number): Promise<"applied" | "alreadyApplied"> {
  const manifest = await readV4Manifest(directory, digest);
  const chunk = manifest.chunks[ordinal - 1];
  if (!chunk || chunk.ordinal !== ordinal) throw new Error("v4: unknown chunk ordinal");
  const before = await verifyV4File(directory, chunk);
  if (canonicalJson(before.rows) !== canonicalJson(chunk.rows)) throw new Error("v4: chunk count mismatch");
  const existingManifest = db.prepare("SELECT manifest_sha256 FROM promotion_v4_manifests WHERE id=1").get() as Row | undefined;
  if (!existingManifest || existingManifest.manifest_sha256 !== digest) throw new Error("v4: wrong manifest for GREEN");
  const receipt = db.prepare("SELECT * FROM promotion_v4_applied_chunks WHERE ordinal=?").get(ordinal) as Row | undefined;
  if (receipt) {
    if (receipt.sha256 !== chunk.sha256 || receipt.manifest_sha256 !== digest) throw new Error("v4: same ordinal with different digest");
    return "alreadyApplied";
  }
  if (nextUnappliedChunk(db, digest) !== ordinal) throw new Error("v4: out-of-order chunk");
  if (db.prepare("SELECT 1 FROM promotion_v4_completions").get()) throw new Error("v4: GREEN is complete");
  db.exec("BEGIN");
  try {
    if (ordinal === 1) run(db, `INSERT INTO promotion_v4_chunk_sessions (id,ordinal,manifest_sha256,sha256) VALUES (1,1,${literal(digest)},${literal(chunk.sha256)});`);
    const result = await verifyV4File(directory, chunk, sql => run(db, sql));
    if (canonicalJson(result.rows) !== canonicalJson(chunk.rows)) throw new Error("v4: chunk changed while applying");
    if (ordinal === 1) run(db, "DELETE FROM promotion_v4_chunk_sessions WHERE id=1;");
    run(db, `INSERT INTO promotion_v4_applied_chunks (ordinal,manifest_sha256,sha256,bytes,statements,rows_json) VALUES (${ordinal},${literal(digest)},${literal(chunk.sha256)},${chunk.bytes},${chunk.statements},${literal(canonicalJson(chunk.rows))});`);
    db.exec("COMMIT");
    return "applied";
  } catch (error) { db.exec("ROLLBACK"); throw error; }
}

async function verifyFinalState(db: DatabaseSync, manifest: PromotionV4Manifest): Promise<void> {
  const bootstrap = db.prepare("SELECT expected_rows_json FROM promotion_multi_bootstraps WHERE promotion_bootstrap_id=1").get() as Row | undefined;
  if (!bootstrap || canonicalJson(JSON.parse(String(bootstrap.expected_rows_json))) !== canonicalJson(manifest.rows)) throw new Error("v4: wrong final counts declaration");
  for (const s of manifest.sources) {
    const actual = db.prepare("SELECT * FROM promotion_multi_bootstrap_sources WHERE source_id=?").get(s.sourceId) as Row | undefined;
    if (!actual || actual.release_id !== s.releaseId || actual.release_content_sha256 !== s.releaseContentSha256
      || actual.display_name !== s.displayName || actual.license_name !== s.licenseName || actual.license_url !== s.licenseUrl
      || actual.attribution_text !== s.attributionText || canonicalJson(JSON.parse(String(actual.expected_rows_json))) !== canonicalJson(s.rows)
      || canonicalJson(JSON.parse(String(actual.review_dependencies_json))) !== canonicalJson(s.reviewDependencies)) throw new Error("v4: wrong source/release identity");
    const anchor = db.prepare("SELECT observed_on FROM source_releases WHERE release_id=?").get(s.releaseId) as Row | undefined;
    if (!anchor || anchor.observed_on !== s.observedOn) throw new Error("v4: wrong source observation date");
    let index = 0;
    for (const declared of db.prepare("SELECT release_id,release_content_sha256 FROM promotion_multi_bootstrap_additive_releases WHERE source_id=? ORDER BY release_id").iterate(s.sourceId)) {
      const expected = s.additiveReleases?.[index++];
      if (!expected || declared.release_id !== expected.releaseId || declared.release_content_sha256 !== expected.releaseContentSha256) throw new Error("v4: additive declaration set mismatch");
    }
    if (index !== (s.additiveReleases?.length ?? 0)) throw new Error("v4: additive declaration set mismatch");
    for (const release of s.additiveReleases ?? []) {
      const row = db.prepare("SELECT source_id,content_sha256 FROM source_releases WHERE release_id=?").get(release.releaseId) as Row | undefined;
      if (row?.source_id !== s.sourceId || row.content_sha256 !== release.releaseContentSha256) throw new Error("v4: additive release mismatch");
    }
  }
  const sources: Row[] = []; let sourceBytes = 0;
  for (const s of manifest.sources) {
    const row = db.prepare("SELECT * FROM sources WHERE source_id=?").get(s.sourceId) as Row;
    sourceBytes += Buffer.byteLength(JSON.stringify(row));
    if (sourceBytes > D1_CAPACITY_POLICY.maxManifestBytes) throw new Error("v4: source metadata exceeds capacity policy");
    sources.push(row);
  }
  for (const expected of manifest.tiles) {
    const tile = db.prepare("SELECT * FROM tile_snapshots WHERE tile_id=?").get(expected.tileId) as Row | undefined;
    if (!tile || tile.content_sha256 !== expected.contentSha256 || tile.revision !== expected.revision || tile.spot_count !== expected.spotCount
      || Buffer.byteLength(String(tile.body_json)) > D1_CAPACITY_POLICY.statementBytes) throw new Error("v4: wrong tile final state");
    const actual = await validateV4Tile(db, tile, sources);
    if (canonicalJson(actual) !== canonicalJson(expected)) throw new Error("v4: tile part declaration mismatch");
  }
}
export async function finalizePromotionV4(db: DatabaseSync, directory: string, digest: string): Promise<"completed" | "alreadyCompleted"> {
  const manifest = await verifyPromotionV4(directory, digest);
  if (nextUnappliedChunk(db, digest) !== null) throw new Error("v4: missing chunk; GREEN is unfinished");
  const completed = db.prepare("SELECT manifest_sha256 FROM promotion_v4_completions WHERE id=1").get() as Row | undefined;
  if (completed) {
    if (completed.manifest_sha256 !== digest) throw new Error("v4: completion digest mismatch");
    return "alreadyCompleted";
  }
  db.exec("BEGIN");
  try {
    await verifyFinalState(db, manifest);
    await verifyV4File(directory, manifest.finalize, sql => run(db, sql));
    run(db, `INSERT INTO promotion_v4_completions (id,manifest_sha256) VALUES (1,${literal(digest)});`);
    db.exec("COMMIT");
    return "completed";
  } catch (error) { db.exec("ROLLBACK"); throw error; }
}
/** Whole artifact preflight before any mutation. stopAfter is only for resumability tests/simulation. */
export async function applyPromotionV4(db: DatabaseSync, directory: string, digest: string, options: { stopAfter?: number } = {}): Promise<{ status: string; nextChunk: number | null }> {
  if (options.stopAfter !== undefined && (!Number.isSafeInteger(options.stopAfter) || options.stopAfter < 0)) throw new Error("v4: stopAfter must be a nonnegative integer");
  const manifest = await verifyPromotionV4(directory, digest);
  start(db, manifest);
  for (const chunk of manifest.chunks) {
    if (options.stopAfter !== undefined && chunk.ordinal > options.stopAfter) return { status: "unfinished", nextChunk: nextUnappliedChunk(db, digest) };
    await applyV4Chunk(db, directory, digest, chunk.ordinal);
  }
  return { status: await finalizePromotionV4(db, directory, digest), nextChunk: null };
}
