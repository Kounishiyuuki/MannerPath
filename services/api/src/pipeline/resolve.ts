// Reconciliation + resolution of a release by its source's adapter (ADR-0008). The resolver reads the
// release's normalized observations (./observe.ts), never raw source columns, and writes, as one batch:
// source entity + 'new' decision per record, one canonical spot per entity, field provenance, and
// the release marked applied/current. A later release of the same source goes through the
// cross-release matcher (./match.ts), and only for an adapter whose matcher is validated on two real
// releases (ADR-0008 decision 3); every other adapter's second release is refused.

import { type Db } from "../db.ts";
import { DATA_TILE_ZOOM, formatTileId, tileForCoordinate } from "../geo/tile.ts";
import { newSpotId as defaultNewSpotId } from "../spot-id.ts";
import { CROSS_RELEASE_MATCHER_VERSION, matchKeyStatements, planCrossReleaseMatch, readMatchInputs } from "./match.ts";
import { type StoredObservation, observeRelease } from "./observe.ts";
import type { FieldAttenuation, SourceAdapter, SourceObservation } from "./source-adapter.ts";

export const FIRST_RELEASE_MATCHER_VERSION = "first-release.v1";
// Evidence-quality vocabulary v1 has one value: listed in the current applied release of an
// official (municipal/government) source. Other values arrive with the sources that need them.
export const EVIDENCE_QUALITY_VERSION = "evidence-quality.v1";
export const OFFICIAL_LISTING = "officialListing";

// The only publication hold the schema knows (migration 0004). A new hold reason arrives with its
// own migration and attenuation effect.
const HOLD_FOR_WITHHELD = "locationSuperseded";

/**
 * The canonical values of one observation after the adapter's attenuations. Subtractive only: an
 * effect can turn parsed hours unparsed, an active lifecycle temporarilyClosed, or add a hold; it
 * never writes a value. The observation's raw hours text is kept either way.
 */
export function resolveObservation(o: SourceObservation, attenuations: readonly FieldAttenuation[]) {
  const effects = new Set(attenuations.map((a) => a.effect));
  return {
    ...o,
    // Only parsed hours can be weakened; unparsed or absent hours already claim nothing.
    openingHours: effects.has("hoursUnknown") && o.openingHours.status === "parsed"
      ? { status: "unparsed" as const, raw: o.openingHours.raw, parsed: null }
      : o.openingHours,
    lifecycle: effects.has("temporarilyClosed") && o.lifecycle === "active" ? "temporarilyClosed" as const : o.lifecycle,
    publicationHold: effects.has("withholdFromPublication") ? HOLD_FOR_WITHHELD : null,
    attenuations,
  };
}

export interface ResolveOptions {
  now: string;
  newSpotId?: () => string;
}

export type ResolveResult =
  // One spot id per record, in record order; a matched record's is its entity's existing spot.
  | { status: "resolved"; spotIds: string[] }
  | { status: "alreadyApplied" };

/**
 * Resolves `releaseId` with `adapter`. Fails closed before any write unless the release belongs to
 * the adapter's source and was parsed by the adapter's parser: a release filed under another source
 * (by an older ingest or by hand) is never resolved with rules reviewed for a different source.
 */
