// Beta data-quality analysis (Issue #33): a deterministic, read-only measurement of what a database
// actually publishes. It answers "where is this corpus trustworthy enough to ship a beta", so every
// number here is derived from the database, never from a constant in a document.
//
// Read-only by construction: it prepares SELECTs only, and the caller decides where the numbers go
// (scripts/data-quality.ts prints them for the local database; the tests run it over a fixture).
//
// The checks are the machine-readable half of docs/BETA_DATA_QUALITY.md. Each one restates an
// invariant that already exists in this repository (ADR-0005, ADR-0006, docs/DATA_POLICY.md,
// docs/SOURCES.md) and fails loudly rather than being silently absent.

import { type Db } from "../db.ts";
import { DATA_TILE_ZOOM } from "../geo/tile.ts";
import { REVIEWED_SOURCES } from "../pipeline/registry.ts";
import {
  ATTENUATED_FIELD,
  TAITO_LIST_PAGE_ATTESTATION_VERSION,
  TAITO_LIST_PAGE_CHECKED_AT,
  TAITO_LIST_PAGE_CONFLICTS,
  TAITO_LIST_PAGE_REFERENCE_KIND,
  TAITO_LIST_PAGE_URL,
  TAITO_REVIEWED_RELEASE,
} from "../pipeline/taito-list-page.ts";
import { TAITO_EXISTENCE_RULE, TAITO_SOURCE_ID, TAITO_UNRESOLVED_FIELDS } from "../pipeline/taito.ts";
import { TileBodyV1 } from "../tiles/dto.ts";

export const ANALYSIS_VERSION = "beta-data-quality.v1";

/**
 * ADR-0005 §"Re-evaluate before release": the z14 decision is revisited if a source makes any tile
 * exceed these. They are the published trigger values, so the analysis reports distance to them
 * instead of re-arguing the zoom.
 */
export const TILE_REEVALUATION_SPOTS = 250;
export const TILE_REEVALUATION_GZIP_BYTES = 16 * 1024;

export interface AnalyzeOptions {
  /** Reference instant for the freshness arithmetic; the caller's clock, so output stays testable. */
  now: string;
  /** Optional gzip sizer (node:zlib in the CLI and tests). Without it, gzip figures are null. */
  gzip?: (body: string) => number;
}

export interface Check {
  id: string;
  status: "pass" | "fail";
  detail: string;
}

type Counts = Record<string, number>;

function tally(values: string[]): Counts {
  const counts: Counts = {};
  for (const v of values) counts[v] = (counts[v] ?? 0) + 1;
  // Fixed key order, so two runs over the same database produce byte-identical JSON.
  return Object.fromEntries(Object.entries(counts).sort(([a], [b]) => (a < b ? -1 : 1)));
}

/** Nearest-rank percentile over a sorted ascending array; null for an empty array. */
function percentile(sorted: number[], p: number): number | null {
  if (sorted.length === 0) return null;
  return sorted[Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)];
}

function rate(unknown: number, total: number): number | null {
  return total === 0 ? null : Number((unknown / total).toFixed(4));
}

const EARTH_RADIUS_M = 6_371_008.8;

