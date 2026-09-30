// Promotion bundle (docs/OPERATIONS.md): the deterministic, reviewable artifact that carries one
// validated *local* release's published state to another database.
//
// It is a BOOTSTRAP artifact: INSERT-only, for an empty, freshly migrated target database. It cannot
// update a populated one, and this slice deliberately adds no upsert path — corrected data ships by
// promoting a new database and switching the Worker's binding (the blue/green procedure in
// docs/OPERATIONS.md). Its first statement (promotion_bootstraps, migration 0016) is refused by any
// database that is not empty, and its last (promotion_bootstrap_completions) re-checks on the receiving
// side that exactly the declared release arrived. It carries no BEGIN/COMMIT: D1 runs a `--file` import
// as one transaction and refuses one inside it, so the apply is all or nothing there.
//
// A reviewed identity decision travels as an attestation (promotion_review_match_attestations, 0016), not
// as the runtime review chain: the bundle bootstraps the finished, applied state of one release and does
// not replay the pipeline moment (previous release current, this one `ingested`) that the chain's triggers
// check. Holds, relocation and removal audits stay in the origin database: nothing the bundle carries
// claims them (Issue #100).
//
// It is a pure read of a local database plus a text serialisation. Nothing here opens a connection,
// and nothing here applies anything: the caller writes a file, a human reads it, and a human runs
// `wrangler d1 execute ... --remote --file`. That split is the point — the repository never grows a
// code path that can write to a remote database.
//
// Three properties make the artifact reviewable:
//   1. Deterministic. Fixed table order, fixed column order, fixed row order, fixed literal
//      formatting. The same database produces byte-identical output, so two bundles can be diffed.
//   2. Complete for the selected release. Evidence (release, records, match keys), identity
//      (entities, decisions), canonical spots with field provenance, and the published tile
//      snapshots — in foreign-key-safe order, so the publication trigger re-checks every published
//      spot on the receiving side rather than trusting this file.
//   3. Validated, or nothing. Every check below fails the export; a partial or unapproved bundle is
//      never emitted.
//
// Deliberately absent: the report tables (user-submitted content and hashed submitter keys never
// leave a database through this path, ADR-0007), and `d1_migrations` (the receiver runs the real
// migrations first).

import { type Db, sha256Hex } from "../db.ts";
import { TileBodyV1 } from "../tiles/dto.ts";
import { type CandidateRow, spotDto } from "../tiles/publish.ts";
import { type ReviewedTerms, reviewedTerms } from "../reports/terms.ts";
import { type ReviewedSource, reviewedSource } from "./registry.ts";

/** v2 (Issue #100): bootstrap/completion statements and review-match attestations; needs migration 0016. */
export const PROMOTION_BUNDLE_VERSION = "promotion-bundle.v2";
/** v3: several sources' current releases in one all-or-nothing bootstrap; needs migration 0018. v2 is unchanged. */
export const MULTI_SOURCE_PROMOTION_BUNDLE_VERSION = "promotion-bundle.v3";

export interface PromotionManifest {
  generator: string;
  releaseId: number;
  sourceId: string;
  observedOn: string | null;
  releaseContentSha256: string;
  tiles: { tileId: string; revision: number; spotCount: number; contentSha256: string }[];
  rows: Record<string, number>;
  /** sha256 of the statement block, so a reviewed bundle can be identified by one value. */
  contentSha256: string;
}

export interface PromotionBundle {
  sql: string;
  manifest: PromotionManifest;
}

export class PromotionError extends Error {}

/** The first line of the hashed body. The header ends right before it, so exporter and verifier cut at the same byte. */
const BUNDLE_BODY_FIRST_LINE = "-- promotion_bootstraps: refused unless the target is empty";
const MULTI_SOURCE_BUNDLE_BODY_FIRST_LINE = "-- promotion_multi_bootstraps: refused unless the target is empty";
const CONTENT_SHA256 = /^[0-9a-f]{64}$/;

function fail(detail: string): never {
  throw new PromotionError(`promotion export refused: ${detail}`);
}

/**
 * SQLite literal. Numbers keep their shortest round-trip form, strings are single-quoted with
 * doubled quotes. A carriage return or NUL is refused rather than escaped: this artifact is read by
 * a human and split on semicolons by the applying tool, so an invisible control character in it is
 * a hazard, not a value worth preserving.
 */
function literal(value: unknown): string {
  if (value === null || value === undefined) return "NULL";
  if (typeof value === "number") {
    if (!Number.isFinite(value)) fail(`non-finite numeric value ${value}`);
    return Number.isInteger(value) ? String(value) : JSON.stringify(value);
  }
  if (typeof value === "string") {
    if (/[\r\0]/.test(value)) fail("a value contains a carriage return or NUL byte");
    return `'${value.replaceAll("'", "''")}'`;
  }
  fail(`unsupported value type ${typeof value}`);
}

/**
 * The tables the bundle carries, in foreign-key-safe order, each with its explicit column list and
 * a deterministic ORDER BY. `sql` takes the release id as its only parameter, bound to every `?`. Adding a table here
 * is a deliberate decision about what may leave a database.
 */
interface TableSpec {
  table: string;
  columns: string[];
  sql: string;
}

// The spots a bundle carries: the published ones, plus every spot an applied cross-source merge involves (its
// survivor, even when held, its loser, and the redirects repointed to the survivor) so the target reproduces the
// merge, the redirects and the retained evidence (Issue #107). Without merges this is exactly the published set.
const PUBLISHED_SPOTS = `SELECT spot_id FROM tile_snapshot_spots
  UNION SELECT survivor_spot_id FROM cross_source_merges UNION SELECT loser_spot_id FROM cross_source_merges
  UNION SELECT spot_id FROM spots WHERE merged_into IN (SELECT survivor_spot_id FROM cross_source_merges)`;
const RELEASE_SOURCE = "SELECT source_id FROM source_releases WHERE release_id = ?";

