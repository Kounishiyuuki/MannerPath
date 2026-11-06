// The staged production preflight (docs/release/V1_PRODUCTION_INTAKE.md §5): each stage passes only on its expected
// state, after-intake never passes on unapproved terms and never claims registration is open, POSTs are sent only
// once intake is seen closed, and before-db takes exactly the expected migrations with Lane 2's approval of their bytes.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  APP_ID, EXPECTED_PENDING, PEPPERS, type MigrationReview, type Observed, type Stage, evaluate, intakeObservablyClosed, parsePending, result,
} from "../scripts/production-v1-check.ts";
import { assertProductionTarget } from "../scripts/production-v1-stop.ts";
import { productionConfig } from "../scripts/production-v1-plan.ts";
import { parseJsonc } from "../scripts/disposable-env.ts";
import { REPORT_TERMS } from "../src/reports/terms.ts";

const draft = REPORT_TERMS[0];
const approved = { ...draft, version: "report-terms.2026-12-01", publicationRights: "granted" as const };
const SHA = "a".repeat(64);
const v1Config = (available: boolean, terms = draft) => ({ status: 200, body: {
  schemaVersions: { report: 3 }, minimumSupportedSchemaVersions: { report: 3 },
  reports: { available, photoEvidenceEnabled: false, termsVersion: terms.version },
} });
const base = (over: Partial<Observed> = {}): Observed => ({
  pending: { DB: [], REPORTS_DB: [] }, fileSha256: () => SHA, reviews: [], secrets: [...PEPPERS],
  config: v1Config(false), readiness: { status: 200, body: { state: "completed" } },
  photoUpload: { status: 503, error: "photoEvidenceDisabled" },
  registrationChallenge: { status: 503, error: "attestationUnavailable" },
  buildNumbers: ["8", "8"], terms: draft, termsFileSha256: draft.documentSha256, ...over,
});
const failed = (stage: Stage, o: Observed) => evaluate(stage, o).filter(([, r]) => r === "fail").map(([n]) => n);
const allReviews = (over: Partial<MigrationReview> = {}): MigrationReview[] => (["DB", "REPORTS_DB"] as const).flatMap((database) =>
  EXPECTED_PENDING[database].map((name) => ({ database, name, sha256: SHA, verdict: "approved" as const, reviewedBy: "lane2-review", ...over })));
const expected = { DB: [...EXPECTED_PENDING.DB], REPORTS_DB: [...EXPECTED_PENDING.REPORTS_DB] };

test("after-deploy and stopped pass only with intake closed for every key", () => {
  assert.equal(result(evaluate("after-deploy", base())), "PASS");
  assert.equal(result(evaluate("stopped", base())), "PASS");
  const open = base({ secrets: [...PEPPERS, APP_ID], config: v1Config(true), photoUpload: undefined, registrationChallenge: undefined });
  assert.equal(failed("stopped", open).length, 4, "App ID, available, and the two probes it never sent");
  assert.equal(failed("after-deploy", base({ secrets: [] })).length, 2, "both peppers");
  assert.equal(failed("after-deploy", base({ photoUpload: { status: 400 } })).length, 1);
});