/** Great-circle distance in metres (haversine). Deterministic; no projection, no datum shift. */
function haversineMeters(a: { latitude: number; longitude: number }, b: { latitude: number; longitude: number }): number {
  const toRad = Math.PI / 180;
  const dLat = (b.latitude - a.latitude) * toRad;
  const dLon = (b.longitude - a.longitude) * toRad;
  const h = Math.sin(dLat / 2) ** 2
    + Math.cos(a.latitude * toRad) * Math.cos(b.latitude * toRad) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

/**
 * Distance from each published spot to its closest neighbour, which is how thin the corpus is where
 * it does have data. O(n²) on purpose: the corpus is small and an exact answer is worth more here
 * than an index. Returns null below two spots, where the measure has no meaning.
 */
function nearestNeighbourMeters(spots: { latitude: number; longitude: number }[]) {
  if (spots.length < 2) return null;
  const distances = spots.map((a) => {
    let nearest = Infinity;
    for (const b of spots) {
      if (b === a) continue;
      nearest = Math.min(nearest, haversineMeters(a, b));
    }
    // Whole metres: the source coordinates carry 3-6 decimals, so sub-metre digits are noise.
    return Math.round(nearest);
  }).sort((x, y) => x - y);
  return {
    min: distances[0],
    p50: percentile(distances, 50),
    p90: percentile(distances, 90),
    max: distances[distances.length - 1],
  };
}

function days(from: string, to: string): number {
  return Math.round((Date.parse(to) - Date.parse(from)) / 86_400_000);
}

export async function analyzeCorpus(db: Db, opts: AnalyzeOptions) {
  const { results: sources } = await db.prepare(
    `SELECT source_id, display_name, kind, license_name, license_url, attribution_text, publication_status
     FROM sources ORDER BY source_id`,
  ).all<{
    source_id: string; display_name: string; kind: string; license_name: string | null;
    license_url: string | null; attribution_text: string | null; publication_status: string;
  }>();

  const { results: releases } = await db.prepare(
    `SELECT release_id, source_id, observed_on, fetched_at, source_url, http_last_modified,
            content_sha256, byte_length, record_count, parser_version, status, is_current
     FROM source_releases ORDER BY release_id`,
  ).all<{
    release_id: number; source_id: string; observed_on: string | null; fetched_at: string;
    source_url: string; http_last_modified: string | null; content_sha256: string; byte_length: number;
    record_count: number; parser_version: string; status: string; is_current: number;
  }>();

  const { results: tiles } = await db.prepare(
    "SELECT tile_id, z, x, y, revision, schema_version, spot_count, body_json, published_at FROM tile_snapshots ORDER BY tile_id",
  ).all<{
    tile_id: string; z: number; x: number; y: number; revision: number; schema_version: number;
    spot_count: number; body_json: string; published_at: string;
  }>();

  // The published corpus is what the tiles contain — the client's view, not the spots table.
  const published = tiles.flatMap((t) => {
    const body = TileBodyV1.parse(JSON.parse(t.body_json));
    return body.spots.map((s) => ({ tile: t.tile_id, spot: s }));
  });
  const spots = published.map((p) => p.spot);

  const latitudes = spots.map((s) => s.latitude).sort((a, b) => a - b);
  const longitudes = spots.map((s) => s.longitude).sort((a, b) => a - b);
  const occupied = tiles.filter((t) => t.spot_count > 0);
  const perTile = occupied.map((t) => t.spot_count).sort((a, b) => a - b);

  const tileSizes = tiles.map((t) => ({
    tileId: t.tile_id,
    revision: t.revision,
    spotCount: t.spot_count,
    rawBytes: new TextEncoder().encode(t.body_json).length,
    gzipBytes: opts.gzip ? opts.gzip(t.body_json) : null,
    sourceIds: [...new Set(JSON.parse(t.body_json).sources.map((s: { id: string }) => s.id))].sort(),
  }));
  const bySpots = [...tileSizes].sort((a, b) => b.spotCount - a.spotCount || (a.tileId < b.tileId ? -1 : 1));
  const byBytes = [...tileSizes].sort((a, b) => b.rawBytes - a.rawBytes || (a.tileId < b.tileId ? -1 : 1));

  const verified = spots.map((s) => s.lastVerifiedAt).filter((d): d is string => d !== null).sort();
  const openingHours = tally(spots.map((s) => s.openingHours.status));

  const unknownRates = {
    spotType: { unknown: spots.filter((s) => s.spotType === "unknown").length, total: spots.length },
    accessType: { unknown: spots.filter((s) => s.accessType === "unknown").length, total: spots.length },
    environment: { unknown: spots.filter((s) => s.environment === "unknown").length, total: spots.length },
    supportsPaper: { unknown: spots.filter((s) => s.supportsPaper === "unknown").length, total: spots.length },
    supportsHeated: { unknown: spots.filter((s) => s.supportsHeated === "unknown").length, total: spots.length },
    // "unknown" for hours means the client cannot compute openNow: no hours, or hours it must not parse.
    openingHours: { unknown: spots.length - (openingHours.parsed ?? 0), total: spots.length },
  };

  const publishedSourceIds = [...new Set(tileSizes.flatMap((t) => t.sourceIds))].sort() as string[];
  const bySourceId = new Map(sources.map((s) => [s.source_id, s]));
  const reviewed = new Map(REVIEWED_SOURCES.map((s) => [s.sourceId, s]));

  // Per-source expectation, not a repository invariant. 台東区's file has no column for a spot's
  // type, host, access or environment (services/api/src/pipeline/taito.ts), so a Taito-derived spot
  // that carries one of them was inferred — in this corpus, from a convenience store's name. A
  // future reviewed source that *states* such a value resolves it with provenance and is untouched
  // by these two checks.
  const { results: taitoSpots } = await db.prepare(
    `SELECT s.spot_id, s.spot_type, s.host_type, s.access_type, s.environment, p.rule AS existence_rule,
            (SELECT group_concat(field) FROM spot_field_provenance q WHERE q.spot_id = s.spot_id
              AND q.field IN ('spotType', 'hostType', 'accessType', 'environment')) AS typed_fields
     FROM spots s
     JOIN spot_field_provenance p ON p.spot_id = s.spot_id AND p.field = 'existence'
     JOIN source_records r ON r.record_id = p.record_id
     JOIN source_releases rel ON rel.release_id = r.release_id
     WHERE rel.source_id = ?
     ORDER BY s.spot_id`,
  ).bind(TAITO_SOURCE_ID).all<{
    spot_id: string; spot_type: string; host_type: string | null; access_type: string;
    environment: string; existence_rule: string; typed_fields: string | null;
  }>();

  const taitoTyped = taitoSpots.filter((r) =>
    r.spot_type !== "unknown" || r.host_type !== null || r.access_type !== "unknown"
    || r.environment !== "unknown" || r.typed_fields !== null);
  const taitoHostEvidence = taitoSpots.filter((r) => r.existence_rule !== TAITO_EXISTENCE_RULE);

  // Issue #42 reconciliation: every record the ward's *other* current publication contradicts must
  // have ended up conservative — hours that cannot yield a confirmed openNow, or no publication at
  // all — and every weakening must be backed by an explicit attestation row carrying the reference,
  // the check date and the exact release it was reviewed against.
  const { results: reconciled } = await db.prepare(
    `SELECT s.spot_id, s.name, s.opening_hours_status, s.lifecycle, s.publication_hold,
            EXISTS (SELECT 1 FROM tile_snapshot_spots t WHERE t.spot_id = s.spot_id) AS published
     FROM spots s
     JOIN spot_field_provenance p ON p.spot_id = s.spot_id AND p.field = 'existence'
     JOIN source_records r ON r.record_id = p.record_id
     JOIN source_releases rel ON rel.release_id = r.release_id
     WHERE rel.source_id = ? ORDER BY s.spot_id`,
  ).bind(TAITO_SOURCE_ID).all<{
    spot_id: string; name: string | null; opening_hours_status: string; lifecycle: string;
    publication_hold: string | null; published: number;
  }>();
  const byName = new Map(reconciled.map((r) => [r.name ?? "", r]));

  const { results: attenuations } = await db.prepare(
    `SELECT a.spot_id, s.name, a.field, a.effect, a.attestation_version, a.reference_kind, a.reference_url,
            a.checked_at, a.release_content_sha256, a.release_observed_on, a.release_source_url, a.resolver_version
     FROM spot_field_attenuations a JOIN spots s ON s.spot_id = a.spot_id ORDER BY a.spot_id, a.field, a.effect`,
  ).all<{
    spot_id: string; name: string | null; field: string; effect: string; attestation_version: string;
    reference_kind: string; reference_url: string; checked_at: string; release_content_sha256: string;
    release_observed_on: string | null; release_source_url: string; resolver_version: string;
  }>();
  const attenuationAt = new Map(attenuations.map((a) => [`${a.spot_id}\u0000${a.effect}`, a]));

  // A database with no Taito spots at all (a fixture of another source) has nothing to check.
  const unresolvedConflicts = reconciled.length === 0 ? [] : TAITO_LIST_PAGE_CONFLICTS.flatMap((c) => {
    const row = byName.get(c.csvName);
    if (!row) return [`${c.csvName}: no canonical spot`];
    const problems: string[] = [];
    if (c.effects.includes("hoursUnknown") && row.opening_hours_status === "parsed") {
      problems.push("hours still parsed");
    }
    if (c.effects.includes("temporarilyClosed") && (row.lifecycle !== "temporarilyClosed" || row.published === 1)) {
      problems.push(`lifecycle ${row.lifecycle}, published ${row.published === 1}`);
    }
    if (c.effects.includes("withholdFromPublication") && (row.publication_hold === null || row.published === 1)) {
      problems.push(`hold ${row.publication_hold ?? "(none)"}, published ${row.published === 1}`);
    }
    // The attenuation row is the evidence. Without it the value is weakened for no recorded reason,
    // which is the failure mode this check exists to catch.
    for (const effect of c.effects) {
      const a = attenuationAt.get(`${row.spot_id}\u0000${effect}`);
      if (!a) { problems.push(`${effect}: no attestation row`); continue; }
      if (a.field !== ATTENUATED_FIELD[effect]) problems.push(`${effect}: attests field ${a.field}`);
      if (a.attestation_version !== TAITO_LIST_PAGE_ATTESTATION_VERSION) problems.push(`${effect}: attestation ${a.attestation_version}`);
      if (a.reference_kind !== TAITO_LIST_PAGE_REFERENCE_KIND || a.reference_url !== TAITO_LIST_PAGE_URL) {
        problems.push(`${effect}: reference ${a.reference_kind} ${a.reference_url}`);
      }
      if (a.checked_at !== TAITO_LIST_PAGE_CHECKED_AT) problems.push(`${effect}: checked_at ${a.checked_at}`);
      if (a.release_content_sha256 !== TAITO_REVIEWED_RELEASE.contentSha256
        || a.release_observed_on !== TAITO_REVIEWED_RELEASE.observedOn
        || a.release_source_url !== TAITO_REVIEWED_RELEASE.sourceUrl) {
        problems.push(`${effect}: attested against another release (${a.release_content_sha256.slice(0, 12)}…, ${a.release_observed_on ?? "(null)"})`);
      }
    }
    return problems.length === 0 ? [] : [`${c.csvName}: ${problems.join("; ")}`];
  });

  // The converse: nothing may be attenuated that the reviewed attestations do not call for.
  const attested = new Set(TAITO_LIST_PAGE_CONFLICTS.flatMap((c) => c.effects.map((e) => `${c.csvName}\u0000${e}`)));
  const unattested = attenuations.filter((a) => !attested.has(`${a.name ?? ""}\u0000${a.effect}`));

  const heldButPublished = reconciled.filter((r) => r.published === 1 && (r.publication_hold !== null || r.lifecycle !== "active"));

  const checks: Check[] = [];
  const check = (id: string, ok: boolean, detail: string) => checks.push({ id, status: ok ? "pass" : "fail", detail });

  const unreviewed = publishedSourceIds.filter((id) => !reviewed.has(id));
  check("published-sources-reviewed", unreviewed.length === 0,
    unreviewed.length === 0
      ? `every published source is in REVIEWED_SOURCES: ${publishedSourceIds.join(", ") || "(none)"}`
      : `published but not reviewed in code: ${unreviewed.join(", ")}`);

  const notApproved = publishedSourceIds.filter((id) => bySourceId.get(id)?.publication_status !== "approved");
  check("published-sources-approved", notApproved.length === 0,
    notApproved.length === 0 ? "every published source row is publication_status = approved"
      : `published without approval: ${notApproved.join(", ")}`);

  const drifted = publishedSourceIds.filter((id) => {
    const row = bySourceId.get(id);
    const r = reviewed.get(id);
    return !row || !r || row.display_name !== r.displayName || row.kind !== r.kind
      || row.license_name !== r.licenseName || row.license_url !== r.licenseUrl
      || row.attribution_text !== r.attributionText || row.publication_status !== r.publicationStatus;
  });
  check("registry-row-matches-reviewed-entry", drifted.length === 0,
    drifted.length === 0 ? "every published source row equals its REVIEWED_SOURCES entry (license, URL, attribution, status)"
      : `row differs from the reviewed entry: ${drifted.join(", ")}; run npm run local:registry`);

  const missingLicense = publishedSourceIds.filter((id) => {
    const row = bySourceId.get(id);
    return !row?.license_name || !row?.license_url || !row?.attribution_text;
  });
  check("published-sources-carry-license-and-attribution", missingLicense.length === 0,
    missingLicense.length === 0 ? "every published source has a license name, a license URL and attribution text"
      : `missing license name, URL or attribution: ${missingLicense.join(", ")}`);

  const tilesMissingAttribution = tileSizes.filter((t) => {
    if (t.spotCount === 0) return false;
    const body = JSON.parse(tiles.find((x) => x.tile_id === t.tileId)!.body_json);
    return body.sources.length === 0 || body.sources.some((s: { attributionText: string | null }) => !s.attributionText);
  });
  check("published-tiles-carry-attribution", tilesMissingAttribution.length === 0,
    tilesMissingAttribution.length === 0 ? `all ${occupied.length} non-empty tiles carry sources[].attributionText`
      : `tiles without attribution: ${tilesMissingAttribution.map((t) => t.tileId).join(", ")}`);

  const osmApproved = sources.filter((s) => s.kind === "osm" && s.publication_status === "approved");
  const osmPublished = publishedSourceIds.filter((id) => bySourceId.get(id)?.kind === "osm");
  check("osm-blocked", osmApproved.length === 0 && osmPublished.length === 0,
    osmApproved.length === 0 && osmPublished.length === 0
      ? "no osm-kind source is approved or published (docs/DATA_POLICY.md: ODbL obligations unreviewed)"
      : `osm data is approved or published: ${[...osmApproved.map((s) => s.source_id), ...osmPublished].join(", ")}`);

  check(`${TAITO_SOURCE_ID}-unstated-fields-stay-unknown`, taitoTyped.length === 0,
    taitoTyped.length === 0
      ? `all ${taitoSpots.length} spots derived from ${TAITO_SOURCE_ID} leave ${TAITO_UNRESOLVED_FIELDS.join(", ")} unknown/null with no provenance row, because that source states none of them`
      : `Taito-derived spots carrying a value that source does not state: ${taitoTyped.map((r) => r.spot_id).join(", ")}`);

  check(`${TAITO_SOURCE_ID}-existence-evidence-is-the-municipal-listing`, taitoHostEvidence.length === 0,
    taitoHostEvidence.length === 0
      ? `all ${taitoSpots.length} Taito-derived spots cite ${TAITO_EXISTENCE_RULE} for existence — the ward listing, never the convenience store or venue that hosts the spot`
      : `Taito-derived spots citing another existence rule: ${taitoHostEvidence.map((r) => `${r.spot_id} (${r.existence_rule})`).join(", ")}`);

  check(`${TAITO_SOURCE_ID}-list-page-conflicts-resolved-conservatively`, unresolvedConflicts.length === 0,
    unresolvedConflicts.length === 0
      ? `all ${TAITO_LIST_PAGE_CONFLICTS.length} reviewed contradictions with ${TAITO_LIST_PAGE_URL} are resolved subtractively, and each weakening is backed by a spot_field_attenuations row citing ${TAITO_LIST_PAGE_ATTESTATION_VERSION}, checked ${TAITO_LIST_PAGE_CHECKED_AT}, against the reviewed release ${TAITO_REVIEWED_RELEASE.contentSha256.slice(0, 12)}… observed ${TAITO_REVIEWED_RELEASE.observedOn}`
      : `contradictions not conservatively resolved: ${unresolvedConflicts.join(" | ")}`);

  check(`${TAITO_SOURCE_ID}-attenuations-are-attested`, unattested.length === 0,
    unattested.length === 0
      ? `every attenuation in spot_field_attenuations (${attenuations.length}) is called for by ${TAITO_LIST_PAGE_ATTESTATION_VERSION}`
      : `attenuations with no reviewed attestation: ${unattested.map((a) => `${a.name ?? a.spot_id} (${a.effect})`).join(", ")}`);

  check("published-spots-are-active-and-unheld", heldButPublished.length === 0,
    heldButPublished.length === 0
      ? "no published spot is temporarilyClosed, removed or under a publication hold"
      : `published despite a lifecycle or hold: ${heldButPublished.map((r) => r.name ?? "(unnamed)").join(", ")}`);

  const wrongZoom = tiles.filter((t) => t.z !== DATA_TILE_ZOOM);
  check("tiles-at-data-tile-zoom", wrongZoom.length === 0,
    wrongZoom.length === 0 ? `every tile is z${DATA_TILE_ZOOM}` : `tiles at another zoom: ${wrongZoom.map((t) => t.tile_id).join(", ")}`);

  const maxSpots = bySpots[0]?.spotCount ?? 0;
  const maxGzip = opts.gzip ? Math.max(0, ...tileSizes.map((t) => t.gzipBytes ?? 0)) : null;
  const withinThresholds = maxSpots <= TILE_REEVALUATION_SPOTS && (maxGzip === null || maxGzip <= TILE_REEVALUATION_GZIP_BYTES);
  check("tile-zoom-thresholds", withinThresholds,
    `max ${maxSpots} spots/tile (trigger ${TILE_REEVALUATION_SPOTS}), max ${maxGzip ?? "n/a"} gzip bytes/tile (trigger ${TILE_REEVALUATION_GZIP_BYTES})`);

  const spotsTableCount = await db.prepare(
    "SELECT count(*) AS n FROM spots WHERE lifecycle = 'active' AND merged_into IS NULL",
  ).first<{ n: number }>();

  return {
    generator: ANALYSIS_VERSION,
    generatedAt: opts.now,
    sources: {
      total: sources.length,
      approved: sources.filter((s) => s.publication_status === "approved").length,
      blocked: sources.filter((s) => s.publication_status === "blocked").length,
      publishedSourceIds,
      entries: sources.map((s) => ({
        sourceId: s.source_id,
        displayName: s.display_name,
        kind: s.kind,
        publicationStatus: s.publication_status,
        licenseName: s.license_name,
        licenseUrl: s.license_url,
        attributionText: s.attribution_text,
        reviewedInCode: reviewed.has(s.source_id),
      })),
    },
    releases: releases.map((r) => ({
      releaseId: r.release_id,
      sourceId: r.source_id,
      observedOn: r.observed_on,
      observedDaysAgo: r.observed_on === null ? null : days(`${r.observed_on}T00:00:00Z`, opts.now),
      fetchedAt: r.fetched_at,
      sourceUrl: r.source_url,
      httpLastModified: r.http_last_modified,
      contentSha256: r.content_sha256,
      byteLength: r.byte_length,
      recordCount: r.record_count,
      parserVersion: r.parser_version,
      status: r.status,
      isCurrent: r.is_current === 1,
    })),
    corpus: {
      publishedSpots: spots.length,
      activeSpotsInDatabase: spotsTableCount?.n ?? 0,
      publishedTiles: tiles.length,
      occupiedTiles: occupied.length,
      emptyTiles: tiles.length - occupied.length,
      spotsPerOccupiedTile: {
        min: perTile[0] ?? null,
        p50: percentile(perTile, 50),
        p90: percentile(perTile, 90),
        max: perTile[perTile.length - 1] ?? null,
      },
      nearestNeighbourMeters: nearestNeighbourMeters(spots),
      boundingBox: spots.length === 0 ? null : {
        minLatitude: latitudes[0],
        maxLatitude: latitudes[latitudes.length - 1],
        minLongitude: longitudes[0],
        maxLongitude: longitudes[longitudes.length - 1],
      },
    },
    freshness: {
      lastVerifiedAt: tally(spots.map((s) => s.lastVerifiedAt ?? "(null)")),
      oldest: verified[0] ?? null,
      newest: verified[verified.length - 1] ?? null,
      oldestDaysAgo: verified.length === 0 ? null : days(`${verified[0]}T00:00:00Z`, opts.now),
    },
    reconciliation: {
      attestationVersion: TAITO_LIST_PAGE_ATTESTATION_VERSION,
      secondPublicationUrl: TAITO_LIST_PAGE_URL,
      checkedAt: TAITO_LIST_PAGE_CHECKED_AT,
      referenceKind: TAITO_LIST_PAGE_REFERENCE_KIND,
      reviewedRelease: TAITO_REVIEWED_RELEASE,
      conflicts: TAITO_LIST_PAGE_CONFLICTS.length,
      effects: tally(TAITO_LIST_PAGE_CONFLICTS.flatMap((c) => [...c.effects])),
      attestedFieldAttenuations: attenuations.length,
      canonicalButWithheld: reconciled.filter((r) => r.published === 0).map((r) => ({
        name: r.name,
        lifecycle: r.lifecycle,
        publicationHold: r.publication_hold,
        effects: attenuations.filter((a) => a.spot_id === r.spot_id).map((a) => a.effect).sort(),
      })),
      unresolved: unresolvedConflicts,
    },
    evidenceQuality: tally(spots.map((s) => `${s.evidenceQualityVersion}:${s.evidenceQuality}`)),
    openingHoursStatus: openingHours,
    unknownRates: Object.fromEntries(
      Object.entries(unknownRates).map(([k, v]) => [k, { ...v, rate: rate(v.unknown, v.total) }]),
    ),
    tiles: tileSizes,
    largestTile: {
      bySpotCount: bySpots[0] ?? null,
      byRawBytes: byBytes[0] ?? null,
    },
    thresholds: {
      dataTileZoom: DATA_TILE_ZOOM,
      maxSpotsPerTile: maxSpots,
      maxRawBytesPerTile: byBytes[0]?.rawBytes ?? 0,
      maxGzipBytesPerTile: maxGzip,
      reevaluateAboveSpots: TILE_REEVALUATION_SPOTS,
      reevaluateAboveGzipBytes: TILE_REEVALUATION_GZIP_BYTES,
      withinThresholds,
    },
    checks,
    failedChecks: checks.filter((c) => c.status === "fail").length,
  };
}

export type CorpusAnalysis = Awaited<ReturnType<typeof analyzeCorpus>>;