const TABLES: readonly TableSpec[] = [
  {
    table: "sources",
    columns: ["source_id", "display_name", "kind", "license_name", "license_url", "attribution_text", "publication_status", "created_at", "updated_at"],
    sql: `SELECT * FROM sources WHERE source_id = (${RELEASE_SOURCE}) ORDER BY source_id`,
  },
  {
    table: "source_releases",
    columns: ["release_id", "source_id", "observed_on", "fetched_at", "source_url", "http_last_modified", "content_sha256", "byte_length", "header_json", "record_count", "parser_version", "status", "is_current", "applied_at"],
    sql: "SELECT * FROM source_releases WHERE release_id = ? ORDER BY release_id",
  },
  {
    table: "source_records",
    columns: ["record_id", "release_id", "ordinal", "upstream_row_ref", "raw_values_json", "raw_sha256"],
    sql: "SELECT * FROM source_records WHERE release_id = ? ORDER BY record_id",
  },
  {
    table: "source_record_match_keys",
    columns: ["record_id", "key_version", "match_key", "derived_at"],
    sql: `SELECT k.* FROM source_record_match_keys k JOIN source_records r ON r.record_id = k.record_id
          WHERE r.release_id = ? ORDER BY k.record_id, k.key_version`,
  },
  {
    table: "source_entities",
    columns: ["source_entity_id", "source_id", "created_at"],
    sql: `SELECT * FROM source_entities WHERE source_id = (${RELEASE_SOURCE}) ORDER BY source_entity_id`,
  },
  {
    // One row per reviewed ambiguousMatch decision applied to a record of the release (matchedToEntity and
    // confirmedNew): read from the runtime chain here, or from the attestations of a database that was itself
    // bootstrapped, so a re-export is identical. Before source_record_entities: a manual link needs its row.
    table: "promotion_review_match_attestations",
    columns: ["record_id", "release_id", "decision", "source_entity_id", "origin_review_item_id", "origin_review_decision_id",
      "origin_review_match_application_id", "previous_release_id", "previous_release_content_sha256", "matcher_version",
      "candidate_entity_ids_json", "decision_version", "decided_by", "decided_at", "decision_note", "executor_version", "applied_at"],
    sql: `SELECT a.record_id, a.release_id, a.decision, a.source_entity_id, a.review_item_id AS origin_review_item_id,
            a.review_decision_id AS origin_review_decision_id, a.review_match_application_id AS origin_review_match_application_id,
            i.previous_release_id, p.content_sha256 AS previous_release_content_sha256, i.matcher_version,
            json_extract(i.details_json, '$.candidateEntityIds') AS candidate_entity_ids_json, d.decision_version, d.decided_by,
            d.decided_at, d.note AS decision_note, a.executor_version, a.applied_at
          FROM review_match_applications a
          JOIN review_items i ON i.review_item_id = a.review_item_id
          JOIN review_decisions d ON d.review_decision_id = a.review_decision_id
          JOIN source_releases p ON p.release_id = i.previous_release_id
          WHERE a.release_id = ?
          UNION ALL
          SELECT record_id, release_id, decision, source_entity_id, origin_review_item_id, origin_review_decision_id,
            origin_review_match_application_id, previous_release_id, previous_release_content_sha256, matcher_version,
            candidate_entity_ids_json, decision_version, decided_by, decided_at, decision_note, executor_version, applied_at
          FROM promotion_review_match_attestations WHERE release_id = ?
          ORDER BY record_id`,
  },
  {
    table: "source_record_entities",
    columns: ["record_id", "release_id", "source_entity_id", "method", "matcher_version", "decided_at", "note"],
    sql: "SELECT * FROM source_record_entities WHERE release_id = ? ORDER BY record_id",
  },
  {
    table: "spots",
    columns: ["spot_id", "merged_into", "name", "latitude", "longitude", "tile_z", "tile_x", "tile_y", "tile_id", "spot_type", "host_type", "access_type", "environment", "supports_paper", "supports_heated", "opening_hours_raw", "opening_hours_json", "opening_hours_status", "time_zone", "fee_type", "floor", "entrance_note", "lifecycle", "publication_hold", "evidence_quality", "evidence_quality_version", "last_verified_at", "resolver_version", "created_at", "updated_at", "spot_subtype", "access_detail", "community_confirmations", "last_reviewed_on"],
    // Live spots first, so a redirect's target exists when the redirect is inserted (spots.merged_into is a foreign
    // key). Without merges every merged_into is NULL and this is exactly ORDER BY spot_id.
    sql: `SELECT * FROM spots WHERE spot_id IN (${PUBLISHED_SPOTS}) ORDER BY merged_into IS NOT NULL, spot_id`,
  },
  {
    table: "spot_source_entities",
    columns: ["source_entity_id", "spot_id", "method", "linked_at", "resolver_version"],
    sql: `SELECT * FROM spot_source_entities WHERE spot_id IN (${PUBLISHED_SPOTS}) ORDER BY source_entity_id`,
  },
  {
    table: "spot_field_provenance",
    columns: ["spot_id", "field", "record_id", "source_columns_json", "rule", "resolver_version", "resolved_at"],
    sql: `SELECT * FROM spot_field_provenance WHERE spot_id IN (${PUBLISHED_SPOTS}) ORDER BY spot_id, field`,
  },
  {
    // The Issue #42 attenuations behind a published spot's weakened fields. Without them the
    // receiving database would hold the weakened value with no recorded evidence for it, and
    // GET /spots/{id} there would publish the attenuated field's CSV provenance as if it were the
    // evidence — exactly the misleading output the attenuation model exists to prevent.
    table: "spot_field_attenuations",
    columns: ["spot_id", "field", "effect", "attestation_version", "reference_kind", "reference_url", "checked_at", "release_id", "release_content_sha256", "release_observed_on", "release_source_url", "resolver_version", "applied_at"],
    sql: `SELECT * FROM spot_field_attenuations WHERE spot_id IN (${PUBLISHED_SPOTS}) ORDER BY spot_id, field, effect`,
  },
  {
    table: "tile_snapshots",
    columns: ["tile_id", "z", "x", "y", "revision", "schema_version", "content_sha256", "spot_count", "body_json", "published_at"],
    sql: "SELECT * FROM tile_snapshots ORDER BY tile_id",
  },
  {
    table: "tile_snapshot_spots",
    columns: ["spot_id", "tile_id"],
    sql: "SELECT * FROM tile_snapshot_spots ORDER BY spot_id",
  },
];

/**
 * v3 only (migration 0019): one attestation per applied cross-source merge, read from the runtime chain or, in a
 * database that was itself bootstrapped, from its attestations, so a re-export is identical. Inserted after the
 * declared sources' rows and before any spot: a redirect needs the attestation it follows.
 */
