// TEST ONLY fixtures for ADR-0017 (approximate area locations). A municipal/operator list that states some smoking
// places only by the area they are inside, and states the area's own point in a row of the same file. Not in
// SOURCE_ADAPTERS; it never reaches production code paths.
import { sha256Hex } from "../../src/db.ts";
import {
  AREA_ANCHOR_POLICY_VERSION, type AreaApproximateCandidate, type ReviewedAreaAnchor, anchoredObservation, evaluateAreaApproximate,
  recordAreaAnchor,
} from "../../src/pipeline/area-anchor.ts";
import { parseCsv } from "../../src/pipeline/csv.ts";
import { applyAreaPrecisionUpgrade } from "../../src/pipeline/area-anchor.ts";
import { applyReviewedRelocation } from "../../src/pipeline/relocation-application.ts";
import { holdRelocationCandidate } from "../../src/pipeline/relocation-hold.ts";
import { ingestRelease, type ReleaseMetadata } from "../../src/pipeline/ingest.ts";
import { resolveFirstRelease } from "../../src/pipeline/resolve.ts";
import { recordReviewDecision } from "../../src/pipeline/review-queue.ts";
import type { SourceAdapter, SourceObservation } from "../../src/pipeline/source-adapter.ts";
import { NOW, sequentialSpotIds } from "./fixture.ts";
import { SqliteD1 } from "./sqlite-d1.ts";

export const PARK = { anchorId: "aa_ueno", areaName: "上野恩賜公園", latitude: 35.7155, longitude: 139.7733 } as const;
export const MOVED = { latitude: 35.715, longitude: 139.774 } as const;
export const MOVED_C = { latitude: 35.7148, longitude: 139.7745 } as const;
export const MOVED_D = { latitude: 35.7146, longitude: 139.775 } as const;
// seats/capacity: other numeric cells of the same rows (the park row states 36 seats, capacity 140) that are NOT its
// point; the reviewed area-point mapping reads lat/lon only (F4).
const HEADER = "id,name,area,lat,lon,statement,seats,capacity";
// statement: "smoking" = the publisher states a smoking place (inside `area` when lat/lon are empty); "area" = the
// row states an area's own point (an anchor origin, never a spot); "" = a place/host only; "closed" = closed.
export const ROWS = {
  park: `P1,${PARK.areaName},,${PARK.latitude},${PARK.longitude},area`,
  anchored: `1,公園内喫煙所,${PARK.areaName},,,smoking`,
  exact: "2,駅前喫煙所,,35.71,139.77,smoking",
  host: "3,上野駅,,35.7138,139.7773,",
  noAnchor: "4,不明公園喫煙所,不明公園,,,smoking",
  closed: `5,閉鎖喫煙所,${PARK.areaName},,,closed`,
  // The same place in a later release, now with its own point: at the anchor's coordinate, or elsewhere in the park.
  exactAtAnchor: `1,公園内喫煙所,,${PARK.latitude},${PARK.longitude},smoking`,
  exactMoved: `1,公園内喫煙所,,${MOVED.latitude},${MOVED.longitude},smoking`,
  // Later reviewed ADR-0009 relocations of the place after it became exact (C, then D).
  exactMovedC: `1,公園内喫煙所,,${MOVED_C.latitude},${MOVED_C.longitude},smoking`,
  exactMovedD: `1,公園内喫煙所,,${MOVED_D.latitude},${MOVED_D.longitude},smoking`,
  // The same place as exactMovedD with a different seats cell: not raw-identical, identical observation (a reviewed match).
  exactMovedDSeats: `1,公園内喫煙所,,${MOVED_D.latitude},${MOVED_D.longitude},smoking`,
  // ANOTHER place, first listed later, at exactly the current point of the park spot (raw values of a different spot).
  impostorAtD: `7,別の喫煙所,,${MOVED_D.latitude},${MOVED_D.longitude},smoking`,
  // A place first listed in a later release, inside the same park.
  newInPark: `6,公園内第二喫煙所,${PARK.areaName},,,smoking`,
} as const;
export const RELEASE_A = ["park", "anchored", "exact", "host", "noAnchor", "closed"] as const;
const EXTRA: Partial<Record<keyof typeof ROWS, string>> = { park: ",36,140", exactMovedDSeats: ",1," };
export const csv = (rows: readonly (keyof typeof ROWS)[]) => new TextEncoder().encode([HEADER, ...rows.map((r) => ROWS[r] + (EXTRA[r] ?? ",,"))].join("\n"));
export const meta = (observedOn: string): ReleaseMetadata => ({ sourceUrl: "https://example.invalid/list.csv", observedOn, fetchedAt: NOW, httpLastModified: null });

