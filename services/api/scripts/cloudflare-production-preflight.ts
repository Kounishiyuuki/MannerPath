// Local, read-only evidence evaluator. No Cloudflare client, subprocess, fetch, SQL or file writes.
// Administrator receipts are assertions to review, not authenticated live-state proof or deployment permission.
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { parseJsonc } from "./disposable-env.ts";
import { PLACEHOLDER_IDS } from "./release-preflight.ts";
import { productionConfig, PRODUCTION_WORKER } from "./production-v1-plan.ts";
import { EXPECTED_PENDING, PEPPERS, APP_ID, migrationReviewChecks, type MigrationReview } from "./production-v1-check.ts";

const uuid = z.uuid();
const digest = z.string().regex(/^[0-9a-f]{64}$/);
const ref = z.string().trim().min(1).max(200);
const database = z.object({ id: uuid, name: z.string().regex(/^[a-z0-9-]+$/) }).strict();
// Supplied independently of wrangler.jsonc; no automatic production/green choice or default approval.
export const targetSchema = z.object({
  worker: z.literal(PRODUCTION_WORKER), accountReviewRef: ref,
  DB: database, REPORTS_DB: database,
  currentCrons: z.array(z.string().max(100)).max(5),
  reviewedBy: ref, reviewedAt: z.iso.datetime(),
}).strict();
export const ADMIN_GATES = ["migrationIntegrity", "backupAndGreenRunbook", "rollbackVersionAndTriggerOrder",
  "workerCpu", "d1AccountUsage", "frequencyAndBacklog", "planAndCostCeiling", "monitorOwnerAndStopCriteria"] as const;