const CROSS_SOURCE_ATTESTATIONS: TableSpec = {
  table: "promotion_cross_source_merge_attestations",
  columns: ["loser_spot_id", "survivor_spot_id", "survivor_source_id", "loser_source_id", "origin_candidate_id",
    "origin_decision_id", "origin_application_id", "algorithm_version", "distance_m", "reasons_json", "decision_version",
    "decided_by", "decided_at", "identity_evidence", "decision_note", "redirected_spot_ids_json", "conflicts_json",
    "conflict_hold", "executor_version", "applied_at"],
  sql: `SELECT a.loser_spot_id, a.survivor_spot_id,
          CASE WHEN c.spot_a_id = a.survivor_spot_id THEN c.source_a_id ELSE c.source_b_id END AS survivor_source_id,
          CASE WHEN c.spot_a_id = a.loser_spot_id THEN c.source_a_id ELSE c.source_b_id END AS loser_source_id,
          c.cross_source_candidate_id AS origin_candidate_id, d.cross_source_decision_id AS origin_decision_id,
          a.cross_source_merge_application_id AS origin_application_id, c.algorithm_version, c.distance_m, c.reasons_json,
          d.decision_version, d.decided_by, d.decided_at, d.identity_evidence, d.note AS decision_note,
          a.redirected_spot_ids_json, a.conflicts_json, a.conflict_hold, a.executor_version, a.applied_at
        FROM cross_source_merge_applications a
        JOIN cross_source_candidates c ON c.cross_source_candidate_id = a.cross_source_candidate_id
        JOIN cross_source_decisions d ON d.cross_source_decision_id = a.cross_source_decision_id
        UNION ALL
        SELECT loser_spot_id, survivor_spot_id, survivor_source_id, loser_source_id, origin_candidate_id, origin_decision_id,
          origin_application_id, algorithm_version, distance_m, reasons_json, decision_version, decided_by, decided_at,
          identity_evidence, decision_note, redirected_spot_ids_json, conflicts_json, conflict_hold, executor_version, applied_at
        FROM promotion_cross_source_merge_attestations
        ORDER BY loser_spot_id`,
};

/** v3's carried tables: v2's, with the cross-source attestations right before the spots. */
const MULTI_SOURCE_TABLES: readonly TableSpec[] = TABLES.flatMap((t) => (t.table === "spots" ? [CROSS_SOURCE_ATTESTATIONS, t] : [t]));

type Row = Record<string, unknown>;

async function rowsOf(db: Db, spec: TableSpec, releaseId: number | undefined): Promise<Row[]> {
  // Two specs carry no parameter (the published tiles are whole-database state), and binding a
  // value to a statement that has no placeholder is an error; the attestation spec has two.
  const placeholders = spec.sql.split("?").length - 1;
  const statement = db.prepare(spec.sql);
  const { results } = await (placeholders === 0 ? statement : statement.bind(...Array(placeholders).fill(releaseId))).all<Row>();
  // A column added by a later migration must be added to the spec deliberately; silently dropping
  // it would produce a bundle that looks complete and is not.
  for (const row of results) {
    const actual = Object.keys(row).sort().join(",");
    const declared = [...spec.columns].sort().join(",");
    if (actual !== declared) fail(`${spec.table}: columns ${actual} do not match the exported column list ${declared}`);
  }
  return results;
}

/** The release to export when the caller did not name one: the single current applied release. */
export async function currentReleaseId(db: Db): Promise<number> {
  const { results } = await db.prepare(
    "SELECT release_id FROM source_releases WHERE is_current = 1 ORDER BY release_id",
  ).all<{ release_id: number }>();
  if (results.length === 1) return results[0].release_id;
  if (results.length === 0) fail("no current applied release exists in this database; run the pipeline first");
  fail(`${results.length} current releases exist; name one with --release <id>`);
}

/**
 * The reviewed lists the exporter checks. Only tests pass anything but the defaults, to simulate a future approval
 * of the community source or its terms (Issue #124); no script does.
 */
export interface PromotionRegistry {
  source: (sourceId: string) => ReviewedSource;
  terms: (version: string) => ReviewedTerms;
}

const REVIEWED_REGISTRY: PromotionRegistry = { source: reviewedSource, terms: reviewedTerms };

async function validateRelease(
  db: Db, releaseId: number, sources: Row[], release: Row | undefined, registry: PromotionRegistry = REVIEWED_REGISTRY,
): Promise<void> {
  if (release === undefined) fail(`release ${releaseId} does not exist`);
  if (release.status !== "applied") fail(`release ${releaseId} has status ${String(release.status)}, not applied`);
  if (sources.length !== 1) fail(`release ${releaseId} resolved ${sources.length} source rows`);
  const source = sources[0];
  // The receiving database holds this one release, so it must be its source's current one there as well. An
  // additive (userReport) source has no current release: every applied release is live evidence (0020, 0021).
  if (source.kind === "userReport" ? release.is_current !== 0 : release.is_current !== 1) {
    fail(`release ${releaseId} is not its source's current release`);
  }

  // The publication gate, checked against the reviewed registry in code — not just against the
  // row's own status column, which a local database could hold in any state (ADR-0006).
  let reviewed;
  try {
    reviewed = registry.source(String(source.source_id));
  } catch (e) {
    fail(e instanceof Error ? e.message : String(e));
  }
  if (source.publication_status !== "approved") {
    fail(`source ${String(source.source_id)} is ${String(source.publication_status)}; only an approved source may be promoted`);
  }
  if (reviewed.publicationStatus !== "approved") {
    fail(`source ${String(source.source_id)} is not approved in REVIEWED_SOURCES`);
  }
  for (const [column, expected] of [
    ["display_name", reviewed.displayName],
    ["license_name", reviewed.licenseName],
    ["license_url", reviewed.licenseUrl],
    ["attribution_text", reviewed.attributionText],
  ] as const) {
    if (source[column] !== expected) {
      fail(`source ${String(source.source_id)}.${column} does not match the reviewed registry entry; run local:registry and republish`);
    }
  }
  if (source.attribution_text === null) fail(`source ${String(source.source_id)} has no attribution text`);
}

async function validatePublishedState(db: Db, releaseIds: readonly number[], rows: Map<string, Row[]>): Promise<void> {
  const tiles = rows.get("tile_snapshots") ?? [];
  const members = rows.get("tile_snapshot_spots") ?? [];
  const spots = rows.get("spots") ?? [];
  if (tiles.length === 0) fail("no tile snapshot has been published in this database");

  // Every published spot must still satisfy the publication invariant, and must be explained by the
  // release being exported: promoting a tile whose evidence lives in a release this bundle does not
  // carry would leave the receiving database inconsistent.
  const spotById = new Map(spots.map((s) => [String(s.spot_id), s]));
  for (const member of members) {
    const spot = spotById.get(String(member.spot_id));
    if (spot === undefined) fail(`published spot ${String(member.spot_id)} has no canonical row`);
    if (spot.merged_into !== null) fail(`published spot ${String(spot.spot_id)} is merged`);
    if (spot.lifecycle !== "active") fail(`published spot ${String(spot.spot_id)} is ${String(spot.lifecycle)}`);
    if (spot.publication_hold !== null) fail(`published spot ${String(spot.spot_id)} is held: ${String(spot.publication_hold)}`);
    if (spot.tile_id !== member.tile_id) fail(`published spot ${String(spot.spot_id)} is not in tile ${String(member.tile_id)}`);
  }

  const outside = await db.prepare(
    `SELECT s.spot_id FROM tile_snapshot_spots s
     JOIN spot_field_provenance p ON p.spot_id = s.spot_id AND p.field = 'existence'
     JOIN source_records r ON r.record_id = p.record_id
     WHERE r.release_id NOT IN (${releaseIds.map(() => "?").join(", ")}) ORDER BY s.spot_id`,
  ).bind(...releaseIds).all<{ spot_id: string }>();
  if (outside.results.length > 0) {
    fail(`${outside.results.length} published spot(s) draw existence evidence from another release (first: ${outside.results[0].spot_id}); export that release instead, or republish`);
  }

  // Provenance must not reference evidence the bundle leaves behind.
  const carried = new Set((rows.get("source_records") ?? []).map((r) => Number(r.record_id)));
  for (const p of rows.get("spot_field_provenance") ?? []) {
    if (!carried.has(Number(p.record_id))) {
      fail(`provenance for ${String(p.spot_id)}.${String(p.field)} references a record outside release ${releaseIds.join(", ")}`);
    }
  }
  const entities = new Set((rows.get("source_entities") ?? []).map((e) => Number(e.source_entity_id)));
  for (const link of rows.get("spot_source_entities") ?? []) {
    if (!entities.has(Number(link.source_entity_id))) {
      fail(`spot ${String(link.spot_id)} links a source entity outside the exported source`);
    }
  }
  validateSourceBoundaries(rows);
}