export function areaAdapter(sourceId: string, kind: "municipal" | "operator" = "municipal", anchors = [PARK]): SourceAdapter {
  const byArea = new Map(anchors.map((a) => [a.areaName as string, a]));
  const candidate = (v: readonly string[]): AreaApproximateCandidate => ({
    sourcePublication: "approved",
    existenceEvidence: v[5] === "smoking" || v[5] === "closed" ? "smokingPlaceStated" : v[5] === "area" ? "none" : "hostOnly",
    conflict: v[5] === "closed" ? "closed" : "none",
    exactPoint: v[3] !== "" && v[4] !== "" ? "present" : "absent",
    area: v[2] === "" ? "notNamed" : "named",
    anchor: byArea.has(v[2]) ? "reviewed" : "missing",
  });
  return {
    registry: { sourceId, displayName: `TEST ${sourceId}`, kind, licenseName: "CC BY 4.0", licenseUrl: "https://example.invalid/l", attributionText: `© ${sourceId}`, publicationStatus: "approved" },
    parserVersion: "test-area.parse.v1", resolverVersion: "test-area.resolve.v1", mappingVersion: "test-area.map.v1",
    parse: (bytes) => parseCsv(new TextDecoder().decode(bytes)),
    upstreamRowRef: (v) => v[0],
    assertResolvable: () => {},
    // The gate decides scope: a host-only, area, closed or un-anchorable row stays raw evidence and creates no spot.
    includesRecord: (v) => evaluateAreaApproximate(candidate(v)).verdict !== "rejected",
    areaPoint: (v) => v[5] === "area" ? { areaName: v[1], latitude: Number(v[3]), longitude: Number(v[4]) } : null,
    areaPointColumns: { name: "name", latitude: "lat", longitude: "lon", reviewedBy: "maintainer", reviewedOn: "2026-10-02" },
    observe(v): SourceObservation {
      const base = {
        name: v[1], supportsPaper: "unknown" as const, supportsHeated: "unknown" as const,
        openingHours: { status: "none" as const, raw: null, parsed: null }, lifecycle: "active" as const,
        provenance: [{ field: "existence", columns: ["name", "statement"], rule: "test.listed.v1" }],
      };
      if (evaluateAreaApproximate(candidate(v)).verdict === "exactPoint") {
        return { ...base, latitude: Number(v[3]), longitude: Number(v[4]), provenance: [...base.provenance, { field: "location", columns: ["lat", "lon"], rule: "test.point.v1" }] };
      }
      return anchoredObservation(base, byArea.get(v[2])!, ["area"]);
    },
    attenuate: () => [],
    attenuationReference: { attestationVersion: "none", referenceKind: "none", referenceUrl: "https://example.invalid", checkedAt: NOW },
    crossReleaseValidated: true,
  };
}

export function addSource(db: SqliteD1, adapter: SourceAdapter) {
  const r = adapter.registry;
  db.raw.prepare(
    `INSERT INTO sources (source_id, display_name, kind, license_name, license_url, attribution_text, publication_status, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, 'approved', ?, ?)`,
  ).run(r.sourceId, r.displayName, r.kind, r.licenseName, r.licenseUrl, r.attributionText, NOW, NOW);
}

export const anchorDef = (sourceId: string, releaseSha: string, overrides: Partial<ReviewedAreaAnchor> = {}): ReviewedAreaAnchor => ({
  ...PARK, areaKind: "park", originKind: "publisherAreaPoint", originSourceId: sourceId,
  originReleaseContentSha256: releaseSha, originUpstreamRowRef: "P1", originReference: "list.csv#P1",
  reuseBasis: "sameReviewedPublication", policyVersion: AREA_ANCHOR_POLICY_VERSION, reviewedBy: "maintainer", reviewedOn: "2026-10-02",
  ...overrides,
});

export const releaseSha = async (rows: readonly (keyof typeof ROWS)[]) => sha256Hex(csv(rows));

/** Release A ingested, its anchor recorded from row P1 of release A, and resolved. */
export async function areaPipeline(opts: { kind?: "municipal" | "operator"; recordAnchor?: boolean; resolve?: boolean; db?: SqliteD1 } = {}) {
  const db = opts.db ?? new SqliteD1();
  const sourceId = opts.kind === "operator" ? "test-area-operator" : "test-area-city";
  const adapter = areaAdapter(sourceId, opts.kind ?? "municipal");
  addSource(db, adapter);
  const { releaseId } = await ingestRelease(db, adapter, csv(RELEASE_A), meta("2026-09-30"));
  const anchor = anchorDef(sourceId, await releaseSha(RELEASE_A));
  if (opts.recordAnchor !== false) await recordAreaAnchor(db, adapter, anchor, NOW);
  const resolve = () => resolveFirstRelease(db, adapter, releaseId, { now: NOW, newSpotId: sequentialSpotIds("A") });
  if (opts.resolve !== false && opts.recordAnchor !== false) await resolve();
  return { db, adapter, sourceId, anchor, releaseId, resolve };
}

