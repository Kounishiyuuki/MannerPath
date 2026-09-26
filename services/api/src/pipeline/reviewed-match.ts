// Reviewed match plan (ADR-0008 decisions 3 and 8, Issue #86): the automatic MatchPlan (./match.ts)
// + the latest review decisions on its ambiguousMatch items -> the effective plan the resolver
// applies. Pure: reading decisions and applying the plan are the resolver's (./resolve.ts), and a
// decision never edits a canonical row by itself.
//
// A decided record is resolved; nothing else is. confirmedNew makes a record new but says nothing
// about the previous entities it competed for: an entity that no record continues stays unresolved,
// never an implicit disappearance or removal, and the release is not applied while one remains.

import type { MatchDecision, MatchPlan, NewRecord, PreviousRecord } from "./match.ts";
import { REVIEW_DECISION_VERSION } from "./review-queue.ts";

/** Stored in `review_match_applications.executor_version`. */
export const REVIEW_MATCH_APPLICATION_VERSION = "review-match-application.v1";

/** One stored ambiguousMatch item of the release under reconciliation, with its latest decision. */
export interface AmbiguousReview {
  reviewItemId: number;
  recordId: number;
  candidateEntityIds: readonly number[];
  latest: null | { reviewDecisionId: number; decision: string; decisionVersion: string; sourceEntityId: number | null };
}

export type EffectiveDecision =
  | MatchDecision
  | { recordId: number; method: "reviewed_match"; sourceEntityId: number; previousRecordId: number; reviewItemId: number; reviewDecisionId: number }
  | { recordId: number; method: "reviewed_new"; reviewItemId: number; reviewDecisionId: number };

export interface EffectivePlan {
  /** Every record's decision in `next` order; complete only when both lists below are empty. */
  decisions: EffectiveDecision[];
  /** ambiguousMatch items without a resolving latest decision (none, or deferred). */
  openReviewItemIds: number[];
  /** Previous entities no record continues; computed only once no item is open, else empty. */
  unresolvedPreviousEntityIds: number[];
}

export class ReviewedMatchError extends Error {}

const sameIds = (a: readonly number[], b: readonly number[]) =>
  JSON.stringify([...a].sort((x, y) => x - y)) === JSON.stringify([...b].sort((x, y) => x - y));

/**
 * `plan` is `planCrossReleaseMatch(previous, next)`, and `reviews` must be the stored items of exactly this plan's comparison (release, previous release,
 * matcher version). An ambiguous record without its item is open; a decision this function cannot
 * interpret (another vocabulary version, an entity outside the candidates, two records claiming one
 * entity) is refused rather than skipped.
 */
export function planReviewedMatch(
  plan: MatchPlan, previous: readonly PreviousRecord[], next: readonly NewRecord[], reviews: readonly AmbiguousReview[],
): EffectivePlan {
  const reviewByRecord = new Map(reviews.map((r) => [r.recordId, r]));
  const previousByEntity = new Map(previous.map((p) => [p.sourceEntityId, p]));
  const claimed = new Map<number, number>(); // entity -> record
  const claim = (entityId: number, recordId: number) => {
    const other = claimed.get(entityId);
    if (other !== undefined) {
      throw new ReviewedMatchError(`reviewed match: entity ${entityId} is claimed by records ${other} and ${recordId}`);
    }
    claimed.set(entityId, recordId);
  };
  for (const d of plan.decisions) if (d.method === "raw_identical") claim(d.sourceEntityId, d.recordId);

  const reviewed = new Map<number, EffectiveDecision>();
  const open: number[] = [];
  let unstored = 0; // ambiguous records without their item yet: the resolver stores and reports them
  for (const a of plan.ambiguous) {
    const review = reviewByRecord.get(a.recordId);
    if (!review) {
      unstored += 1;
      continue;
    }
    if (!sameIds(review.candidateEntityIds, a.candidateEntityIds)) {
      throw new ReviewedMatchError(`reviewed match: item ${review.reviewItemId} was raised for other candidates than record ${a.recordId}'s`);
    }
    const latest = review.latest;
    if (latest === null || latest.decision === "deferred") {
      open.push(review.reviewItemId);
      continue;
    }
    if (latest.decisionVersion !== REVIEW_DECISION_VERSION) {
      throw new ReviewedMatchError(`reviewed match: decision ${latest.reviewDecisionId} is ${latest.decisionVersion}, not ${REVIEW_DECISION_VERSION}`);
    }
    const ids = { reviewItemId: review.reviewItemId, reviewDecisionId: latest.reviewDecisionId };
    if (latest.decision === "confirmedNew" && latest.sourceEntityId === null) {
      reviewed.set(a.recordId, { recordId: a.recordId, method: "reviewed_new", ...ids });
    } else if (latest.decision === "matchedToEntity" && latest.sourceEntityId !== null) {
      const entityId = latest.sourceEntityId;
      const prior = previousByEntity.get(entityId);
      if (!a.candidateEntityIds.includes(entityId) || !prior) {
        throw new ReviewedMatchError(`reviewed match: decision ${latest.reviewDecisionId} chose entity ${entityId}, not a candidate of record ${a.recordId}`);
      }
      claim(entityId, a.recordId);
      reviewed.set(a.recordId, { recordId: a.recordId, method: "reviewed_match", sourceEntityId: entityId, previousRecordId: prior.recordId, ...ids });
    } else {
      throw new ReviewedMatchError(`reviewed match: decision ${latest.reviewDecisionId} (${latest.decision}) does not resolve ambiguous record ${a.recordId}`);
    }
  }

  const decided = new Map<number, EffectiveDecision>([...plan.decisions.map((d) => [d.recordId, d] as const), ...reviewed]);
  return {
    decisions: next.flatMap((r) => decided.get(r.recordId) ?? []),
    openReviewItemIds: open,
    unresolvedPreviousEntityIds: open.length + unstored > 0 ? [] : [...new Set(previous.map((p) => p.sourceEntityId))].filter((id) => !claimed.has(id)),
  };
}