/**
 * Identity separation: a spot's field evidence and attenuations must come from a release of a source the spot is
 * linked to through that source's own entity. With one source this always holds; with several (v3) it is what
 * stops one source's record from standing behind another source's spot. The v3 target re-checks both.
 */
function validateSourceBoundaries(rows: Map<string, Row[]>): void {
  const releaseSource = new Map((rows.get("source_releases") ?? []).map((r) => [Number(r.release_id), String(r.source_id)]));
  const releaseHash = new Map((rows.get("source_releases") ?? []).map((r) => [Number(r.release_id), String(r.content_sha256)]));
  const recordSource = new Map((rows.get("source_records") ?? []).map((r) => [Number(r.record_id), releaseSource.get(Number(r.release_id))]));
  const entitySource = new Map((rows.get("source_entities") ?? []).map((e) => [Number(e.source_entity_id), String(e.source_id)]));
  const spotSources = new Map<string, Set<string>>();
  for (const link of rows.get("spot_source_entities") ?? []) {
    const sources = spotSources.get(String(link.spot_id)) ?? new Set<string>();
    sources.add(String(entitySource.get(Number(link.source_entity_id))));
    spotSources.set(String(link.spot_id), sources);
  }
  for (const p of rows.get("spot_field_provenance") ?? []) {
    const source = recordSource.get(Number(p.record_id));
    if (source === undefined || !spotSources.get(String(p.spot_id))?.has(source)) {
      fail(`provenance for ${String(p.spot_id)}.${String(p.field)} crosses a source boundary: record ${String(p.record_id)} is not of a source linked to the spot`);
    }
  }
  for (const a of rows.get("spot_field_attenuations") ?? []) {
    const source = releaseSource.get(Number(a.release_id));
    if (source === undefined || releaseHash.get(Number(a.release_id)) !== a.release_content_sha256 || !spotSources.get(String(a.spot_id))?.has(source)) {
      fail(`attenuation ${String(a.spot_id)}.${String(a.field)} cites release ${String(a.release_id)}, which is not a carried release of a source linked to the spot`);
    }
  }
}

/**
 * Every reviewed link has the attestation of the decision it follows, and every attestation is followed by
 * its record's decision: the receiving schema enforces the first and the completion check the second, so a
 * gap here would only move the failure to a remote apply.
 */
function validateReviewAttestations(rows: Map<string, Row[]>): void {
  const attestations = new Map((rows.get("promotion_review_match_attestations") ?? []).map((a) => [Number(a.record_id), a]));
  const decisions = new Map((rows.get("source_record_entities") ?? []).map((e) => [Number(e.record_id), e]));
  for (const [recordId, e] of decisions) {
    if (e.method === "manual" && attestations.get(recordId)?.decision !== "matchedToEntity") {
      fail(`record ${recordId} of release ${String(e.release_id)} is a reviewed (manual) link without its applied matchedToEntity decision`);
    }
  }
  for (const [recordId, a] of attestations) {
    const e = decisions.get(recordId);
    const follows = a.decision === "matchedToEntity"
      ? e?.method === "manual" && e.source_entity_id === a.source_entity_id
      : e?.method === "new";
    if (!follows) fail(`record ${recordId}: its decision does not follow the applied ${String(a.decision)} review decision`);
  }
}

/**
 * Every merge the bundle attests is between two carried sources, both its spots travel, and every carried redirect
 * is one an attested merge made. The target re-checks the same (0019); a gap here would only move the failure there.
 */
function validateCrossSourceMerges(rows: Map<string, Row[]>): void {
  const carriedSources = new Set((rows.get("sources") ?? []).map((s) => String(s.source_id)));
  const spots = new Map((rows.get("spots") ?? []).map((s) => [String(s.spot_id), s]));
  const attestations = rows.get("promotion_cross_source_merge_attestations") ?? [];
  for (const a of attestations) {
    for (const source of [a.survivor_source_id, a.loser_source_id]) {
      if (!carriedSources.has(String(source))) fail(`cross-source merge of ${String(a.loser_spot_id)} involves source ${String(source)}, which this bundle does not carry; export every source a merge involves`);
    }
    if (!spots.has(String(a.survivor_spot_id)) || !spots.has(String(a.loser_spot_id))) fail(`cross-source merge of ${String(a.loser_spot_id)}: its spots are not carried`);
  }
  for (const s of spots.values()) {
    if (s.merged_into === null) continue;
    const justified = attestations.some((a) => a.survivor_spot_id === s.merged_into && (a.loser_spot_id === s.spot_id
      || (JSON.parse(String(a.redirected_spot_ids_json)) as string[]).includes(String(s.spot_id))));
    if (!justified) fail(`spot ${String(s.spot_id)} redirects to ${String(s.merged_into)} without an attested cross-source merge`);
  }
}

