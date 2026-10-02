// The maintainer's moderation and community-review tool (ADR-0007 §8, ADR-0014). There is no authenticated admin HTTP
// surface; this tool is the only operator path, and it holds two databases, never joined:
//
//   REPORTS_DB  the durable report store: reports, moderation, reviews, App Attest, retention. LOCAL by default
//               (wrangler local state). Remote only by explicit flags, from an interactive terminal (see below).
//   DB          the canonical DATA_DB of the LOCAL pipeline: artifact import, apply, holds, upgrades. Always local;
//               canonical data reaches staging/production only through promotion (docs/OPERATIONS.md).
//
//   npm run local:reports:migrate                          # once: REPORTS_DB schema (migrations-reports)
//   npm run local:reports                                  # pending queue (local report store)
//   npm run local:reports:redact                           # bounded, resumable 90-day minimization
//   npm run reports:moderate -- --remote --env staging --database-id <uuid> list
//   npm run reports:moderate -- --remote --env production --database-id <uuid> \
//       --confirm-production mannerpath-production-reports list
//
// Remote moderation is a maintainer's own operation, never an agent's or a pipeline's: it refuses without --remote,
// --env, --database-id (and the typed production confirmation), refuses outside an interactive terminal or in CI,
// binds ONLY the report store (no canonical binding exists in that session), checks the store identity row before any
// command, and never falls back to local. src/reports/moderation-target.ts holds the rules.
//
// REPORTS_DB — moderation:
//   list [state] | decide <reportId> <state> <decidedBy> [reason] | queue <reportId> <queued|discarded>
//   triage [state] [category,...] [flag] | triage-summary | evidence | corrections | duplicates | summary | retain
// REPORTS_DB — review (independence is judged here, where the submitter keys exist):
//   candidates <withinMetres>
//   propose <decidedBy> <locationReportId> <reportId> <reportId>...        # new spot, communityVerified
//   propose-reported <decidedBy> <reportId>                               # new spot, ONE consented, classified report
//   effect-propose <decidedBy> <reportId>...                              # an `exists` confirmation of a communityReported
//                                                                         #   spot names the spot's evidence automatically
//   absence-propose <decidedBy> <reportId>...
//   effects-queue | reviews | review-withdraw <reviewId>
//   export <reviewId> [outDir]                                            # writes <outDir>/<sha256>.json; idempotent
// DB (local canonical) — the artifact boundary and its applications:
//   import <artifact.json>...                                             # imported | alreadyImported | conflict | stale | refused
//   artifacts | relocations
//   apply ca_... | withdraw ca_...
//   effects | effect-apply ce_... | effect-hold ce_... | effect-lift ce_... <liftedBy> | effect-withdraw ce_...
//   upgrade ce_... <decidedBy>
//   absence-apply cn_... | absence-hold cn_... | absence-lift cn_... <liftedBy> | absence-withdraw cn_...
//
// Output never prints a submitter key, and no raw install identifier or attestation material exists to print.
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { getPlatformProxy } from "wrangler";
import type { Db } from "../src/db.ts";
import {
  DECISION_REASONS, type DecisionReason, type ExposedReconciliationState, type ModerationState, listModerationQueue, moderationQueuePage,
  moderationPipelineSummary, recordModerationDecision, setReconciliationState,
} from "../src/reports/moderation.ts";
import { photoEvidenceStrength, moderateEvidencePhoto, PHOTO_DECISION_REASONS, type PhotoDecisionReason } from "../src/reports/photos.ts";
import { applyReportRetention, runReportRetention } from "../src/reports/retention.ts";
import { type ModerationTarget, moderationTarget, targetBanner } from "../src/reports/moderation-target.ts";
import {
  exportReview, listExistingSpotQueue, listNewSpotCandidates, listReviews, proposeAbsenceReview, proposeEffectReview,
  proposeNewSpotReview, withdrawReview,
} from "../src/reports/review.ts";
import { REPORT_STORE_SCHEMA } from "../src/reports/evidence-artifact.ts";
import {
  applyCommunityEffect, holdCommunityEffect, liftCommunityHold, listCommunityEffects, withdrawCommunityEffect,
} from "../src/pipeline/community-effects.ts";
import { applyCommunityApplication, withdrawCommunityApplication } from "../src/pipeline/community-reconciliation.ts";
import { upgradeCommunityEvidence } from "../src/pipeline/community-verification.ts";
import {
  applyCommunityAbsence, holdCommunityAbsence, liftCommunityAbsence, withdrawCommunityAbsence,
} from "../src/pipeline/community-absence.ts";
import { communityRelocationCandidates, correctionCandidatePage, duplicateCandidatePage, evidenceStatePage } from "../src/pipeline/community-evidence.ts";
import { importCommunityArtifact, listImportedArtifacts, spotEvidenceReportIds } from "../src/pipeline/community-artifact.ts";
import { TRIAGE_CATEGORIES, TRIAGE_FLAGS, type TriageCategory, type TriageFlag, triageQueue, triageQueuePage, triageSummary } from "../src/reports/triage.ts";