export const spotByName = (db: SqliteD1, name: string) =>
  (db.raw.prepare("SELECT * FROM spots WHERE name = ? AND merged_into IS NULL").get(name) as Record<string, any>);

/** A later release of the same source; resolves it once and returns the identity item it raises, if any. */
export async function nextRelease(db: SqliteD1, adapter: SourceAdapter, rows: readonly (keyof typeof ROWS)[], observedOn: string, now = "2026-10-11T00:00:00Z") {
  const { releaseId } = await ingestRelease(db, adapter, csv(rows), meta(observedOn));
  const resolve = (at = now) => resolveFirstRelease(db, adapter, releaseId, { now: at, newSpotId: sequentialSpotIds("B") });
  const first = await resolve();
  return { releaseId, first, resolve };
}

export async function decideIdentity(db: SqliteD1, itemId: number, spotId: string, at = "2026-10-11T01:00:00Z") {
  const entity = (db.raw.prepare("SELECT source_entity_id FROM spot_source_entities WHERE spot_id = ?").get(spotId) as { source_entity_id: number }).source_entity_id;
  return recordReviewDecision(db, { reviewItemId: itemId, decision: "matchedToEntity", sourceEntityId: entity, decidedBy: "reviewer", decidedAt: at });
}

/**
 * A approximate -> B same-coordinate exact upgrade -> C reviewed ADR-0009 relocation -> D another relocation, with an
 * unchanged re-listing (a continuation) after D. Each later release is resolved to `resolved`. Returns the spot id.
 */
export async function exactChain(db: SqliteD1, adapter: SourceAdapter, until: "B" | "C" | "D" | "E" = "E"): Promise<string> {
  const spotId = spotByName(db, "公園内喫煙所").spot_id as string;
  const b = await nextRelease(db, adapter, ["exactAtAnchor", "exact"], "2026-10-10");
  const bItem = (b.first as { reviewItemIds: number[] }).reviewItemIds[0];
  await decideIdentity(db, bItem, spotId);
  const evidence = (db.raw.prepare("SELECT record_id FROM source_records WHERE release_id = ? AND upstream_row_ref = '1'").get(b.releaseId) as { record_id: number }).record_id;
  await applyAreaPrecisionUpgrade(db, adapter, { spotId, evidenceRecordId: evidence, identityReviewItemId: bItem, targetPrecision: "publisherPoint",
    areaPremise: "insideArea", reviewedBy: "reviewer", now: "2026-10-12T00:00:00Z" });
  await b.resolve("2026-10-13T00:00:00Z");
  if (until === "B") return spotId;
  const relocate = async (row: "exactMovedC" | "exactMovedD", observedOn: string, day: number) => {
    const at = (h: number) => `2026-10-${String(day).padStart(2, "0")}T${String(h).padStart(2, "0")}:00:00Z`;
    const r = await nextRelease(db, adapter, [row, "exact"], observedOn, at(0));
    await decideIdentity(db, (r.first as { reviewItemIds: number[] }).reviewItemIds[0], spotId, at(1));
    const second = await r.resolve(at(2));
    const itemId = (second as { reviewItemIds: number[] }).reviewItemIds[0];
    await holdRelocationCandidate(db, adapter, itemId, { now: at(3) });
    await recordReviewDecision(db, { reviewItemId: itemId, decision: "relocationConfirmed", decidedBy: "reviewer", decidedAt: at(4) });
    await applyReviewedRelocation(db, adapter, itemId, { now: at(5) });
    const done = await r.resolve(at(6));
    if (done.status !== "resolved") throw new Error(`exactChain ${row}: ${JSON.stringify(done)}`);
  };
  await relocate("exactMovedC", "2026-10-14", 15);
  if (until === "C") return spotId;
  await relocate("exactMovedD", "2026-10-16", 17);
  if (until === "D") return spotId;
  const e = await nextRelease(db, adapter, ["exactMovedD", "exact"], "2026-10-18", "2026-10-19T00:00:00Z");
  if (e.first.status !== "resolved") throw new Error(`exactChain continuation: ${JSON.stringify(e.first)}`);
  return spotId;
}
