// Real Kanazawa candidate facts enter the existing advisory intake, never an approved source.
// The isolated SQL staging test deliberately supplies BLOCKED test registry rows. It exercises
// ingestRelease's raw-evidence boundary only, not a production importer or source approval path.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { prepareIntake, receiptSchema } from "../scripts/source-intake.ts";
import { SOURCE_ADAPTERS } from "../src/pipeline/adapters.ts";
import { ingestRelease } from "../src/pipeline/ingest.ts";
import { ensureReviewedSource, REVIEWED_SOURCES } from "../src/pipeline/registry.ts";
import { resolveFirstRelease } from "../src/pipeline/resolve.ts";
import type { SourceAdapter } from "../src/pipeline/source-adapter.ts";
import { publishTiles } from "../src/tiles/publish.ts";
import { importTaito, sequentialSpotIds } from "./support/fixture.ts";
import { SqliteD1 } from "./support/sqlite-d1.ts";

const DIRECTORY = new URL("../../data-pipeline/research/official-source-intake/kanazawa/", import.meta.url);
const NOW = "2026-10-26T00:00:00Z";
interface Candidate {
  candidateId: string;
  name: string;
  sourceUrl: string;
  checkedAt: string;
  prefecture: string;
  municipality: string;
  supportsPaper: string;
  supportsHeated: string;
  openingHours: { status: string; raw: null; parsed: null };
  accessType: string;
  accessDetail: null;
  latitude: null;
  longitude: null;
  locationPrecision: string;
  locationAnchorCandidate: null | {
    latitude: number; longitude: number; scope: string; reviewStatus: string; rightsStatus: string;
  };
  publicationStatus: string;
}
interface Input {
  sourceId: string;
  factsFile: string;
  receiptFile: string;
  expectedRows: number;
  factsSha256: string;
}
const manifest = JSON.parse(readFileSync(new URL("manifest.json", DIRECTORY), "utf8")) as { version: number; sources: Input[] };
const inputs = manifest.sources.map(source => {
  const bytes = new Uint8Array(readFileSync(new URL(source.factsFile, DIRECTORY)));
  const rows = JSON.parse(new TextDecoder().decode(bytes)) as Candidate[];
  const metadata = JSON.parse(readFileSync(new URL(source.receiptFile, DIRECTORY), "utf8"));
  return { ...source, bytes, rows, metadata };
});

/** No real candidate can be observed/resolved through this test-only raw JSON envelope. */
function blockedRawAdapter(input: typeof inputs[number]): SourceAdapter {
  return {
    registry: { sourceId: input.sourceId, displayName: "TEST ONLY Kanazawa raw candidate staging", kind: "operator",
      licenseName: null, licenseUrl: null, attributionText: null, publicationStatus: "blocked" },
    parserVersion: "kanazawa-test-raw.v1", mappingVersion: "kanazawa-test-unreviewed.v1", resolverVersion: "kanazawa-test-unreviewed.v1",
    parse(bytes) {
      const rows = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)) as Candidate[];
      return { header: ["candidate_json"], rows: rows.map(row => [JSON.stringify(row)]) };
    },
    // candidateId is an analyst's queue key, not a publisher-assigned stable record ID.
    upstreamRowRef: () => null,
    observe() { throw new Error("Kanazawa candidate requires rights and location review"); },
    assertResolvable() { throw new Error("Kanazawa candidate is not approved for resolution"); },
    attenuate: () => [], crossReleaseValidated: false,
    attenuationReference: { attestationVersion: "kanazawa-test-unreviewed.v1", referenceKind: "test-only-blocked-staging",
      referenceUrl: input.metadata.resourceUrl, checkedAt: "2026-10-26" },
  };
}