async function validateSnapshots(rows: Map<string, Row[]>): Promise<void> {
  const members = rows.get("tile_snapshot_spots") ?? [];
  const sources = rows.get("sources") ?? [];
  const spots = rows.get("spots") ?? [];
  for (const tile of rows.get("tile_snapshots") ?? []) {
    const tileId = String(tile.tile_id);
    const body = String(tile.body_json);
    if (await sha256Hex(body) !== tile.content_sha256) fail(`tile ${tileId}: body does not match its stored content hash`);
    const parsed = TileBodyV1.safeParse(JSON.parse(body));
    if (!parsed.success) fail(`tile ${tileId}: stored body is not a valid tile response`);
    if (parsed.data.tile !== tileId) fail(`tile ${tileId}: body names tile ${parsed.data.tile}`);
    if (parsed.data.spots.length !== tile.spot_count) fail(`tile ${tileId}: spot_count does not match the body`);

    const published = members.filter((m) => m.tile_id === tileId).map((m) => String(m.spot_id)).sort();
    const inBody = parsed.data.spots.map((s) => s.id).sort();
    if (published.join(",") !== inBody.join(",")) fail(`tile ${tileId}: snapshot membership does not match the body`);

    // A body published before the exported release was applied can still list exactly the published
    // spots, with the previous release's values (lastVerifiedAt, a relocated coordinate). The body must be
    // what publishTiles would write from the canonical rows this bundle carries, or the tiles are stale.
    const raw = JSON.parse(body) as { spots: { id: string }[] };
    for (const bodySpot of raw.spots) {
      const spot = spots.find((s) => s.spot_id === bodySpot.id);
      const source = sources.find((s) => s.source_id === (bodySpot as { sourceIds?: string[] }).sourceIds?.[0]);
      if (spot === undefined || source === undefined || JSON.stringify(spotDto({ ...spot, ...source, source_kind: source.kind } as unknown as CandidateRow)) !== JSON.stringify(bodySpot)) {
        fail(`tile ${tileId}: body for spot ${bodySpot.id} does not match its canonical row; republish before exporting`);
      }
    }

    // Attribution travels with the data or the data does not travel (DATA_POLICY.md).
    for (const bodySource of parsed.data.sources) {
      const row = sources.find((s) => s.source_id === bodySource.id);
      if (row === undefined) fail(`tile ${tileId}: body cites source ${bodySource.id}, which this bundle does not carry`);
      if (bodySource.attributionText === null || bodySource.attributionText !== row.attribution_text) {
        fail(`tile ${tileId}: attribution for ${bodySource.id} is missing or does not match the registry row`);
      }
    }
  }
}

function tableStatements(rows: Map<string, Row[]>, specs: readonly TableSpec[] = TABLES): string[] {
  const statements: string[] = [];
  for (const spec of specs) {
    const table = rows.get(spec.table) ?? [];
    if (table.length === 0) continue;
    statements.push(`-- ${spec.table} (${table.length})`);
    for (const row of table) {
      const values = spec.columns.map((c) => literal(row[c])).join(", ");
      statements.push(`INSERT INTO ${spec.table} (${spec.columns.join(", ")}) VALUES (${values});`);
    }
    statements.push("");
  }
  return statements;
}

/**
 * Reads one validated local database and returns the promotion artifact. It never writes, and the
 * `Db` it is given is a local binding by construction — the scripts that call it open their
 * binding with `remoteBindings: false`.
 */
export async function buildPromotionBundle(db: Db, options: { releaseId?: number } = {}): Promise<PromotionBundle> {
  const releaseId = options.releaseId ?? await currentReleaseId(db);
  if (!Number.isInteger(releaseId) || releaseId < 1) fail(`release id must be a positive integer, got ${releaseId}`);

  // A v2 bundle carries one source; a cross-source merge spans two and travels only in v3 (Issue #107).
  const merges = await db.prepare("SELECT count(*) AS n FROM cross_source_merges").first<{ n: number }>();
  if ((merges?.n ?? 0) > 0) fail("this database holds applied cross-source merges; export it with promotion-bundle.v3");

  const rows = new Map<string, Row[]>();
  for (const spec of TABLES) rows.set(spec.table, await rowsOf(db, spec, releaseId));

  if ((rows.get("sources") ?? [])[0]?.kind === "userReport") fail("an additive userReport source is promoted only with promotion-bundle.v3");
  await validateRelease(db, releaseId, rows.get("sources") ?? [], (rows.get("source_releases") ?? [])[0]);
  await validatePublishedState(db, [releaseId], rows);
  validateReviewAttestations(rows);
  await validateSnapshots(rows);

  const release = (rows.get("source_releases") ?? [])[0];
  const counts = Object.fromEntries(TABLES.map((s) => [s.table, (rows.get(s.table) ?? []).length]));
  const reviewDependencies = (rows.get("promotion_review_match_attestations") ?? []).map((a) => ({
    recordId: a.record_id,
    previousReleaseId: a.previous_release_id,
    previousReleaseContentSha256: a.previous_release_content_sha256,
  }));
  const statements: string[] = [
    BUNDLE_BODY_FIRST_LINE,
    `INSERT INTO promotion_bootstraps (promotion_bootstrap_id, bundle_version, source_id, release_id, release_content_sha256, review_dependencies_json, expected_rows_json) VALUES (1, ${
      [PROMOTION_BUNDLE_VERSION, release.source_id, releaseId, release.content_sha256, JSON.stringify(reviewDependencies), JSON.stringify(counts)].map(literal).join(", ")});`,
    "",
  ];
  statements.push(...tableStatements(rows));
  statements.push(
    "-- promotion_bootstrap_completions: the target re-checks the declared release and row counts",
    "INSERT INTO promotion_bootstrap_completions (promotion_bootstrap_id) VALUES (1);",
    "",
  );
  const body = statements.join("\n");
  const contentSha256 = await sha256Hex(body);

  const manifest: PromotionManifest = {
    generator: PROMOTION_BUNDLE_VERSION,
    releaseId,
    sourceId: String(release.source_id),
    observedOn: release.observed_on === null ? null : String(release.observed_on),
    releaseContentSha256: String(release.content_sha256),
    tiles: (rows.get("tile_snapshots") ?? []).map((t) => ({
      tileId: String(t.tile_id),
      revision: Number(t.revision),
      spotCount: Number(t.spot_count),
      contentSha256: String(t.content_sha256),
    })),
    rows: counts,
    contentSha256,
  };

  const header = [
    "-- MannerPath promotion bundle. Generated from a validated LOCAL database; see docs/OPERATIONS.md.",
    `-- generator: ${PROMOTION_BUNDLE_VERSION}`,
    `-- release: ${releaseId} (${manifest.sourceId}, observed ${manifest.observedOn ?? "unknown"}, bytes ${manifest.releaseContentSha256})`,
    `-- rows: ${Object.entries(manifest.rows).map(([t, n]) => `${t}=${n}`).join(" ")}`,
    ...manifest.tiles.map((t) => `-- tile ${t.tileId}: revision ${t.revision}, ${t.spotCount} spot(s), ${t.contentSha256}`),
    `-- contentSha256: ${contentSha256}`,
    "--",
    "-- TARGET: an EMPTY, freshly migrated database. This bundle is INSERT-only — it bootstraps a new",
    "-- database and cannot update a populated one. To ship corrected data, create a new D1 database,",
    "-- migrate it, apply the new bundle, smoke verify, then switch the Worker's binding in a reviewed",
    "-- deployment (blue/green; docs/OPERATIONS.md). Its first statement refuses any database that is not",
    "-- empty; its last re-checks that exactly the declared release arrived. Requires migrations through",
    "-- 0016. D1 applies --file as one transaction: a failure leaves the target empty. Do not add",
    "-- BEGIN/COMMIT (D1 refuses them), and discard a target whose apply failed rather than reuse it.",
    "--",
    "-- This file contains no secret and no user report data. Applying it is an explicit human step.",
    "-- Address the target database BY NAME: while an environment's binding still points at the live",
    "-- database, --env would migrate and write to that one instead (docs/OPERATIONS.md step 6).",
    "--   npx wrangler d1 migrations apply <new-database-name> --remote",
    "--   npx wrangler d1 execute <new-database-name> --remote --file <this file>",
    "-- The receiving database re-checks the publication invariant on every tile_snapshot_spots row,",
    "-- so an inconsistent bundle is rejected there as well as here. A consistently edited one is not:",
    "-- before applying, verify this file against the contentSha256 in its REVIEW RECORD, not this header:",
    "--   npm run local:verify-promotion -- --file <this file> --expected-content-sha256 <reviewed hash>",
    "",
  ].join("\n");

  return { sql: `${header}${body}`, manifest };
}

