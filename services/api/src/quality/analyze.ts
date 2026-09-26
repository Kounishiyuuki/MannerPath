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
import { SOURCE_ADAPTERS } from "../pipeline/adapters.ts";
import { REVIEWED_SOURCES } from "../pipeline/registry.ts";
import type { QualityCheck, SourceAdapter } from "../pipeline/source-adapter.ts";
import { TileBodyV1 } from "../tiles/dto.ts";

export const ANALYSIS_VERSION = "nationwide-data-quality.v1";

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
  /** Explicit adapters allow isolated multi-source analysis in tests. Approval remains registry-controlled. */
  adapters?: readonly SourceAdapter[];
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

/** Null means malformed, nonexistent on the calendar, or later than the reference instant. */
function freshAgeDays(value: string, now: string): number | null {
  const dateOnly = /^\d{4}-\d{2}-\d{2}$/.test(value);
  if (!dateOnly && !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(value)) return null;
  const from = Date.parse(dateOnly ? `${value}T00:00:00Z` : value);
  const to = Date.parse(now);
  if (!Number.isFinite(from) || !Number.isFinite(to) || from > to) return null;
  const normalized = new Date(from).toISOString();
  const canonical = value.replace(/\.(\d{1,2})Z$/, (_match, fraction: string) => `.${fraction.padEnd(3, "0")}Z`);
  if (dateOnly ? normalized.slice(0, 10) !== value
    : normalized !== (value.includes(".") ? canonical : value.replace("Z", ".000Z"))) return null;
  return Math.round((to - from) / 86_400_000);
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

  const checks: QualityCheck[] = [];
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

  const qualityBySource = new Map<string, { checks: QualityCheck[]; reconciliation: unknown }>();
  for (const adapter of opts.adapters ?? SOURCE_ADAPTERS) {
    if (!adapter.qualityPolicy) continue;
    const result = await adapter.qualityPolicy.analyze(db, adapter.registry.sourceId);
    qualityBySource.set(adapter.registry.sourceId, result);
    checks.push(...result.checks);
  }

  const { results: heldButPublished } = await db.prepare(`SELECT s.name FROM spots s JOIN tile_snapshot_spots t ON t.spot_id = s.spot_id
    WHERE s.publication_hold IS NOT NULL OR s.lifecycle <> 'active' ORDER BY s.spot_id`).all<{ name: string | null }>();
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
  const canonicalRows = await db.prepare(
    "SELECT count(*) AS n FROM spots WHERE merged_into IS NULL",
  ).first<{ n: number }>();

  const { results: canonicalBySource } = await db.prepare(`SELECT rel.source_id, count(DISTINCT p.spot_id) AS n
    FROM spot_field_provenance p JOIN source_records r ON r.record_id = p.record_id
    JOIN source_releases rel ON rel.release_id = r.release_id WHERE p.field = 'existence'
    GROUP BY rel.source_id ORDER BY rel.source_id`).all<{ source_id: string; n: number }>();
  const canonicalCount = new Map(canonicalBySource.map((r) => [r.source_id, r.n]));
  const sourceMetrics = sources.map((source) => {
    const sourceSpots = spots.filter((spot) => spot.sourceIds.includes(source.source_id));
    const currentRelease = releases.find((release) => release.source_id === source.source_id && release.is_current === 1);
    const verifiedRecent = sourceSpots.filter((spot) => {
      const age = spot.lastVerifiedAt === null ? null : freshAgeDays(spot.lastVerifiedAt, opts.now);
      return age !== null && age <= 365;
    }).length;
    return {
      sourceId: source.source_id,
      publicationStatus: source.publication_status,
      canonicalSpots: canonicalCount.get(source.source_id) ?? 0,
      publishedSpots: sourceSpots.length,
      currentReleaseFetch: currentRelease === undefined ? null : {
        releaseId: currentRelease.release_id,
        fetchedAt: currentRelease.fetched_at,
        within30Days: (freshAgeDays(currentRelease.fetched_at, opts.now) ?? Infinity) <= 30,
      },
      publishedWithin365Days: { count: verifiedRecent, total: sourceSpots.length, rate: rate(verifiedRecent, sourceSpots.length) },
      unknownRates: Object.fromEntries(Object.keys(unknownRates).map((field) => {
        const unknown = sourceSpots.filter((spot) => field === 'openingHours' ? spot.openingHours.status !== 'parsed'
          : spot[field as keyof typeof spot] === 'unknown').length;
        return [field, { unknown, total: sourceSpots.length, rate: rate(unknown, sourceSpots.length) }];
      })),
      evidenceQuality: tally(sourceSpots.map((spot) => `${spot.evidenceQualityVersion}:${spot.evidenceQuality}`)),
      checks: qualityBySource.get(source.source_id)?.checks ?? [],
      reconciliation: qualityBySource.get(source.source_id)?.reconciliation ?? null,
    };
  });
  const recent = spots.filter((spot) => {
    const age = spot.lastVerifiedAt === null ? null : freshAgeDays(spot.lastVerifiedAt, opts.now);
    return age !== null && age <= 365;
  }).length;
  const invalidPublishedDates = spots.filter((spot) =>
    spot.lastVerifiedAt !== null && freshAgeDays(spot.lastVerifiedAt, opts.now) === null);
  const reviewedCurrentReleases = sourceMetrics.filter((source) => {
    const registry = reviewed.get(source.sourceId);
    return registry?.publicationStatus === "approved" && source.publicationStatus === "approved"
      && source.currentReleaseFetch !== null;
  });
  const invalidCurrentFetches = sourceMetrics.filter((source) => source.currentReleaseFetch !== null).filter((source) =>
    freshAgeDays(source.currentReleaseFetch!.fetchedAt, opts.now) === null);
  check("freshness-timestamps-valid-and-not-future",
    invalidPublishedDates.length === 0 && invalidCurrentFetches.length === 0,
    invalidPublishedDates.length === 0 && invalidCurrentFetches.length === 0
      ? "published verification dates and current-release fetch dates are valid and not future-dated"
      : `${invalidPublishedDates.length} published spots and ${invalidCurrentFetches.length} current releases have invalid or future freshness dates`);
  const { results: publishedByRelease } = await db.prepare(`SELECT rel.release_id, count(DISTINCT t.spot_id) AS n
    FROM tile_snapshot_spots t JOIN spot_field_provenance p ON p.spot_id = t.spot_id AND p.field = 'existence'
    JOIN source_records r ON r.record_id = p.record_id JOIN source_releases rel ON rel.release_id = r.release_id
    GROUP BY rel.release_id ORDER BY rel.release_id`).all<{ release_id: number; n: number }>();
  const releasePublishedCount = new Map(publishedByRelease.map((r) => [r.release_id, r.n]));
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
      publishedSpots: releasePublishedCount.get(r.release_id) ?? 0,
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
    nationwide: {
      sourceCoverage: { registered: sources.length, approved: sources.filter((source) => source.publication_status === 'approved').length, published: publishedSourceIds.length },
      regionalCoverage: { status: 'notComputableYet', reason: 'No reviewed prefecture/municipality assignment or station reference dataset' },
      stationCoverage: { status: 'notComputableYet', reason: 'Top 50/top 300 station reference dataset requires license review' },
      populationCoverage: { status: 'notComputableYet', reason: 'DID/population reference dataset requires license review' },
      freshness: {
        publishedWithin365Days: recent, publishedTotal: spots.length, rate: rate(recent, spots.length),
        reviewedCurrentReleaseFetchedWithin30Days: reviewedCurrentReleases.filter((source) => source.currentReleaseFetch!.within30Days).length,
        reviewedCurrentReleaseCount: reviewedCurrentReleases.length,
      },
      publishedSpots: spots.length,
      canonicalSpots: canonicalRows?.n ?? 0,
      evidenceQuality: tally(spots.map((spot) => `${spot.evidenceQualityVersion}:${spot.evidenceQuality}`)),
      unknownRates: Object.fromEntries(Object.entries(unknownRates).map(([field, value]) => [field, { ...value, rate: rate(value.unknown, value.total) }])),
    },
    sourceMetrics,
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