const gateShape = Object.fromEntries(ADMIN_GATES.map(name => [name, ref.nullable()])) as Record<(typeof ADMIN_GATES)[number], z.ZodNullable<z.ZodString>>;
export const evidenceSchema = z.object({
  observedAt: z.iso.datetime(), gitCommit: z.string().regex(/^[0-9a-f]{40}$/), configSha256: digest, targetSha256: digest,
  worker: z.literal(PRODUCTION_WORKER), versionId: uuid, activeVersionIds: z.array(uuid).min(1),
  bindings: z.array(z.object({ binding: z.enum(["DB", "REPORTS_DB"]), id: uuid }).strict()).length(2),
  // These are names only. Raw secret-list/version responses and secret values are not accepted.
  secretNames: z.array(z.string().regex(/^[A-Z][A-Z0-9_]{0,99}$/)),
  pending: z.object({ DB: z.array(z.string().regex(/^\d{4}_[a-z0-9_]+\.sql$/)), REPORTS_DB: z.array(z.string().regex(/^\d{4}_[a-z0-9_]+\.sql$/)) }).strict(),
  deployedCrons: z.array(z.string().max(100)).max(5),
  proposedCron: z.string().max(100),
  configGet: z.object({ status: z.number().int(), reportsAvailable: z.boolean(), photoEvidenceEnabled: z.boolean() }).strict(),
  readinessGet: z.object({ status: z.number().int(), state: z.string().max(50), versionId: uuid, databaseId: uuid }).strict(),
  gates: z.object(gateShape).strict(), reviewedBy: ref,
}).strict();
export type Outcome = "pass" | "fail" | "unverified";
export type Check = { id: string; outcome: Outcome };
const same = (a: readonly string[], b: readonly string[]) => a.length === b.length && [...a].sort().every((v, i) => v === [...b].sort()[i]);
export const sha256 = (bytes: string | Uint8Array) => createHash("sha256").update(bytes).digest("hex");
export const candidateDigest = (candidate: unknown) => sha256(JSON.stringify(candidate));
export interface Inputs {
  candidate: any; committed: any; gitCommit: string; targetBytes?: string; evidenceBytes?: string;
  migrationDirs: Record<"DB" | "REPORTS_DB", string>;
  reviews: MigrationReview[]; fileSha256: (db: "DB" | "REPORTS_DB", name: string) => string;
  stage: "before-migration" | "before-deploy"; now: Date;
}
export function preflight(o: Inputs): { result: "FAIL" | "UNVERIFIED" | "REVIEW_COMPLETE"; checks: Check[] } {
  const checks: Check[] = [];
  const add = (id: string, ok: boolean) => checks.push({ id, outcome: ok ? "pass" : "fail" });
  const c = o.candidate;
  const d1 = c.d1_databases ?? [];
  add("local.worker", c.name === PRODUCTION_WORKER);
  add("local.intakeClosed", c.vars?.REPORT_REGISTRATION === "paused" && c.vars?.REPORT_ATTESTATION === "required" && !Object.hasOwn(c.vars ?? {}, APP_ID));
  add("local.noPhotosOrSourceStorage", !c.r2_buckets?.length && c.vars?.PHOTO_EVIDENCE !== "on");
  add("local.noSecretValuesInVars", ![...PEPPERS, APP_ID].some(name => Object.hasOwn(c.vars ?? {}, name)));
  add("local.retentionCronConsistent", c.vars?.REPORT_RETENTION === "cleanup" && same(c.triggers?.crons ?? [], [c.vars?.REPORT_RETENTION_CRON]));
  add("local.streamsSeparate", d1.length === 2 && new Set(d1.map((d: any) => d.binding)).size === 2
    && d1.some((d: any) => d.binding === "DB") && d1.some((d: any) => d.binding === "REPORTS_DB")
    && d1[0].database_id !== d1[1].database_id);
  for (const db of ["DB", "REPORTS_DB"] as const) {
    const item = d1.find((d: any) => d.binding === db);
    add(`local.${db}.migrationStream`, typeof item?.migrations_dir === "string" && resolve(item.migrations_dir) === resolve(o.migrationDirs[db]));
    add(`local.${db}.notStaging`, !(o.committed.env?.staging?.d1_databases ?? []).some((d: any) => d.database_id === item?.database_id));
    for (const [index, [, outcome]] of migrationReviewChecks(o, db).entries()) checks.push({ id: `migrationReview.${db}.${index}`, outcome });
  }
  const target = o.targetBytes === undefined ? null : targetSchema.safeParse(JSON.parse(o.targetBytes));
  const evidence = o.evidenceBytes === undefined ? null : evidenceSchema.safeParse(JSON.parse(o.evidenceBytes));
  if (target && !target.success) add("target.invalid", false);
  if (evidence && !evidence.success) add("evidence.invalid", false);
  if (!target?.success || !evidence?.success) {
    checks.push({ id: "administratorEvidence", outcome: "unverified" });
  } else {
    const t = target.data, e = evidence.data;
    const age = o.now.getTime() - Date.parse(e.observedAt);
    add("evidence.fresh", age >= 0 && age <= 15 * 60_000 && Date.parse(t.reviewedAt) <= Date.parse(e.observedAt));
    add("evidence.commitAndConfig", e.gitCommit === o.gitCommit && e.configSha256 === candidateDigest(c));
    add("evidence.independentTarget", e.targetSha256 === sha256(o.targetBytes!) && t.DB.id !== t.REPORTS_DB.id
      && ![t.DB.id, t.REPORTS_DB.id].some(id => PLACEHOLDER_IDS.includes(id)));
    add("remote.singleActiveVersion", same(e.activeVersionIds, [e.versionId]));
    add("remote.cronsMatchReviewedCurrentState", same(e.deployedCrons, t.currentCrons));
    add("proposal.cronMatchesReviewedProposal", e.proposedCron === c.vars.REPORT_RETENTION_CRON);
    checks.push({ id: "remote.peppersPresentByName", outcome: PEPPERS.every(name => e.secretNames.includes(name)) ? "pass" : o.stage === "before-deploy" ? "fail" : "unverified" });
    add("remote.intakeClosed", !e.secretNames.includes(APP_ID) && e.configGet.status === 200 && !e.configGet.reportsAvailable && !e.configGet.photoEvidenceEnabled);
    add("remote.readinessBoundToVersionAndDB", e.readinessGet.status === 200 && e.readinessGet.state === "completed"
      && e.readinessGet.versionId === e.versionId && e.readinessGet.databaseId === t.DB.id);
    for (const db of ["DB", "REPORTS_DB"] as const) {
      const proposed = d1.filter((d: any) => d.binding === db), actual = e.bindings.filter(b => b.binding === db);
      add(`binding.${db}.independentIdentity`, proposed.length === 1 && actual.length === 1 && proposed[0].database_id === t[db].id
        && proposed[0].database_name === t[db].name && actual[0].id === t[db].id);
      add(`migration.${db}.pending`, same(e.pending[db], o.stage === "before-deploy" ? [] : EXPECTED_PENDING[db]));
    }
    for (const gate of ADMIN_GATES) checks.push({ id: `administrator.${gate}`, outcome: e.gates[gate] === null ? "unverified" : "pass" });
  }
  return { result: checks.some(c => c.outcome === "fail") ? "FAIL" : checks.some(c => c.outcome === "unverified") ? "UNVERIFIED" : "REVIEW_COMPLETE", checks };
}
export function main(args: string[]): number {
  if (args.length !== 4 && args.length !== 8) throw Error("usage");
  const [stageFlag, stage, commitFlag, gitCommit, targetFlag, targetFile, evidenceFlag, evidenceFile] = args;
  if (stageFlag !== "--stage" || !["before-migration", "before-deploy"].includes(stage) || commitFlag !== "--commit" || !/^[0-9a-f]{40}$/.test(gitCommit)
    || (args.length === 8 && (targetFlag !== "--expected-target" || evidenceFlag !== "--evidence"))) throw Error("usage");
  const apiDir = fileURLToPath(new URL("..", import.meta.url)).replace(/\/$/, "");
  const committed = parseJsonc(readFileSync(`${apiDir}/wrangler.jsonc`, "utf8"));
  const candidate = productionConfig(committed, apiDir);
  // All inputs are bounded, local files. Errors deliberately omit paths, source bytes and Zod values.
  const bounded = (file: string) => { const bytes = readFileSync(file); if (bytes.length > 64_000) throw Error("size"); return bytes.toString("utf8"); };
  const report = preflight({ candidate, committed, gitCommit, stage: stage as Inputs["stage"], now: new Date(),
    targetBytes: targetFile ? bounded(targetFile) : undefined, evidenceBytes: evidenceFile ? bounded(evidenceFile) : undefined,
    migrationDirs: { DB: `${apiDir}/migrations`, REPORTS_DB: `${apiDir}/migrations-reports` },
    reviews: JSON.parse(bounded(`${apiDir}/release/production-migration-review.json`)).reviews,
    fileSha256: (db, name) => sha256(readFileSync(`${apiDir}/${db === "DB" ? "migrations" : "migrations-reports"}/${name}`)),
  });
  console.log(JSON.stringify({ ...report, candidateSha256: candidateDigest(candidate), deploymentAuthorized: false }));
  return report.result === "FAIL" ? 1 : report.result === "UNVERIFIED" ? 3 : 0;
}
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try { process.exitCode = main(process.argv.slice(2)); }
  catch { console.error("production:preflight: invalid local input; no source values emitted"); process.exitCode = 1; }
}