export interface MultiSourcePromotionSource {
  sourceId: string;
  /** The declared release: the current one, or for an additive source its anchor (lowest release id). */
  releaseId: number;
  observedOn: string | null;
  releaseContentSha256: string;
  displayName: string;
  licenseName: string | null;
  licenseUrl: string | null;
  attributionText: string;
  /** This source's share of the source-scoped tables; the target re-checks each one. */
  rows: Record<string, number>;
  reviewDependencies: { recordId: number; previousReleaseId: number; previousReleaseContentSha256: string }[];
  /** An additive (userReport) source only: every release it carries, the anchor included (migration 0021). */
  additiveReleases?: { releaseId: number; releaseContentSha256: string }[];
}

export interface MultiSourcePromotionManifest {
  generator: string;
  sources: MultiSourcePromotionSource[];
  tiles: PromotionManifest["tiles"];
  rows: Record<string, number>;
  contentSha256: string;
}

/** The current applied release of every source in the database, ordered by source id. */
export async function currentReleaseIds(db: Db): Promise<number[]> {
  const { results } = await db.prepare(
    "SELECT release_id FROM source_releases WHERE is_current = 1 ORDER BY source_id",
  ).all<{ release_id: number }>();
  if (results.length === 0) fail("no current applied release exists in this database; run the pipeline first");
  return results.map((r) => r.release_id);
}

/**
 * The applied releases of every additive (userReport) source that is approved in its row AND in the reviewed
 * registry. A blocked community source contributes nothing, so its database exports exactly the bytes it would
 * without it (Issue #124: blocked until approved).
 */
export async function additiveReleaseIds(db: Db, registry: PromotionRegistry = REVIEWED_REGISTRY): Promise<number[]> {
  const { results } = await db.prepare(
    `SELECT rel.release_id, rel.source_id FROM source_releases rel JOIN sources s ON s.source_id = rel.source_id
     WHERE s.kind = 'userReport' AND s.publication_status = 'approved' AND rel.status = 'applied' ORDER BY rel.release_id`,
  ).all<{ release_id: number; source_id: string }>();
  return results.filter((r) => registry.source(r.source_id).publicationStatus === "approved").map((r) => r.release_id);
}

/**
 * The terms rows a promoted community spot depends on (migration 0021): the granted versions its carried records
 * name. Carried only when a community release is, so a bundle without one keeps its bytes.
 */
const REPORT_TERMS_ROWS: TableSpec = {
  table: "report_terms_versions",
  columns: ["terms_version", "document_path", "document_sha256", "publication_rights", "created_at", "updated_at"],
  sql: `SELECT * FROM report_terms_versions WHERE publication_rights = 'granted' AND terms_version IN (
          SELECT json_extract(r.raw_values_json, '$[6]') FROM source_records r
          JOIN source_releases rel ON rel.release_id = r.release_id JOIN sources s ON s.source_id = rel.source_id
          WHERE s.kind = 'userReport' AND rel.release_id = ?)
        ORDER BY terms_version`,
};

/** v3 with an additive source: the terms rows right after the sources, before any release or tile. */
const ADDITIVE_TABLES: readonly TableSpec[] = MULTI_SOURCE_TABLES.flatMap((t) => (t.table === "sources" ? [t, REPORT_TERMS_ROWS] : [t]));

/**
 * promotion-bundle.v3: the current releases of several reviewed sources in ONE bootstrap. Every source passes
 * the same checks as a v2 export, and the bundle is refused as a whole when any one of them fails — there is
 * no partial export, and the target's completion (migration 0018) refuses a partial apply. Sources are ordered
 * by source id and rows keep the v2 per-table order, so the artifact is byte-deterministic.
 *
 * An approved additive (userReport) source travels with every applied release (migration 0021): one declaration
 * whose release is its lowest release (the anchor), plus one additive declaration per release. Its published spots
 * must rest on a terms version the reviewed list grants, and its terms rows travel with it. Report and review
 * tables never do. Without an additive source the bytes are exactly the pre-0021 ones.
 */
