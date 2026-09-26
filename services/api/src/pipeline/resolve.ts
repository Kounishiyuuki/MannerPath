// Reconciliation + resolution of a release by its source's adapter (ADR-0008). The resolver reads the
// release's normalized observations (./observe.ts), never raw source columns, and writes, as one batch:
// source entity + 'new' decision per record, one canonical spot per entity, field provenance, and
// the release marked applied/current. A later release of the same source goes through the
// cross-release matcher (./match.ts), and only for an adapter whose matcher is validated on two real
// releases (ADR-0008 decision 3); every other adapter's second release is refused.

import { type Db } from "../db.ts";
import { DATA_TILE_ZOOM, formatTileId, tileForCoordinate } from "../geo/tile.ts";
import { newSpotId as defaultNewSpotId } from "../spot-id.ts";
import { CROSS_RELEASE_MATCHER_VERSION, type PreviousRecord, matchKeyStatements, planCrossReleaseMatch, readMatchInputs } from "./match.ts";
import { type StoredObservation, observeRelease } from "./observe.ts";
import { relocationCandidate, sameCoordinate } from "./relocation.ts";
import { type CandidateContext, crossReleaseCandidates, persistReviewItems } from "./review-queue.ts";
import {
  type AmbiguousReview, type EffectiveDecision, REVIEW_MATCH_APPLICATION_VERSION, REVIEW_REMOVAL_RESOLUTION_VERSION, type RemovalReview, type ResolvedPreviousEntities,
  ReviewedMatchError, planReviewedMatch, resolvePreviousEntities,
} from "./reviewed-match.ts";
import { type FieldAttenuation, type SourceAdapter, type SourceObservation, sourceCompleteness } from "./source-adapter.ts";

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
  | { status: "alreadyApplied" }
  // Nothing canonical was written and the release stays ingested; the ids are the review items
  // (ADR-0008 decision 8) that must be decided and applied first. Re-running returns the same ids.
  | { status: "needsReview"; reviewItemIds: number[] };

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
 * cross-release matcher and the latest review decisions on its ambiguousMatch items (the effective
 * reviewed plan, ./reviewed-match.ts). Nothing canonical is written unless every record is
 * raw_identical, new, reviewed matchedToEntity or reviewed confirmedNew, and every previous entity is
 * continued by a record or its spot was removed by an applied reviewed removal (audited in
 * review_removal_resolutions in the same batch; the resolver itself never removes): otherwise the open ambiguous records and unresolved previous entities
 * (disappearance candidates; removal candidates only for a complete source, decision 5) are stored
 * in the review queue (ADR-0008 decision 8) and the release stays ingested. Once every ambiguous record
 * is decided, a reviewed match whose coordinate changed is stored as a relocationCandidate (ADR-0009)
 * and keeps the release ingested too, whatever that item's own decision: applying a relocation is not
 * implemented, so no coordinate, hold, link, provenance or release state is written for it.
 *
 * A matched record keeps its entity and its spot: the spot id, created_at and link never change.
 * Only the evidence moves to the new record: provenance cites it and last_verified_at becomes its
 * observed_on. For raw_identical the values are identical by construction; a reviewed match is
 * applied only when they are too (a reviewed same entity is not an approved field update), and every
 * applied review decision is recorded in review_match_applications in the same batch.
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
  // Candidates are review state, not canonical effect: no spot, link, provenance, hold, match key or
  // release status is written, and a disappearance is removal evidence only for a complete source.
  const completeness = sourceCompleteness(adapter);
  const ctx = {
    sourceId: release.source_id, releaseId, releaseContentSha256: release.content_sha256,
    previousReleaseId: current.release_id, matcherVersion: CROSS_RELEASE_MATCHER_VERSION, completeness,
  };
  const candidateIds = plan.ambiguous.length > 0 || plan.unmatchedPreviousEntityIds.length > 0
    ? await persistReviewItems(db, ctx, crossReleaseCandidates(plan.ambiguous, plan.unmatchedPreviousEntityIds, previous, completeness), now)
    : [];
  // Items are read by this exact comparison, so an item raised against another previous release
  // (the current release changed since) is never used: its record is simply open here.
  const effective = planReviewedMatch(plan, previous, next, await readAmbiguousReviews(db, candidateIds.slice(0, plan.ambiguous.length)));
  // A previous entity left over once every ambiguity is decided (e.g. after confirmedNew) is a
  // disappearance candidate like any other; the same identity yields the same item. It is resolved
  // only by a reviewed removal already applied to its spot (Issue #89).
  const residualIds = effective.unresolvedPreviousEntityIds.length > 0
    ? await persistReviewItems(db, ctx, crossReleaseCandidates([], effective.unresolvedPreviousEntityIds, previous, completeness), now)
    : [];
  const removalReviews = await readRemovalReviews(db, residualIds);
  const previousEntities: ResolvedPreviousEntities = resolvePreviousEntities(effective, removalReviews);
  // An open ambiguity is answered first: relocation needs the identity it would establish.
  if (effective.openReviewItemIds.length > 0) return { status: "needsReview", reviewItemIds: effective.openReviewItemIds };

  const previousByRecord = new Map(previous.map((p) => [p.recordId, p]));
  const previousObservationByRecord = new Map(previousObservations.map((o) => [o.recordId, o.observation]));
  const observationByRecord = new Map(observations.map((o) => [o.recordId, o]));
  const relocationItemIds = await persistRelocationCandidates(db, ctx, effective.decisions, previousByRecord, previousObservationByRecord,
    observationByRecord, current, now);
  if (relocationItemIds.length > 0 || previousEntities.unresolved.length > 0) {
    const unresolvedItemIds = removalReviews.filter((r) => previousEntities.unresolved.includes(r.sourceEntityId)).map((r) => r.reviewItemId);
    return { status: "needsReview", reviewItemIds: [...unresolvedItemIds, ...relocationItemIds] };
  }
  if (effective.decisions.some((d) => d.method === "reviewed_match" || d.method === "reviewed_new")
    || previousEntities.resolvedByReviewedRemoval.length > 0) {
    await assertNoCompetingRelease(db, release.source_id, releaseId, current);
  }

  const statements = [...matchKeyStatements(db, [...previous, ...next].map((r) => r.recordId), now)];
  const spotIds: string[] = [];
  // Written before the decision it audits: its trigger re-checks, inside the batch, that the decision
  // is still the item's latest and the comparison still current, and a manual decision needs it.
  const application = (d: { recordId: number; reviewItemId: number; reviewDecisionId: number }, decision: string, entityId: number | null) =>
    db.prepare(
      `INSERT INTO review_match_applications (review_item_id, review_decision_id, decision, record_id, release_id,
         source_entity_id, executor_version, applied_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(d.reviewItemId, d.reviewDecisionId, decision, d.recordId, releaseId, entityId, REVIEW_MATCH_APPLICATION_VERSION, now);
  for (const decision of effective.decisions) {
    const record = observationByRecord.get(decision.recordId)!;
    if (decision.method === "new" || decision.method === "reviewed_new") {
      const spotId = newSpotId();
      spotIds.push(spotId);
      if (decision.method === "reviewed_new") statements.push(application(decision, "confirmedNew", null));
      statements.push(...newSpotStatements(db, adapter, releaseId, release, record, spotId, now, CROSS_RELEASE_MATCHER_VERSION,
        decision.method === "new"
          ? `no record of release ${current.release_id} matched, and every entity of it is matched by another record`
          : `review decision ${decision.reviewDecisionId} (item ${decision.reviewItemId}): confirmedNew`));
      continue;
    }
    const prior = previousByRecord.get(decision.previousRecordId)!;
    const previousObservation = previousObservationByRecord.get(prior.recordId);
    await assertEvidenceCanMove(db, adapter, prior.spotId, prior.recordId, record, previousObservation);
    spotIds.push(prior.spotId);
    if (decision.method === "reviewed_match") statements.push(application(decision, "matchedToEntity", decision.sourceEntityId));
    statements.push(
      db.prepare(
        `INSERT INTO source_record_entities (record_id, release_id, source_entity_id, method, matcher_version, decided_at, note)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      ).bind(record.recordId, releaseId, decision.sourceEntityId, decision.method === "raw_identical" ? "raw_identical" : "manual",
        CROSS_RELEASE_MATCHER_VERSION, now, decision.method === "raw_identical"
          ? `raw values identical to record ${prior.recordId} of release ${current.release_id}`
          : `review decision ${decision.reviewDecisionId} (item ${decision.reviewItemId}): matchedToEntity, continuing record ${prior.recordId} of release ${current.release_id}`),
      db.prepare(
        "UPDATE spot_field_provenance SET record_id = ?, resolver_version = ?, resolved_at = ? WHERE spot_id = ? AND record_id = ?",
      ).bind(record.recordId, adapter.resolverVersion, now, prior.spotId, prior.recordId),
      db.prepare(
        "UPDATE spots SET last_verified_at = ?, resolver_version = ?, updated_at = ? WHERE spot_id = ?",
      ).bind(release.observed_on, adapter.resolverVersion, now, prior.spotId),
    );
  }
  // The removed entity has no record in this release, so it gets no record decision: only the audit
  // of the applied removal it rests on, whose trigger re-checks that removal inside the batch.
  for (const r of previousEntities.resolvedByReviewedRemoval) {
    statements.push(db.prepare(
      `INSERT INTO review_removal_resolutions (release_id, previous_release_id, review_item_id, review_decision_id,
         review_removal_application_id, source_entity_id, spot_id, resolver_version, applied_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(releaseId, current.release_id, r.reviewItemId, r.reviewDecisionId, r.reviewRemovalApplicationId, r.sourceEntityId, r.spotId,
      REVIEW_REMOVAL_RESOLUTION_VERSION, now));
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
 * Checks every reviewed match before anything is applied. One whose coordinate is unchanged must keep
 * every value (assertReviewedMatchKeepsValues); one whose coordinate changed becomes a relocationCandidate
 * item, stored as review state only, and its ids are returned. Its spot must be active, unmerged and not
 * held: a held spot is refused (carry-forward is not implemented) and its hold is left as it is.
 */
async function persistRelocationCandidates(
  db: Db, ctx: CandidateContext, decisions: readonly EffectiveDecision[], previousByRecord: ReadonlyMap<number, PreviousRecord>,
  previousObservationByRecord: ReadonlyMap<number, SourceObservation>, observationByRecord: ReadonlyMap<number, StoredObservation>,
  current: { release_id: number; observed_on: string | null }, now: string,
): Promise<number[]> {
  const items = [];
  for (const d of decisions) {
    if (d.method !== "reviewed_match") continue;
    const prior = previousByRecord.get(d.previousRecordId)!;
    const record = observationByRecord.get(d.recordId)!;
    const previousObservation = previousObservationByRecord.get(prior.recordId);
    if (!previousObservation || sameCoordinate(previousObservation, record.observation)) {
      await assertReviewedMatchKeepsValues(db, prior.spotId, record, previousObservation);
      continue;
    }
    const spot = await db.prepare("SELECT lifecycle, merged_into, publication_hold FROM spots WHERE spot_id = ?")
      .bind(prior.spotId).first<{ lifecycle: string; merged_into: string | null; publication_hold: string | null }>();
    if (!spot || spot.lifecycle !== "active" || spot.merged_into !== null) {
      throw new ReviewedMatchError(`resolve: record ${record.recordId} is reviewed as spot ${prior.spotId} at another coordinate, but the spot is ${spot?.lifecycle ?? "missing"}${spot?.merged_into ? ", merged" : ""}; a relocation needs an active, unmerged spot`);
    }
    if (spot.publication_hold !== null) {
      throw new ReviewedMatchError(`resolve: record ${record.recordId} is reviewed as spot ${prior.spotId} at another coordinate, but the spot is held (${spot.publication_hold}); carry-forward is not implemented`);
    }
    items.push(relocationCandidate({
      recordId: record.recordId, sourceEntityId: d.sourceEntityId, spotId: prior.spotId, previousRecordId: prior.recordId,
      reviewItemId: d.reviewItemId, reviewDecisionId: d.reviewDecisionId, previous: previousObservation, next: record.observation,
    }, ctx.matcherVersion, await previousContentSha256(db, ctx.previousReleaseId)));
  }
  if (items.length === 0) return [];
  await assertNoCompetingRelease(db, ctx.sourceId, ctx.releaseId, current);
  return persistReviewItems(db, ctx, items, now);
}

const previousContentSha256 = async (db: Db, releaseId: number) =>
  (await db.prepare("SELECT content_sha256 FROM source_releases WHERE release_id = ?").bind(releaseId).first<{ content_sha256: string }>())!.content_sha256;

/** The stored ambiguousMatch items `ids` with their latest decision (largest review_decision_id). */
async function readAmbiguousReviews(db: Db, ids: readonly number[]): Promise<AmbiguousReview[]> {
  const reviews: AmbiguousReview[] = [];
  for (const id of ids) {
    const row = await db.prepare(
      `SELECT i.kind, i.record_id, i.details_json, d.review_decision_id, d.decision, d.decision_version, d.source_entity_id
       FROM review_items i
       LEFT JOIN review_decisions d ON d.review_decision_id =
         (SELECT max(review_decision_id) FROM review_decisions WHERE review_item_id = i.review_item_id)
       WHERE i.review_item_id = ?`,
    ).bind(id).first<{
      kind: string; record_id: number; details_json: string; review_decision_id: number | null;
      decision: string | null; decision_version: string | null; source_entity_id: number | null;
    }>();
    if (!row || row.kind !== "ambiguousMatch") throw new ReviewedMatchError(`resolve: review item ${id} is not an ambiguousMatch item`);
    reviews.push({
      reviewItemId: id, recordId: row.record_id,
      candidateEntityIds: (JSON.parse(row.details_json) as { candidateEntityIds: number[] }).candidateEntityIds,
      latest: row.review_decision_id === null ? null : {
        reviewDecisionId: row.review_decision_id, decision: row.decision!, decisionVersion: row.decision_version!,
        sourceEntityId: row.source_entity_id,
      },
    });
  }
  return reviews;
}

/** The stored disappearance/removal items `ids` with their latest decision, their spot's removal application and links. */
async function readRemovalReviews(db: Db, ids: readonly number[]): Promise<RemovalReview[]> {
  const reviews: RemovalReview[] = [];
  for (const id of ids) {
    const row = await db.prepare(
      `SELECT i.kind, i.source_completeness, i.source_entity_id, i.spot_id, d.review_decision_id, d.decision, d.decision_version,
         s.lifecycle, s.merged_into, a.review_removal_application_id, a.review_item_id AS application_item_id,
         a.review_decision_id AS application_decision_id
       FROM review_items i
       JOIN spots s ON s.spot_id = i.spot_id
       LEFT JOIN review_decisions d ON d.review_decision_id =
         (SELECT max(review_decision_id) FROM review_decisions WHERE review_item_id = i.review_item_id)
       LEFT JOIN review_removal_applications a ON a.spot_id = i.spot_id
       WHERE i.review_item_id = ?`,
    ).bind(id).first<{
      kind: string; source_completeness: string; source_entity_id: number; spot_id: string;
      review_decision_id: number | null; decision: string | null; decision_version: string | null;
      lifecycle: string; merged_into: string | null; review_removal_application_id: number | null;
      application_item_id: number | null; application_decision_id: number | null;
    }>();
    if (!row) throw new Error(`resolve: review item ${id} is not a disappearance/removal item with a spot`);
    const { results: links } = await db.prepare("SELECT source_entity_id FROM spot_source_entities WHERE spot_id = ? ORDER BY source_entity_id")
      .bind(row.spot_id).all<{ source_entity_id: number }>();
    reviews.push({
      reviewItemId: id, kind: row.kind, sourceCompleteness: row.source_completeness, sourceEntityId: row.source_entity_id, spotId: row.spot_id,
      latest: row.review_decision_id === null ? null
        : { reviewDecisionId: row.review_decision_id, decision: row.decision!, decisionVersion: row.decision_version! },
      application: row.review_removal_application_id === null ? null : {
        reviewRemovalApplicationId: row.review_removal_application_id, reviewItemId: row.application_item_id!,
        reviewDecisionId: row.application_decision_id!,
      },
      spot: { lifecycle: row.lifecycle, mergedInto: row.merged_into },
      linkedEntityIds: links.map((l) => l.source_entity_id),
    });
  }
  return reviews;
}

/**
 * A review decision answers one comparison (this release against the current one). Another
 * unrejected release of the source newer than the current one, or not comparable with it, makes
 * that comparison stale; the review_match_applications trigger checks the same inside the batch.
 */
async function assertNoCompetingRelease(db: Db, sourceId: string, releaseId: number, current: { release_id: number; observed_on: string | null }) {
  const other = await db.prepare(
    `SELECT release_id FROM source_releases WHERE source_id = ? AND release_id NOT IN (?, ?) AND status <> 'rejected'
       AND (observed_on IS NULL OR ? IS NULL OR observed_on > ?) ORDER BY release_id LIMIT 1`,
  ).bind(sourceId, releaseId, current.release_id, current.observed_on, current.observed_on).first<{ release_id: number }>();
  if (other) {
    throw new ReviewedMatchError(`resolve: release ${other.release_id} of ${sourceId} competes with release ${releaseId}; its review decisions are stale`);
  }
}

/**
 * A reviewed match says the record continues the entity; it does not approve new values. Only a
 * match whose observation is unchanged moves evidence. A changed coordinate is a relocation candidate
 * (persistRelocationCandidates), never applied here, and any other changed value needs a value update
 * policy, which does not exist yet; both are refused. A removed or merged spot is never revived by a match.
 */
async function assertReviewedMatchKeepsValues(db: Db, spotId: string, record: StoredObservation, previous: SourceObservation | undefined) {
  const spot = await db.prepare("SELECT lifecycle, merged_into FROM spots WHERE spot_id = ?")
    .bind(spotId).first<{ lifecycle: string; merged_into: string | null }>();
  if (!spot || spot.lifecycle === "removed" || spot.merged_into !== null) {
    throw new ReviewedMatchError(`resolve: record ${record.recordId} is reviewed as spot ${spotId}, which is removed or merged; restoring a spot is not implemented`);
  }
  if (!previous) throw new ReviewedMatchError(`resolve: spot ${spotId}'s previous record has no observation`);
  if (previous.latitude !== record.observation.latitude || previous.longitude !== record.observation.longitude) {
    throw new ReviewedMatchError(`resolve: record ${record.recordId} is reviewed as spot ${spotId} at another coordinate; relocation is not implemented`);
  }
  if (JSON.stringify(previous) !== JSON.stringify(record.observation)) {
    throw new ReviewedMatchError(`resolve: record ${record.recordId} is reviewed as spot ${spotId} with changed values; a value update policy is not implemented`);
  }
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
    `SELECT s.*,
       (SELECT count(*) FROM spot_field_attenuations a WHERE a.spot_id = s.spot_id) AS attenuations,
       (SELECT count(*) FROM spot_field_provenance p WHERE p.spot_id = s.spot_id AND p.record_id <> ?) AS foreign_provenance
     FROM spots s WHERE s.spot_id = ?`,
  ).bind(previousRecordId, spotId).first<Record<string, unknown>>();
  if (!spot || spot.merged_into !== null || spot.publication_hold !== null || (spot.attenuations as number) > 0) {
    throw new Error(`resolve: spot ${spotId} is merged, held or attenuated; its evidence is not moved automatically`);
  }
  // The new record may only become the evidence of the values it supports: the canonical row must
  // still be exactly what this observation resolves to. Anything else is canonical drift.
  const r = resolveObservation(record.observation, []);
  const tile = tileForCoordinate(r.latitude, r.longitude, DATA_TILE_ZOOM);
  const expected: Record<string, unknown> = {
    name: r.name, latitude: r.latitude, longitude: r.longitude,
    supports_paper: r.supportsPaper, supports_heated: r.supportsHeated,
    opening_hours_raw: r.openingHours.raw,
    opening_hours_json: r.openingHours.parsed ? JSON.stringify(r.openingHours.parsed) : null,
    opening_hours_status: r.openingHours.status, lifecycle: r.lifecycle, publication_hold: r.publicationHold,
    tile_z: tile.z, tile_x: tile.x, tile_y: tile.y, tile_id: formatTileId(tile),
  };
  const drifted = Object.keys(expected).filter((k) => spot[k] !== expected[k]);
  if (drifted.length > 0) {
    throw new Error(`resolve: spot ${spotId} canonical drift in ${drifted.join(", ")}; record ${record.recordId} does not support its values`);
  }
  if ((spot.foreign_provenance as number) > 0) {
    throw new Error(`resolve: spot ${spotId} has provenance from another record than ${previousRecordId}`);
  }
}