export async function resolveFirstRelease(db: Db, adapter: SourceAdapter, releaseId: number, opts: ResolveOptions): Promise<ResolveResult> {
  const newSpotId = opts.newSpotId ?? defaultNewSpotId;
  const release = await db.prepare(
    `SELECT r.source_id, r.observed_on, r.status, r.parser_version, r.content_sha256, r.source_url, s.kind
     FROM source_releases r JOIN sources s ON s.source_id = r.source_id WHERE r.release_id = ?`,
  ).bind(releaseId).first<ReleaseRow>();
  if (!release) throw new Error(`resolve: release ${releaseId} does not exist`);
  if (release.source_id !== adapter.registry.sourceId) {
    throw new Error(`resolve: release ${releaseId} belongs to ${release.source_id}, not to adapter source ${adapter.registry.sourceId}`);
  }
  if (release.parser_version !== adapter.parserVersion) {
    throw new Error(`resolve: release ${releaseId} was parsed by ${release.parser_version}, not ${adapter.parserVersion}`);
  }
  // Identity is checked before status, so a wrong adapter is refused in every state, applied included.
  if (release.status === "applied") {
    // A release applied before migration 0008 has no observations; cross-release matching will need
    // them. Backfilling is only the deterministic raw -> observation mapping: it touches no canonical
    // row and needs no re-review of the adapter's external attestations (assertResolvable), which
    // describe the web page as reviewed then, not now.
    await observeRelease(db, adapter, releaseId);
    return { status: "alreadyApplied" };
  }
  if (release.status !== "ingested") throw new Error(`resolve: release ${releaseId} is ${release.status}`);
  if (release.kind !== "municipal") {
    throw new Error(`resolve: ${OFFICIAL_LISTING} requires a municipal source, ${release.source_id} is ${release.kind}`);
  }
  const previous = await db.prepare(
    "SELECT release_id FROM source_releases WHERE source_id = ? AND status = 'applied' AND release_id <> ?",
  ).bind(release.source_id, releaseId).first<{ release_id: number }>();
  if (previous) {
    if (!adapter.crossReleaseValidated) {
      throw new Error(
        `resolve: ${release.source_id} already has applied release ${previous.release_id}; ` +
          "cross-release reconciliation is not implemented until a matcher is validated on two real releases",
      );
    }
    return resolveNextRelease(db, adapter, releaseId, release, opts);
  }

  // Observations are derived and re-derivable, so writing them is not a canonical effect: a release
  // refused below keeps its observations and nothing else.
  const observations = await observeRelease(db, adapter, releaseId);
  if (observations.length === 0) throw new Error(`resolve: release ${releaseId} has no records`);

  // Reviewed per-release decisions (for Taito, the ADR-0006 Issue #42 list-page attestations)
  // describe one exact release; the adapter fails closed before anything canonical is written.
  adapter.assertResolvable(
    { contentSha256: release.content_sha256, observedOn: release.observed_on, sourceUrl: release.source_url },
    observations.map((o) => o.observation),
  );

  const now = opts.now;
  const statements = [];
  const spotIds: string[] = [];
  for (const record of observations) {
    const spotId = newSpotId();
    spotIds.push(spotId);
    statements.push(...newSpotStatements(db, adapter, releaseId, release, record, spotId, now,
      FIRST_RELEASE_MATCHER_VERSION, "first known release of this source; no cross-release match attempted"));
  }
  statements.push(
    db.prepare("UPDATE source_releases SET status = 'applied', applied_at = ?, is_current = 1 WHERE release_id = ?").bind(now, releaseId),
  );
  await db.batch(statements);
  return { status: "resolved", spotIds };
}

interface ReleaseRow {
  source_id: string; observed_on: string | null; status: string; parser_version: string;
  content_sha256: string; source_url: string; kind: string;
}