export async function buildMultiSourcePromotionBundle(
  db: Db, options: { releaseIds?: number[]; registry?: PromotionRegistry } = {},
): Promise<{ sql: string; manifest: MultiSourcePromotionManifest }> {
  const registry = options.registry ?? REVIEWED_REGISTRY;
  const requested = options.releaseIds ?? [...await currentReleaseIds(db), ...await additiveReleaseIds(db, registry)];
  if (requested.length === 0) fail("no release was named");
  for (const id of requested) if (!Number.isInteger(id) || id < 1) fail(`release id must be a positive integer, got ${id}`);
  if (new Set(requested).size !== requested.length) fail("a release is named twice");

  // Validate each release on its own first (existence, applied, current, approved, registry identity), then order
  // by source id (and release id), so the same set named in any order yields the same bytes.
  const releases: Row[] = [];
  const additiveSources = new Set<string>();
  for (const id of requested) {
    const release = await db.prepare("SELECT * FROM source_releases WHERE release_id = ?").bind(id).first<Row>();
    const { results: sources } = await db.prepare(`SELECT * FROM sources WHERE source_id = (${RELEASE_SOURCE})`).bind(id).all<Row>();
    await validateRelease(db, id, sources, release ?? undefined, registry);
    if (sources[0].kind === "userReport") additiveSources.add(String(sources[0].source_id));
    releases.push(release!);
  }
  releases.sort((a, b) => String(a.source_id) < String(b.source_id) ? -1 : String(a.source_id) > String(b.source_id) ? 1
    : Number(a.release_id) - Number(b.release_id));
  for (let i = 1; i < releases.length; i++) {
    if (releases[i].source_id === releases[i - 1].source_id && !additiveSources.has(String(releases[i].source_id))) {
      fail(`source ${String(releases[i].source_id)} is named with two releases`);
    }
  }
  const releaseIds = releases.map((r) => Number(r.release_id));
  // The first (lowest) release of each source: the one release a source-scoped spec is read through.
  const anchors = releases.filter((r, i) => i === 0 || releases[i - 1].source_id !== r.source_id);
  const anchorIds = anchors.map((r) => Number(r.release_id));

  const specs = additiveSources.size > 0 ? ADDITIVE_TABLES : MULTI_SOURCE_TABLES;
  const rows = new Map<string, Row[]>();
  for (const spec of specs) {
    const scoped = spec.sql.includes("?");
    const perSource = spec.sql.includes(RELEASE_SOURCE);
    const collected: Row[] = [];
    for (const id of !scoped ? [undefined] : perSource ? anchorIds : releaseIds) collected.push(...await rowsOf(db, spec, id));
    // A terms version several community releases name is one row.
    rows.set(spec.table, spec === REPORT_TERMS_ROWS
      ? [...new Map(collected.map((r) => [String(r.terms_version), r])).values()]
        .sort((a, b) => (String(a.terms_version) < String(b.terms_version) ? -1 : 1))
      : collected);
  }
  await validatePublishedState(db, releaseIds, rows);
  validateReviewAttestations(rows);
  validateCrossSourceMerges(rows);
  await validateSnapshots(rows);
  validateCommunityRights(rows, registry);

  // The attestation and terms counts are declared only when there is one, so a bundle without them keeps its v3 bytes.
  const counts = Object.fromEntries(specs
    .filter((s) => (s !== CROSS_SOURCE_ATTESTATIONS && s !== REPORT_TERMS_ROWS) || (rows.get(s.table) ?? []).length > 0)
    .map((s) => [s.table, (rows.get(s.table) ?? []).length]));
  const of = (table: string) => rows.get(table) ?? [];
  const sourceRows = new Map(of("sources").map((s) => [String(s.source_id), s]));
  const entitySource = new Map(of("source_entities").map((e) => [Number(e.source_entity_id), String(e.source_id)]));
  const recordRelease = new Map(of("source_records").map((r) => [Number(r.record_id), Number(r.release_id)]));
  const declared: MultiSourcePromotionSource[] = anchors.map((release) => {
    const sourceId = String(release.source_id);
    const releaseId = Number(release.release_id);
    const own = releases.filter((r) => r.source_id === sourceId);
    const ownIds = new Set(own.map((r) => Number(r.release_id)));
    const source = sourceRows.get(sourceId)!;
    const inRelease = (r: Row) => ownIds.has(Number(r.release_id));
    const ofRecord = (recordId: unknown) => ownIds.has(recordRelease.get(Number(recordId)) ?? -1);
    const declaration: MultiSourcePromotionSource = {
      sourceId,
      releaseId,
      observedOn: release.observed_on === null ? null : String(release.observed_on),
      releaseContentSha256: String(release.content_sha256),
      displayName: String(source.display_name),
      licenseName: source.license_name === null ? null : String(source.license_name),
      licenseUrl: source.license_url === null ? null : String(source.license_url),
      attributionText: String(source.attribution_text),
      rows: {
        source_releases: of("source_releases").filter((r) => r.source_id === sourceId).length,
        source_records: of("source_records").filter(inRelease).length,
        source_record_match_keys: of("source_record_match_keys").filter((k) => ofRecord(k.record_id)).length,
        source_entities: of("source_entities").filter((e) => e.source_id === sourceId).length,
        promotion_review_match_attestations: of("promotion_review_match_attestations").filter(inRelease).length,
        source_record_entities: of("source_record_entities").filter(inRelease).length,
        spot_source_entities: of("spot_source_entities").filter((l) => entitySource.get(Number(l.source_entity_id)) === sourceId).length,
        spot_field_provenance: of("spot_field_provenance").filter((p) => ofRecord(p.record_id)).length,
      },
      reviewDependencies: of("promotion_review_match_attestations").filter(inRelease).map((a) => ({
        recordId: Number(a.record_id),
        previousReleaseId: Number(a.previous_release_id),
        previousReleaseContentSha256: String(a.previous_release_content_sha256),
      })),
    };
    if (additiveSources.has(sourceId)) {
      declaration.additiveReleases = own.map((r) => ({ releaseId: Number(r.release_id), releaseContentSha256: String(r.content_sha256) }));
    }
    return declaration;
  });
  const additive = declared.flatMap((d) => (d.additiveReleases ?? []).map((a) => ({ sourceId: d.sourceId, ...a })));

  const statements: string[] = [
    MULTI_SOURCE_BUNDLE_BODY_FIRST_LINE,
    `INSERT INTO promotion_multi_bootstraps (promotion_bootstrap_id, bundle_version, source_count, expected_rows_json) VALUES (1, ${
      [MULTI_SOURCE_PROMOTION_BUNDLE_VERSION, declared.length, JSON.stringify(counts)].map(literal).join(", ")});`,
    "",
    `-- promotion_multi_bootstrap_sources (${declared.length}): every source is declared before any data row`,
    ...declared.map((d) => `INSERT INTO promotion_multi_bootstrap_sources (source_id, promotion_bootstrap_id, release_id, release_content_sha256, display_name, license_name, license_url, attribution_text, review_dependencies_json, expected_rows_json) VALUES (${
      [d.sourceId, 1, d.releaseId, d.releaseContentSha256, d.displayName, d.licenseName, d.licenseUrl, d.attributionText,
        JSON.stringify(d.reviewDependencies), JSON.stringify(d.rows)].map(literal).join(", ")});`),
    "",
    ...(additive.length === 0 ? [] : [
      `-- promotion_multi_bootstrap_additive_releases (${additive.length}): every release of an additive source, anchor included`,
      ...additive.map((a) => `INSERT INTO promotion_multi_bootstrap_additive_releases (release_id, source_id, release_content_sha256) VALUES (${
        [a.releaseId, a.sourceId, a.releaseContentSha256].map(literal).join(", ")});`),
      "",
    ]),
    ...tableStatements(rows, specs),
    "-- promotion_multi_bootstrap_completions: the target re-checks every declared source and the row counts",
    "INSERT INTO promotion_multi_bootstrap_completions (promotion_bootstrap_id) VALUES (1);",
    "",
  ];
  const body = statements.join("\n");
  const contentSha256 = await sha256Hex(body);
  const manifest: MultiSourcePromotionManifest = {
    generator: MULTI_SOURCE_PROMOTION_BUNDLE_VERSION,
    sources: declared,
    tiles: of("tile_snapshots").map((t) => ({
      tileId: String(t.tile_id),
      revision: Number(t.revision),
      spotCount: Number(t.spot_count),
      contentSha256: String(t.content_sha256),
    })),
    rows: counts,
    contentSha256,
  };

  const header = [
    "-- MannerPath promotion bundle. Generated from a validated LOCAL database; see docs/OPERATIONS.md.",
    `-- generator: ${MULTI_SOURCE_PROMOTION_BUNDLE_VERSION}`,
    ...declared.map((d) => d.additiveReleases === undefined
      ? `-- source ${d.sourceId}: release ${d.releaseId} (observed ${d.observedOn ?? "unknown"}, bytes ${d.releaseContentSha256})`
      : `-- source ${d.sourceId}: additive, release(s) ${d.additiveReleases.map((a) => a.releaseId).join(", ")}`),
    `-- rows: ${Object.entries(manifest.rows).map(([t, n]) => `${t}=${n}`).join(" ")}`,
    ...manifest.tiles.map((t) => `-- tile ${t.tileId}: revision ${t.revision}, ${t.spotCount} spot(s), ${t.contentSha256}`),
    `-- contentSha256: ${contentSha256}`,
    "--",
    `-- TARGET: an EMPTY, freshly migrated database (migrations through ${additive.length === 0 ? "0018" : "0021"}). This bundle is INSERT-only and`,
    "-- cannot update a populated one. It carries SEVERAL sources and applies ALL OR NOTHING: if any one source's",
    "-- fingerprint, rows, attestations or publication status does not match its declaration, the completion",
    "-- statement fails and D1 rolls the whole file back. Do not split it, do not add BEGIN/COMMIT (D1 refuses",
    "-- them), and discard a target whose apply failed rather than reuse it (blue/green; docs/OPERATIONS.md).",
    "--",
    "-- This file contains no secret and no user report data. Applying it is an explicit human step.",
    "-- Address the target database BY NAME (docs/OPERATIONS.md step 6):",
    "--   npx wrangler d1 migrations apply <new-database-name> --remote",
    "--   npx wrangler d1 execute <new-database-name> --remote --file <this file>",
    "-- Before applying, verify this file against the contentSha256 in its REVIEW RECORD, not this header:",
    "--   npm run local:verify-promotion -- --file <this file> --expected-content-sha256 <reviewed hash>",
    "",
  ].join("\n");
  return { sql: `${header}${body}`, manifest };
}