test("four real candidates are retained by source:intake while rights, location and publication remain unapproved", () => {
  assert.equal(manifest.version, 1);
  assert.equal(inputs.length, 3);
  assert.equal(inputs.reduce((count, input) => count + input.expectedRows, 0), 4);
  const registryBefore = structuredClone(REVIEWED_SOURCES);
  const candidateIds = new Set<string>();
  for (const input of inputs) {
    assert.equal(input.rows.length, input.expectedRows);
    const originalBytes = input.bytes.slice();
    const originalMetadata = structuredClone(input.metadata);
    const result = prepareIntake({ metadata: input.metadata, bytes: input.bytes, format: "json" });
    assert.equal(result.inspection.rawRowCount, input.expectedRows);
    assert.equal(result.inspection.sha256, createHash("sha256").update(input.bytes).digest("hex"));
    assert.equal(result.inspection.sha256, input.factsSha256, "the reviewed candidate bytes are pinned by the manifest");
    assert.equal(result.inspection.identicalRowCount, 0);
    assert.equal(result.publicationStatus, "blocked");
    assert.equal(result.productionApproval, false);
    assert.equal(result.approvalAutomated, false);
    assert.equal(result.humanReviewRequired, true);
    assert.equal(result.receipt.reviewStatus, "UNREVIEWED");
    assert.equal(result.onboarding.state, "BLOCKED");
    assert.equal(result.onboarding.rights.status, "RIGHTS_REVIEW_REQUIRED");
    assert.equal(result.onboarding.coordinates.status, "COORDINATE_AUTHORITY_REQUIRED");
    assert.equal(result.onboarding.coordinates.kind, "unknown");
    assert.equal(result.onboarding.quality, "notEvaluated");
    assert.equal(result.onboarding.promotion, "notEvaluated");
    assert.equal(result.adapterPreview, null);
    assert.deepEqual(input.bytes, originalBytes);
    assert.deepEqual(input.metadata, originalMetadata);
    for (const row of input.rows) {
      assert.equal(candidateIds.has(row.candidateId), false);
      candidateIds.add(row.candidateId);
      assert.equal(row.publicationStatus, "blocked");
      assert.equal(row.prefecture, "石川県");
      assert.equal(row.municipality, "金沢市");
      assert.equal(row.sourceUrl, result.receipt.resourceUrl);
      assert.equal(row.checkedAt, "2026-10-26");
      assert.equal(row.supportsPaper, "unknown");
      assert.equal(row.supportsHeated, "unknown");
      assert.deepEqual(row.openingHours, { status: "none", raw: null, parsed: null });
      assert.equal(row.accessType, "unknown");
      assert.equal(row.accessDetail, null);
      assert.equal(row.latitude, null, "no exact smoking coordinate is invented");
      assert.equal(row.longitude, null);
    }
  }
  assert.equal(candidateIds.size, 4);
  assert.deepEqual(REVIEWED_SOURCES, registryBefore);
});

test("the museum government facility point remains an unreviewed approximate proposal, never a smoking point", () => {
  const rows = inputs.flatMap(input => input.rows);
  const approximate = rows.filter(row => row.locationAnchorCandidate !== null);
  assert.equal(approximate.length, 1);
  const museum = approximate[0];
  assert.match(museum.name, /21世紀美術館/);
  assert.equal(museum.locationPrecision, "areaApproximate");
  assert.equal(museum.locationAnchorCandidate?.rightsStatus, "unreviewed");
  assert.deepEqual(museum.locationAnchorCandidate && {
    latitude: museum.locationAnchorCandidate.latitude, longitude: museum.locationAnchorCandidate.longitude,
    scope: museum.locationAnchorCandidate.scope, reviewStatus: museum.locationAnchorCandidate.reviewStatus,
  }, { latitude: 36.560867, longitude: 136.658258, scope: "facility", reviewStatus: "UNREVIEWED" });
  for (const row of rows.filter(row => row !== museum)) {
    assert.equal(row.locationPrecision, "unknown");
    assert.equal(row.locationAnchorCandidate, null, "no station point is duplicated into east and west zone anchors");
  }
});