const rawArgs = process.argv.slice(2);
const targetArgs: string[] = [];
let limit: number | undefined;
let cursor: string | undefined;
for (let i = 0; i < rawArgs.length; i++) {
  if (rawArgs[i] === "--limit") {
    limit = Number(rawArgs[++i]);
    if (!Number.isSafeInteger(limit) || limit < 1) throw new Error("--limit needs a positive integer");
  } else if (rawArgs[i] === "--cursor") {
    cursor = rawArgs[++i];
    if (!cursor || cursor.startsWith("--")) throw new Error("--cursor needs a value");
  } else targetArgs.push(rawArgs[i]);
}
const parsed = moderationTarget(targetArgs, { interactive: process.stdin.isTTY === true && process.stdout.isTTY === true, ci: Boolean(process.env.CI) });
if (!parsed.ok) {
  console.error(`refused: ${parsed.error}`);
  process.exit(2);
}
const target = parsed.target;
const [command = "list", ...args] = parsed.rest;
console.error(targetBanner(target));

const local = await getPlatformProxy<{ DB: Db; REPORTS_DB: Db }>({ remoteBindings: false });
const remote = target.kind === "remote" ? await remoteReportStore(target) : null;
try {
  const reports = remote === null ? local.env.REPORTS_DB : remote.proxy.env.REPORTS_DB;
  const data = local.env.DB;
  await assertReportStore(reports);
  const now = new Date();
  const json = (v: unknown) => console.log(JSON.stringify(v, null, 2));

  if (command === "list") {
    json(await moderationQueuePage(reports, { state: (args[0] as ModerationState) ?? "pending", limit, cursor }));
  } else if (command === "decide") {
    const [reportId, state, decidedBy, reason] = args;
    if (!reportId || !state || !decidedBy) throw new Error(`usage: decide <reportId> <state> <decidedBy> [reason: ${DECISION_REASONS.join("|")}]`);
    // A bounded reason code, never free text: moderation metadata must not carry reporter content.
    if (reason !== undefined && !DECISION_REASONS.includes(reason as DecisionReason)) throw new Error(`reason must be one of: ${DECISION_REASONS.join(", ")}`);
    await recordModerationDecision(reports, reportId, { state: state as Exclude<ModerationState, "pending">, decidedBy, reason: reason as DecisionReason | undefined, now });
    json(await listModerationQueue(reports, { state: state as ModerationState }));
  } else if (command === "photo-summary") {
    if (!args[0]) throw new Error("usage: photo-summary <reportId>");
    json(await photoEvidenceStrength(reports,args[0]));
  } else if (command === "photo-decide") {
    const [photoId,state,decidedBy,reason] = args;
    if (!photoId || (state !== "approved" && state !== "rejected") || !decidedBy || !PHOTO_DECISION_REASONS.includes(reason as PhotoDecisionReason)) throw new Error("usage: photo-decide <photoId> <approved|rejected> <decidedBy> <usableEvidence|privacyRisk|unrelated|unsafeContent|insufficientDetail>");
    await moderateEvidencePhoto(reports,photoId,state,{now,decidedBy,reason:reason as PhotoDecisionReason});
    json({photoId,state,publicationEnabled:false});
  } else if (command === "queue") {
    const [reportId, state] = args;
    // 'applied' is never set by hand: only `export` reaches it, in the batch that seals the artifact.
    if (!reportId || (state !== "queued" && state !== "discarded")) throw new Error("usage: queue <reportId> <queued|discarded>");
    await setReconciliationState(reports, reportId, state as ExposedReconciliationState, now);
    console.log("reconciliation", reportId, state);
  } else if (command === "candidates") {
    const [within] = args;
    if (!within) throw new Error("usage: candidates <withinMetres>");
    const items = await listNewSpotCandidates(reports, { withinMetres: Number(within), now, limit, afterReportId: cursor });
    json({ items, scope: "pageLocal", nextCursor: items[0]?.nextReportId ?? null });
  } else if (command === "propose") {
    const [decidedBy, locationReportId, ...reportIds] = args;
    if (!decidedBy || !locationReportId || reportIds.length === 0) throw new Error("usage: propose <decidedBy> <locationReportId> <reportId> <reportId>...");
    console.log("review", await proposeNewSpotReview(reports, { reportIds, locationReportId, decidedBy, now }));
  } else if (command === "propose-reported") {
    const [decidedBy, reportId] = args;
    if (!decidedBy || !reportId) throw new Error("usage: propose-reported <decidedBy> <reportId>");
    console.log("review", await proposeNewSpotReview(reports, { reportIds: [reportId], locationReportId: reportId, decidedBy, now, tier: "communityReported" }));
  } else if (command === "effect-propose") {
    const [decidedBy, ...reportIds] = args;
    if (!decidedBy || reportIds.length === 0) throw new Error("usage: effect-propose <decidedBy> <reportId>...");
    console.log("review", await proposeEffectReview(reports, { reportIds, decidedBy, now, baseReportIds: await confirmationBase(reports, data, reportIds) }));
  } else if (command === "absence-propose") {
    const [decidedBy, ...reportIds] = args;
    if (!decidedBy || reportIds.length === 0) throw new Error("usage: absence-propose <decidedBy> <reportId>...");
    console.log("review", await proposeAbsenceReview(reports, { reportIds, decidedBy, now }));
  } else if (command === "review-withdraw") {
    const [reviewId] = args;
    if (!reviewId) throw new Error("usage: review-withdraw <reviewId>");
    await withdrawReview(reports, reviewId, { now });
    console.log("withdrawn", reviewId);
  } else if (command === "reviews") {
    const items = await listReviews(reports, { limit, cursor });
    json({ items, nextCursor: items.length === Math.min(limit ?? 200, 1000) ? items.at(-1)!.reviewId : null });
  } else if (command === "effects-queue") {
    const items = await listExistingSpotQueue(reports, { now, limit, cursor });
    json({ items, nextCursor: items.length === Math.min(limit ?? 200, 1000) ? items.at(-1)!.cursor : null });
  } else if (command === "export") {
    const [reviewId, outDir = "community-artifacts"] = args;
    if (!reviewId) throw new Error("usage: export <reviewId> [outDir]");
    const { status, artifact } = await exportReview(reports, reviewId, { now });
    mkdirSync(outDir, { recursive: true });
    const file = resolve(outDir, `${artifact.sha256}.json`);
    writeFileSync(file, artifact.bytes);
    console.log(status, reviewId, artifact.sha256, file);
  } else if (command === "import") {
    if (args.length === 0) throw new Error("usage: import <artifact.json>...");
    for (const file of args) console.log(file, JSON.stringify(await importCommunityArtifact(data, new Uint8Array(readFileSync(file)), { now })));
  } else if (command === "artifacts") {
    json(await listImportedArtifacts(data));
  } else if (command === "relocations") {
    json(await communityRelocationCandidates(data));
  } else if (command === "apply") {
    const [applicationId] = args;
    if (!applicationId) throw new Error("usage: apply <applicationId>");
    console.log("apply", applicationId, await applyCommunityApplication(data, applicationId, { now }));
  } else if (command === "withdraw") {
    const [applicationId] = args;
    if (!applicationId) throw new Error("usage: withdraw <applicationId>");
    await withdrawCommunityApplication(data, applicationId, { now });
    console.log("withdrawn", applicationId);
  } else if (command === "upgrade") {
    const [effectApplicationId, decidedBy] = args;
    if (!effectApplicationId || !decidedBy) throw new Error("usage: upgrade <effectApplicationId> <decidedBy>");
    console.log("upgrade", await upgradeCommunityEvidence(data, effectApplicationId, { decidedBy, now }));
  } else if (command === "effects") {
    json(await listCommunityEffects(data, { now }));
  } else if (command === "effect-apply") {
    const [applicationId] = args;
    if (!applicationId) throw new Error("usage: effect-apply <applicationId>");
    console.log("effect apply", applicationId, await applyCommunityEffect(data, applicationId, { now }));
  } else if (command === "effect-hold") {
    const [applicationId] = args;
    if (!applicationId) throw new Error("usage: effect-hold <applicationId>");
    // The reviewed registry decides the rights; a `blocked` result writes nothing and names every blocker.
    console.log("effect hold", applicationId, await holdCommunityEffect(data, applicationId, { now }));
  } else if (command === "effect-lift") {
    const [applicationId, liftedBy] = args;
    if (!applicationId || !liftedBy) throw new Error("usage: effect-lift <applicationId> <liftedBy>");
    await liftCommunityHold(data, applicationId, { liftedBy, now });
    console.log("hold lifted", applicationId, "- republish to show the spot again");
  } else if (command === "effect-withdraw") {
    const [applicationId] = args;
    if (!applicationId) throw new Error("usage: effect-withdraw <applicationId>");
    await withdrawCommunityEffect(data, applicationId, { now });
    console.log("withdrawn", applicationId);
  } else if (command === "summary") {
    json(await moderationPipelineSummary(reports, data));
  } else if (command === "triage") {
    const [state = "pending", categoryArg, flagArg] = args;
    const categories = categoryArg === undefined || categoryArg === "all" ? [] : categoryArg.split(",");
    for (const c of categories) {
      if (c !== "correction" && !TRIAGE_CATEGORIES.includes(c as TriageCategory)) throw new Error(`category must be one of: correction, ${TRIAGE_CATEGORIES.join(", ")}`);
    }
    if (flagArg !== undefined && !TRIAGE_FLAGS.includes(flagArg as TriageFlag)) throw new Error(`flag must be one of: ${TRIAGE_FLAGS.join(", ")}`);
    const options = { now, state, categories: categories as TriageCategory[], flag: flagArg as TriageFlag | undefined, limit, cursor };
    json(flagArg ? await triageQueue(reports, data, options) : await triageQueuePage(reports, data, options));
  } else if (command === "triage-summary") {
    json(await triageSummary(reports, data));
  } else if (command === "evidence") {
    json(await evidenceStatePage(reports, data, { now, limit, cursor }));
  } else if (command === "corrections") {
    json(await correctionCandidatePage(reports, data, { now, limit, cursor }));
  } else if (command === "duplicates") {
    json(await duplicateCandidatePage(reports, data, { now, limit, cursor }));
  } else if (command === "absence-apply") {
    const [applicationId] = args;
    if (!applicationId) throw new Error("usage: absence-apply <applicationId>");
    console.log("absence apply", applicationId, await applyCommunityAbsence(data, applicationId, { now }));
  } else if (command === "absence-hold") {
    const [applicationId] = args;
    if (!applicationId) throw new Error("usage: absence-hold <applicationId>");
    console.log("absence hold", applicationId, await holdCommunityAbsence(data, applicationId, { now }));
  } else if (command === "absence-lift") {
    const [applicationId, liftedBy] = args;
    if (!applicationId || !liftedBy) throw new Error("usage: absence-lift <applicationId> <liftedBy>");
    await liftCommunityAbsence(data, applicationId, { liftedBy, now });
    console.log("absence hold lifted", applicationId, "- republish to show the spot again");
  } else if (command === "absence-withdraw") {
    const [applicationId] = args;
    if (!applicationId) throw new Error("usage: absence-withdraw <applicationId>");
    await withdrawCommunityAbsence(data, applicationId, { now });
    console.log("withdrawn", applicationId);
  } else if (command === "retain") {
    // Default drains bounded atomic passes. Explicit page flags return a resumable one-pass result.
    console.log("retention", limit !== undefined || cursor !== undefined
      ? await applyReportRetention(reports, { now, limit, cursor }) : await runReportRetention(reports, { now }));
  } else {
    throw new Error(`unknown command: ${command}`);
  }
} finally {
  await local.dispose();
  if (remote !== null) {
    await remote.proxy.dispose();
    rmSync(remote.dir, { recursive: true, force: true });
  }
}