/**
 * Every carried community spot that is published rests on a terms version the reviewed list grants, and its row
 * travels. The target re-checks the row (0021 tile_snapshot_spots_community_rights); the reviewed list is checked
 * only here, as REVIEWED_SOURCES is.
 */
function validateCommunityRights(rows: Map<string, Row[]>, registry: PromotionRegistry): void {
  const communitySources = new Set((rows.get("sources") ?? []).filter((s) => s.kind === "userReport").map((s) => String(s.source_id)));
  const communityReleases = new Set((rows.get("source_releases") ?? [])
    .filter((r) => communitySources.has(String(r.source_id))).map((r) => Number(r.release_id)));
  if (communityReleases.size === 0) return;
  const records = new Map((rows.get("source_records") ?? []).map((r) => [Number(r.record_id), r]));
  const published = new Set((rows.get("tile_snapshot_spots") ?? []).map((m) => String(m.spot_id)));
  const carriedTerms = new Set((rows.get("report_terms_versions") ?? []).map((t) => String(t.terms_version)));
  for (const p of rows.get("spot_field_provenance") ?? []) {
    const record = records.get(Number(p.record_id));
    if (p.field !== "existence" || record === undefined || !communityReleases.has(Number(record.release_id))) continue;
    if (!published.has(String(p.spot_id))) continue;
    const terms = (JSON.parse(String(record.raw_values_json)) as string[])[6] ?? "";
    let reviewed: ReviewedTerms | undefined;
    try {
      reviewed = terms === "" ? undefined : registry.terms(terms);
    } catch {
      reviewed = undefined;
    }
    if (reviewed?.publicationRights !== "granted" || !carriedTerms.has(terms)) {
      fail(`published community spot ${String(p.spot_id)} does not rest on a granted terms version (Issue #124)`);
    }
  }
}

/**
 * Checks a bundle file before it is applied (docs/OPERATIONS.md): the body's SHA-256 must equal both the
 * header's `contentSha256` and `expectedContentSha256`, which the caller takes from a reviewed record kept
 * apart from the file. The header alone proves nothing: whoever edits the body can rewrite it too, and
 * the target database cannot tell a consistently edited bundle from a genuine one (Issue #100).
 */
export async function verifyPromotionBundle(sql: string, expectedContentSha256: string): Promise<string> {
  const refuse = (detail: string): never => { throw new PromotionError(`promotion verification refused: ${detail}`); };
  if (!CONTENT_SHA256.test(expectedContentSha256)) refuse("the expected contentSha256 is not 64 lowercase hex digits");
  // A v2 or a v3 body, and exactly one body start of either kind in the whole file.
  const starts = [BUNDLE_BODY_FIRST_LINE, MULTI_SOURCE_BUNDLE_BODY_FIRST_LINE].flatMap((line) => {
    const found: number[] = [];
    for (let i = sql.indexOf(`\n${line}\n`); i >= 0; i = sql.indexOf(`\n${line}\n`, i + 1)) found.push(i);
    return found;
  });
  if (starts.length !== 1) refuse("no single bundle body start");
  const start = starts[0];
  const headerLines = sql.slice(0, start + 1).split("\n");
  // The header is outside the hash. It must contain no executable SQL, even if the body and its
  // externally reviewed hash are intact. SQLite accepts statements before a comment-only body.
  if (headerLines.some((line) => /[\r\0]/.test(line) || (line !== "" && !line.startsWith("--")))) {
    refuse("the unhashed header contains executable content");
  }
  const header = headerLines.filter((l) => l.startsWith("-- contentSha256: "));
  if (header.length !== 1) refuse(`the header has ${header.length} contentSha256 lines, not 1`);
  const embedded = header[0].slice("-- contentSha256: ".length);
  if (!CONTENT_SHA256.test(embedded)) refuse("the header's contentSha256 is not 64 lowercase hex digits");
  const calculated = await sha256Hex(sql.slice(start + 1));
  if (calculated !== embedded) refuse(`body hashes to ${calculated}, header says ${embedded}`);
  if (calculated !== expectedContentSha256) refuse(`body hashes to ${calculated}, the reviewed record says ${expectedContentSha256}`);
  return calculated;
}