/** A new source entity, its decision, and its new canonical spot with provenance and attenuations. */
function newSpotStatements(
  db: Db, adapter: SourceAdapter, releaseId: number, release: ReleaseRow, record: StoredObservation,
  spotId: string, now: string, matcherVersion: string, note: string,
) {
  const resolverVersion = adapter.resolverVersion;
  const ref = adapter.attenuationReference;
  const r = resolveObservation(record.observation, adapter.attenuate(record.observation));
  const tile = tileForCoordinate(r.latitude, r.longitude, DATA_TILE_ZOOM);
  return [
    db.prepare(
      `INSERT INTO source_entities (source_entity_id, source_id, created_at)
       VALUES ((SELECT COALESCE(MAX(source_entity_id), 0) + 1 FROM source_entities), ?, ?)`,
    ).bind(release.source_id, now),
    db.prepare(
      `INSERT INTO source_record_entities (record_id, release_id, source_entity_id, method, matcher_version, decided_at, note)
       VALUES (?, ?, (SELECT MAX(source_entity_id) FROM source_entities), 'new', ?, ?, ?)`,
    ).bind(record.recordId, releaseId, matcherVersion, now, note),
    db.prepare(
      `INSERT INTO spots (spot_id, name, latitude, longitude, tile_z, tile_x, tile_y, tile_id, spot_type,
         supports_paper, supports_heated, opening_hours_raw, opening_hours_json, opening_hours_status,
         lifecycle, publication_hold, evidence_quality, evidence_quality_version, last_verified_at,
         resolver_version, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'unknown', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(spotId, r.name, r.latitude, r.longitude, tile.z, tile.x, tile.y, formatTileId(tile),
      r.supportsPaper, r.supportsHeated, r.openingHours.raw,
      r.openingHours.parsed ? JSON.stringify(r.openingHours.parsed) : null, r.openingHours.status,
      r.lifecycle, r.publicationHold, OFFICIAL_LISTING, EVIDENCE_QUALITY_VERSION, release.observed_on, resolverVersion, now, now),
    db.prepare(
      `INSERT INTO spot_source_entities (source_entity_id, spot_id, method, linked_at, resolver_version)
       VALUES ((SELECT source_entity_id FROM source_record_entities WHERE record_id = ?), ?, 'created', ?, ?)`,
    ).bind(record.recordId, spotId, now, resolverVersion),
    // Copied from the observation, still citing the raw record and its columns: the observation
    // is how the values were normalized, the record is what was stated.
    ...r.provenance.map((p) =>
      db.prepare(
        `INSERT INTO spot_field_provenance (spot_id, field, record_id, source_columns_json, rule, resolver_version, resolved_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      ).bind(spotId, p.field, record.recordId, JSON.stringify(p.columns), p.rule, resolverVersion, now),
    ),
    // The weakening itself, with the evidence for it. It never edits the provenance row above,
    // which keeps describing what the CSV stated; and it carries the reviewed release fingerprint,
    // so a later reader can tell which file the decision was reviewed against.
    ...r.attenuations.map((a) =>
      db.prepare(
        `INSERT INTO spot_field_attenuations (spot_id, field, effect, attestation_version, reference_kind,
           reference_url, checked_at, release_id, release_content_sha256, release_observed_on,
           release_source_url, resolver_version, applied_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).bind(spotId, a.field, a.effect, ref.attestationVersion, ref.referenceKind,
        ref.referenceUrl, ref.checkedAt, releaseId, release.content_sha256,
        release.observed_on, release.source_url, resolverVersion, now),
    ),
  ];
}

/**
 * Applies a later release of a source whose previous applied release is current, through the
 * cross-release matcher. Everything is refused before any canonical write unless every record is
 * raw_identical or new and every previous entity is matched: ambiguous records wait for the review
 * queue (ADR-0008 decision 8), and a previous entity no record matched is a disappearance
 * candidate, which only a completeness-aware removal step may act on (decision 5).
 *
 * A matched record keeps its entity and its spot: the spot id, created_at and link never change.
 * Its values are identical by construction (same raw values, same mapping), so only the evidence
 * moves to the new record: provenance cites it and last_verified_at becomes its observed_on.
 */
async function resolveNextRelease(
  db: Db, adapter: SourceAdapter, releaseId: number, release: ReleaseRow, opts: ResolveOptions,
): Promise<ResolveResult> {
  const newSpotId = opts.newSpotId ?? defaultNewSpotId;
  const now = opts.now;
  const current = await db.prepare(
    "SELECT release_id, observed_on FROM source_releases WHERE source_id = ? AND is_current = 1",
  ).bind(release.source_id).first<{ release_id: number; observed_on: string | null }>();
  if (!current) throw new Error(`resolve: ${release.source_id} has applied releases but none is current`);
  // last_verified_at is the newest accepted existence evidence, so evidence must move forward.
  if (current.observed_on === null || release.observed_on === null || release.observed_on <= current.observed_on) {
    throw new Error(
      `resolve: release ${releaseId} (observed ${release.observed_on}) is not newer than current release ` +
        `${current.release_id} (observed ${current.observed_on})`,
    );
  }

  const observations = await observeRelease(db, adapter, releaseId);
  if (observations.length === 0) throw new Error(`resolve: release ${releaseId} has no records`);
  const previousObservations = await observeRelease(db, adapter, current.release_id);
  adapter.assertResolvable(
    { contentSha256: release.content_sha256, observedOn: release.observed_on, sourceUrl: release.source_url },
    observations.map((o) => o.observation),
  );

  const { previous, next } = await readMatchInputs(db, current.release_id, releaseId);
  if (previous.length !== previousObservations.length) {
    throw new Error(`resolve: current release ${current.release_id} has records without an entity and spot`);
  }
  const plan = planCrossReleaseMatch(previous, next);
  if (plan.ambiguous.length > 0) {
    throw new Error(
      `resolve: release ${releaseId} has ${plan.ambiguous.length} ambiguous record(s) (first: record ` +
        `${plan.ambiguous[0].recordId}, ${plan.ambiguous[0].reason}); not applied until reviewed`,
    );
  }
  if (plan.unmatchedPreviousEntityIds.length > 0) {
    throw new Error(
      `resolve: release ${releaseId} leaves ${plan.unmatchedPreviousEntityIds.length} previous entit(ies) unmatched ` +
        `(${plan.unmatchedPreviousEntityIds.join(", ")}); disappearance is not applied without completeness and review`,
    );
  }

  const previousByRecord = new Map(previous.map((p) => [p.recordId, p]));
  const previousObservationByRecord = new Map(previousObservations.map((o) => [o.recordId, o.observation]));
  const observationByRecord = new Map(observations.map((o) => [o.recordId, o]));
  const statements = [...matchKeyStatements(db, [...previous, ...next].map((r) => r.recordId), now)];
  const spotIds: string[] = [];
  for (const decision of plan.decisions) {
    const record = observationByRecord.get(decision.recordId)!;
    if (decision.method === "new") {
      const spotId = newSpotId();
      spotIds.push(spotId);
      statements.push(...newSpotStatements(db, adapter, releaseId, release, record, spotId, now, CROSS_RELEASE_MATCHER_VERSION,
        `no record of release ${current.release_id} matched, and every entity of it is matched by another record`));
      continue;
    }
    const prior = previousByRecord.get(decision.previousRecordId)!;
    await assertEvidenceCanMove(db, adapter, prior.spotId, prior.recordId, record, previousObservationByRecord.get(prior.recordId));
    spotIds.push(prior.spotId);
    statements.push(
      db.prepare(
        `INSERT INTO source_record_entities (record_id, release_id, source_entity_id, method, matcher_version, decided_at, note)
         VALUES (?, ?, ?, 'raw_identical', ?, ?, ?)`,
      ).bind(record.recordId, releaseId, decision.sourceEntityId, CROSS_RELEASE_MATCHER_VERSION, now,
        `raw values identical to record ${prior.recordId} of release ${current.release_id}`),
      db.prepare(
        "UPDATE spot_field_provenance SET record_id = ?, resolver_version = ?, resolved_at = ? WHERE spot_id = ? AND record_id = ?",
      ).bind(record.recordId, adapter.resolverVersion, now, prior.spotId, prior.recordId),
      db.prepare(
        "UPDATE spots SET last_verified_at = ?, resolver_version = ?, updated_at = ? WHERE spot_id = ?",
      ).bind(release.observed_on, adapter.resolverVersion, now, prior.spotId),
    );
  }
  statements.push(
    // The one-current index needs the old flag cleared first; the old release stays applied evidence.
    db.prepare("UPDATE source_releases SET is_current = 0 WHERE release_id = ?").bind(current.release_id),
    db.prepare("UPDATE source_releases SET status = 'applied', applied_at = ?, is_current = 1 WHERE release_id = ?").bind(now, releaseId),
  );
  await db.batch(statements);
  return { status: "resolved", spotIds };
}

/**
 * Moving a matched spot's evidence to the new record is only honest when nothing but the evidence
 * moves: the values re-derive identically, every provenance row cites the previous record, and no
 * attenuation is involved (attenuation rows are bound to the exact release they were reviewed
 * against and are immutable, so carrying or re-applying them is a separate reviewed step).
 */
async function assertEvidenceCanMove(
  db: Db, adapter: SourceAdapter, spotId: string, previousRecordId: number, record: StoredObservation,
  previous: SourceObservation | undefined,
) {
  if (JSON.stringify(previous) !== JSON.stringify(record.observation)) {
    throw new Error(`resolve: record ${record.recordId} is raw-identical to spot ${spotId}'s record but observes differently`);
  }
  if (adapter.attenuate(record.observation).length > 0) {
    throw new Error(`resolve: record ${record.recordId} would be attenuated; carrying attenuations across releases is not implemented`);
  }
  const spot = await db.prepare(
    `SELECT s.merged_into, s.publication_hold,
       (SELECT count(*) FROM spot_field_attenuations a WHERE a.spot_id = s.spot_id) AS attenuations,
       (SELECT count(*) FROM spot_field_provenance p WHERE p.spot_id = s.spot_id AND p.record_id <> ?) AS foreign_provenance
     FROM spots s WHERE s.spot_id = ?`,
  ).bind(previousRecordId, spotId).first<{ merged_into: string | null; publication_hold: string | null; attenuations: number; foreign_provenance: number }>();
  if (!spot || spot.merged_into !== null || spot.publication_hold !== null || spot.attenuations > 0) {
    throw new Error(`resolve: spot ${spotId} is merged, held or attenuated; its evidence is not moved automatically`);
  }
  if (spot.foreign_provenance > 0) {
    throw new Error(`resolve: spot ${spotId} has provenance from another record than ${previousRecordId}`);
  }
}
