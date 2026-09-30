// Local moderation tool for user reports (ADR-0007 §8). It talks to the LOCAL D1 database
// (.wrangler/state) only, never a remote one, and there is no authenticated admin HTTP surface.
//
//   npm run local:reports                                   # pending queue
//   npm run local:reports -- list accepted
//   npm run local:reports -- decide rp_... accepted reviewer-1 confirmed
//   npm run local:reports -- queue rp_... queued|discarded
//   npm run local:reports -- retain                          # run the retention/minimization pass
//
// Community reconciliation of queued new-spot (`missing`) reports (Issue #123, migration 0020):
//   npm run local:reports -- candidates <withinMetres>       # read-only grouping; the radius is always explicit
//   npm run local:reports -- propose <decidedBy> <locationReportId> <reportId> <reportId>...
//   npm run local:reports -- apply ca_...                     # sanitized userReport release -> resolve, one batch
//   npm run local:reports -- withdraw ca_...
//
// Existing-spot report effects (Issue #127, migration 0021). An effect follows from the report type; `other` has none:
//   npm run local:reports -- effects                          # queued groups + applications: counts, submitters, rights, staleness, effect
//   npm run local:reports -- effect-propose <decidedBy> <reportId>...
//   npm run local:reports -- effect-apply ce_...               # records the review candidate; changes nothing canonical
//   npm run local:reports -- effect-hold ce_...                # prohibited only; refused (blocked) until community rights hold (#124)
//   npm run local:reports -- effect-lift ce_... <liftedBy>     # then npm run local:pipeline (or publish) to republish
//   npm run local:reports -- effect-withdraw ce_...
//   npm run local:reports -- summary                          # pending -> accepted -> queued -> application -> applied, counts only
//
// The queue view prints the claim under review; it never prints the hashed submitter key, and no
// raw install identifier or attestation material exists in the database to print.
import { getPlatformProxy } from "wrangler";
import type { Db } from "../src/db.ts";
import {
  DECISION_REASONS,
  type DecisionReason,
  type ExposedReconciliationState,
  type ModerationState,
  listModerationQueue,
  moderationPipelineSummary,
  recordModerationDecision,
  setReconciliationState,
} from "../src/reports/moderation.ts";
import { applyReportRetention } from "../src/reports/retention.ts";
import {
  applyCommunityEffect, holdCommunityEffect, liftCommunityHold, listCommunityEffects, proposeCommunityEffect,
  withdrawCommunityEffect,
} from "../src/pipeline/community-effects.ts";
import {
  applyCommunityApplication,
  listCommunityCandidates,
  proposeCommunityApplication,
  withdrawCommunityApplication,
} from "../src/pipeline/community-reconciliation.ts";

const [command = "list", ...args] = process.argv.slice(2);
const proxy = await getPlatformProxy<{ DB: Db }>({ remoteBindings: false });
try {
  const db = proxy.env.DB;
  const now = new Date();
  if (command === "list") {
    console.log(JSON.stringify(await listModerationQueue(db, { state: (args[0] as ModerationState) ?? "pending" }), null, 2));
  } else if (command === "decide") {
    const [reportId, state, decidedBy, reason] = args;
    if (!reportId || !state || !decidedBy) {
      throw new Error(`usage: decide <reportId> <state> <decidedBy> [reason: ${DECISION_REASONS.join("|")}]`);
    }
    // A bounded reason code, never free text: moderation metadata must not carry reporter content.
    if (reason !== undefined && !DECISION_REASONS.includes(reason as DecisionReason)) {
      throw new Error(`reason must be one of: ${DECISION_REASONS.join(", ")}`);
    }
    await recordModerationDecision(db, reportId, { state: state as Exclude<ModerationState, "pending">, decidedBy, reason: reason as DecisionReason | undefined, now });
    console.log(JSON.stringify(await listModerationQueue(db, { state: state as ModerationState }), null, 2));
  } else if (command === "queue") {
    const [reportId, state] = args;
    if (state !== "queued" && state !== "discarded") {
      // 'applied' is never set by hand: only `apply` reaches it, in the batch that writes the evidence.
      throw new Error("usage: queue <reportId> <queued|discarded>");
    }
    if (!reportId) throw new Error("usage: queue <reportId> <queued|discarded>");
    // Rejected unless the report is accepted; queuing is still not publication.
    await setReconciliationState(db, reportId, state as ExposedReconciliationState, now);
    console.log("reconciliation", reportId, state);
  } else if (command === "candidates") {
    const [within] = args;
    if (!within) throw new Error("usage: candidates <withinMetres>");
    console.log(JSON.stringify(await listCommunityCandidates(db, { withinMetres: Number(within), now }), null, 2));
  } else if (command === "propose") {
    const [decidedBy, locationReportId, ...reportIds] = args;
    if (!decidedBy || !locationReportId || reportIds.length === 0) {
      throw new Error("usage: propose <decidedBy> <locationReportId> <reportId> <reportId>...");
    }
    console.log("application", await proposeCommunityApplication(db, { reportIds, locationReportId, decidedBy, now }));
  } else if (command === "apply") {
    const [applicationId] = args;
    if (!applicationId) throw new Error("usage: apply <applicationId>");
    console.log("apply", applicationId, await applyCommunityApplication(db, applicationId, { now }));
  } else if (command === "withdraw") {
    const [applicationId] = args;
    if (!applicationId) throw new Error("usage: withdraw <applicationId>");
    await withdrawCommunityApplication(db, applicationId, { now });
    console.log("withdrawn", applicationId);
  } else if (command === "effects") {
    console.log(JSON.stringify(await listCommunityEffects(db, { now }), null, 2));
  } else if (command === "effect-propose") {
    const [decidedBy, ...reportIds] = args;
    if (!decidedBy || reportIds.length === 0) throw new Error("usage: effect-propose <decidedBy> <reportId>...");
    const { applicationId, effect } = await proposeCommunityEffect(db, { reportIds, decidedBy, now });
    console.log("effect application", applicationId, effect);
  } else if (command === "effect-apply") {
    const [applicationId] = args;
    if (!applicationId) throw new Error("usage: effect-apply <applicationId>");
    console.log("effect apply", applicationId, await applyCommunityEffect(db, applicationId, { now }));
  } else if (command === "effect-hold") {
    const [applicationId] = args;
    if (!applicationId) throw new Error("usage: effect-hold <applicationId>");
    // The reviewed registry decides the rights; a `blocked` result writes nothing and names every blocker.
    console.log("effect hold", applicationId, await holdCommunityEffect(db, applicationId, { now }));
  } else if (command === "effect-lift") {
    const [applicationId, liftedBy] = args;
    if (!applicationId || !liftedBy) throw new Error("usage: effect-lift <applicationId> <liftedBy>");
    await liftCommunityHold(db, applicationId, { liftedBy, now });
    console.log("hold lifted", applicationId, "- republish to show the spot again");
  } else if (command === "effect-withdraw") {
    const [applicationId] = args;
    if (!applicationId) throw new Error("usage: effect-withdraw <applicationId>");
    await withdrawCommunityEffect(db, applicationId, { now });
    console.log("withdrawn", applicationId);
  } else if (command === "summary") {
    console.log(JSON.stringify(await moderationPipelineSummary(db), null, 2));
  } else if (command === "retain") {
    console.log("retention", await applyReportRetention(db, { now }));
  } else {
    throw new Error(`unknown command: ${command}`);
  }
} finally {
  await proxy.dispose();
}