test("POSTs are sent only when the App ID is absent and /v1/config says unavailable", () => {
  assert.equal(intakeObservablyClosed([...PEPPERS], v1Config(false)), true);
  assert.equal(intakeObservablyClosed([...PEPPERS, APP_ID], v1Config(false)), false);
  assert.equal(intakeObservablyClosed([...PEPPERS], v1Config(true)), false);
  assert.equal(intakeObservablyClosed([...PEPPERS], { status: 503, body: null }), false);
  // The collector source: after-intake is not a closed stage, and the POSTs sit behind the guard.
  const src = readFileSync(new URL("../scripts/production-v1-check.ts", import.meta.url), "utf8");
  assert.match(src, /const CLOSED_STAGES: Stage\[\] = \["before-db", "after-db", "after-deploy", "stopped"\];/);
  assert.match(src, /if \(CLOSED_STAGES\.includes\(stage\) && intakeObservablyClosed\(secrets, config\)\) \{\n\s+o\.photoUpload = await call/);
  assert.equal(src.match(/"POST"/g)?.length, 3, "the call() signature and the two guarded probes only");
});

test("after-intake never passes on the draft terms, and on approved terms is UNVERIFIED, never PASS", () => {
  const open = base({ secrets: [...PEPPERS, APP_ID], config: v1Config(true), photoUpload: undefined, registrationChallenge: undefined });
  assert.equal(failed("after-intake", open).filter((n) => n.startsWith("terms gate")).length, 2);
  assert.equal(result(evaluate("after-intake", open)), "FAIL");
  const live = { ...open, terms: approved, termsFileSha256: approved.documentSha256, config: v1Config(true, approved) };
  assert.deepEqual(failed("after-intake", live), []);
  assert.equal(result(evaluate("after-intake", live)), "UNVERIFIED");
  assert.equal(evaluate("after-intake", live).some(([n, r]) => r === "unverified" && /registration is enabled.*canary/.test(n)), true);
});

test("before-db: exactly the expected unapplied migrations on both databases, each approved by Lane 2 for its exact bytes", () => {
  assert.equal(result(evaluate("before-db", base({ pending: expected, reviews: allReviews() }))), "PASS");
  assert.equal(failed("before-db", base({ pending: expected })).length, 2 + EXPECTED_PENDING.DB.length + EXPECTED_PENDING.REPORTS_DB.length, "no review rows is not approval");
  assert.equal(failed("before-db", base({ pending: expected, reviews: allReviews({ sha256: "b".repeat(64) }) })).length, 11, "changed bytes");
  assert.equal(failed("before-db", base({ pending: expected, reviews: allReviews({ verdict: "rejected" }) })).length, 11);
  assert.equal(failed("before-db", base({ pending: expected, reviews: allReviews({ reviewedBy: "" }) })).length, 11);
  // Nothing pending is not the expected initial state either.
  assert.equal(failed("before-db", base({ reviews: allReviews() })).length, 2);
  for (const db of ["DB", "REPORTS_DB"] as const) {
    const extra = { ...expected, [db]: [...expected[db], "0099_unexpected.sql"] };
    assert.deepEqual(failed("before-db", base({ pending: extra, reviews: allReviews() })), [`${db}: unapplied migrations are exactly the expected ${EXPECTED_PENDING[db].length}`]);
    const missing = { ...expected, [db]: expected[db].slice(1) };
    assert.equal(failed("before-db", base({ pending: missing, reviews: allReviews() })).length, 1);
  }
  const duplicate = [...allReviews(), allReviews()[0]];
  assert.equal(failed("before-db", base({ pending: expected, reviews: duplicate })).length, 2, "a duplicated review row");
  assert.equal(failed("after-db", base({ pending: expected })).length, 2);
});

test("local checks: build 8 everywhere and the terms bytes match their registered hash", () => {
  assert.equal(failed("after-deploy", base({ buildNumbers: ["8", "7"] })).length, 1);
  assert.equal(failed("after-deploy", base({ termsFileSha256: "0".repeat(64) })).length, 1);
});

test("parses wrangler's migration table and the empty case, refuses unknown output", () => {
  assert.deepEqual(parsePending("│ Name │\n│ 0031_a_b.sql │\n│ 0032_c.sql   │"), ["0031_a_b.sql", "0032_c.sql"]);
  assert.deepEqual(parsePending("✅ No migrations to apply!"), []);
  assert.throws(() => parsePending("✘ [ERROR] Authentication error"));
});

test("stop targets exactly the committed production Worker and databases, whatever the terms state", () => {
  const committed = parseJsonc(readFileSync(new URL("../wrangler.jsonc", import.meta.url), "utf8"));
  const generated = productionConfig(committed, "/api");
  assert.doesNotThrow(() => assertProductionTarget(committed, generated));
  assert.throws(() => assertProductionTarget(committed, { ...generated, name: "mannerpath-api-staging" }));
  const otherDb = structuredClone(generated);
  otherDb.d1_databases[1].database_id = committed.env.staging.d1_databases[1].database_id;
  assert.throws(() => assertProductionTarget(committed, otherDb));
  assert.throws(() => assertProductionTarget(committed, { ...generated, env: {} }));
  const src = readFileSync(new URL("../scripts/production-v1-stop.ts", import.meta.url), "utf8");
  assert.doesNotMatch(src, /intakeBlockers|CURRENT_REPORT_TERMS/, "stopping never depends on the terms");
  assert.match(src, /if \(secrets\.includes\(APP_ID\)\) \{/, "idempotent: deletes only a present App ID");
});