test("approval claims and mismatched adapters cannot turn Kanazawa receipts into reviewed source data", () => {
  for (const input of inputs) {
    for (const claim of [{ productionApproval: true }, { publicationStatus: "approved" }, { reviewStatus: "APPROVED" }]) {
      assert.equal(receiptSchema.safeParse({ ...input.metadata, ...claim }).success, false);
    }
    const other = inputs.find(item => item.sourceId !== input.sourceId)!;
    assert.throws(() => prepareIntake({ metadata: input.metadata, bytes: input.bytes, format: "json", adapter: blockedRawAdapter(other) }),
      /Adapter must match receipt sourceId/);
    assert.throws(() => prepareIntake({ metadata: input.metadata, bytes: input.bytes, format: "json", adapter: blockedRawAdapter(input) }),
      /Adapter preview failed/);
    assert.equal(SOURCE_ADAPTERS.some(adapter => adapter.registry.sourceId === input.sourceId), false);
    assert.equal(REVIEWED_SOURCES.some(source => source.sourceId === input.sourceId), false);
  }
});

test("disposable blocked staging stores four raw candidate rows but adds no canonical IDs or published tile bytes", async () => {
  const db = new SqliteD1();
  try {
    await importTaito(db, { newSpotId: sequentialSpotIds("Q") });
    await publishTiles(db, { now: NOW });
    const publishedState = () => ({
      spots: db.raw.prepare("SELECT * FROM spots ORDER BY spot_id").all(),
      tiles: db.raw.prepare("SELECT * FROM tile_snapshots ORDER BY tile_id").all(),
      parts: db.raw.prepare("SELECT * FROM tile_snapshot_parts ORDER BY tile_id, part_index").all(),
      membership: db.raw.prepare("SELECT * FROM tile_snapshot_spots ORDER BY tile_id, spot_id").all(),
    });
    const before = publishedState();
    assert.ok(before.spots.length > 0);
    assert.ok(before.tiles.length > 0);
    let stagedRows = 0;
    for (const input of inputs) {
      await assert.rejects(ensureReviewedSource(db, input.sourceId, NOW), /is not a reviewed source/);
      assert.equal(db.raw.prepare("SELECT count(*) AS n FROM sources WHERE source_id = ?").get(input.sourceId)?.n, 0);
      // TEST ONLY: an explicitly blocked row permits exercising the existing raw-evidence storage.
      // No production registry function accepts these sources, and this adapter never emits observations.
      db.raw.prepare(`INSERT INTO sources (source_id, display_name, kind, license_name, license_url, attribution_text,
        publication_status, created_at, updated_at) VALUES (?, 'TEST ONLY blocked Kanazawa candidate', 'operator', NULL, NULL,
        NULL, 'blocked', ?, ?)`).run(input.sourceId, NOW, NOW);
      const adapter = blockedRawAdapter(input);
      const metadata = { sourceUrl: input.metadata.resourceUrl, observedOn: null, fetchedAt: NOW, httpLastModified: null };
      const release = await ingestRelease(db, adapter, input.bytes, metadata);
      assert.equal(release.created, true);
      const stored = db.raw.prepare("SELECT raw_values_json, upstream_row_ref FROM source_records WHERE release_id = ? ORDER BY ordinal")
        .all(release.releaseId) as { raw_values_json: string; upstream_row_ref: null }[];
      assert.deepEqual(stored.map(row => JSON.parse(JSON.parse(row.raw_values_json)[0])), input.rows);
      assert.ok(stored.every(row => row.upstream_row_ref === null));
      stagedRows += stored.length;
      assert.deepEqual(await ingestRelease(db, adapter, input.bytes, metadata), { releaseId: release.releaseId, created: false });
      await assert.rejects(resolveFirstRelease(db, adapter, release.releaseId, { now: NOW }), /requires rights and location review/);
      assert.equal(db.raw.prepare("SELECT count(*) AS n FROM source_observations WHERE record_id IN (SELECT record_id FROM source_records WHERE release_id = ?)")
        .get(release.releaseId)?.n, 0);
      assert.equal(db.raw.prepare("SELECT publication_status FROM sources WHERE source_id = ?").get(input.sourceId)?.publication_status, "blocked");
    }
    assert.equal(stagedRows, 4);
    await publishTiles(db, { now: NOW });
    assert.deepEqual(publishedState(), before, "existing spot IDs, tile revisions, hashes, parts and membership stay identical");
  } finally { db.raw.close(); }
});