/**
 * A proxy over the ONE remote binding the maintainer named: a throwaway config that declares only REPORTS_DB, marked
 * remote, with the id typed at the console. The committed config and its placeholders are never edited.
 */
async function remoteReportStore(t: Extract<ModerationTarget, { kind: "remote" }>) {
  const dir = mkdtempSync(join(tmpdir(), "mannerpath-reports-"));
  const configPath = join(dir, "wrangler.json");
  writeFileSync(configPath, JSON.stringify({
    name: `mannerpath-reports-moderation-${t.environment}`,
    compatibility_date: "2026-09-01",
    d1_databases: [{ binding: "REPORTS_DB", database_name: t.databaseName, database_id: t.databaseId, remote: true }],
  }));
  try {
    return { dir, proxy: await getPlatformProxy<{ REPORTS_DB: Db }>({ configPath, remoteBindings: true, persist: false }) };
  } catch (e) {
    rmSync(dir, { recursive: true, force: true });
    throw new Error(`remote report store ${t.databaseName} is unreachable; nothing was done, and there is no fallback (${(e as Error).message})`);
  }
}

/** The report store says what it is before any command touches it; a canonical database or an empty one is refused. */
async function assertReportStore(db: Db): Promise<void> {
  let rows: { key: string; value: string }[];
  try {
    rows = (await db.prepare("SELECT key, value FROM report_store_meta").all<{ key: string; value: string }>()).results;
  } catch {
    throw new Error("this database is not a migrated report store (run npm run local:reports:migrate for local)");
  }
  const meta = Object.fromEntries(rows.map((r) => [r.key, r.value]));
  if (meta.store !== "mannerpath-reports" || meta.schema !== REPORT_STORE_SCHEMA) {
    throw new Error(`this database is not a ${REPORT_STORE_SCHEMA} report store`);
  }
}

/**
 * An `exists` confirmation of a communityReported spot needs the spot's own evidence as its base, so REPORTS_DB can
 * attest independence over both. The IDs come from the local canonical database; nothing else crosses.
 */
async function confirmationBase(reports: Db, data: Db, reportIds: readonly string[]): Promise<string[] | undefined> {
  const first = await reports.prepare("SELECT report_type, subject_spot_id FROM reports WHERE report_id = ?").bind(reportIds[0])
    .first<{ report_type: string; subject_spot_id: string | null }>();
  if (first?.report_type !== "exists" || first.subject_spot_id === null) return undefined;
  const spot = await data.prepare("SELECT evidence_quality FROM spots WHERE spot_id = ?").bind(first.subject_spot_id).first<{ evidence_quality: string }>();
  if (spot?.evidence_quality !== "communityReported") return undefined;
  const base = await spotEvidenceReportIds(data, first.subject_spot_id);
  return base.length === 0 ? undefined : base;
}
