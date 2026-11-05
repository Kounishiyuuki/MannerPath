// The staged production preflight (docs/release/V1_PRODUCTION_INTAKE.md §5): each stage passes only on its expected
// state, after-intake never passes on unapproved terms, and the migration gate takes only Lane 2's exact bytes.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { APP_ID, PEPPERS, type Observed, type Stage, evaluate, parsePending } from "../scripts/production-v1-check.ts";
import { REPORT_TERMS } from "../src/reports/terms.ts";

const draft = REPORT_TERMS[0];
const approved = { ...draft, version: "report-terms.2026-12-01", publicationRights: "granted" as const };
const v1Config = (available: boolean, terms = draft) => ({ status: 200, body: {
  schemaVersions: { report: 3 }, minimumSupportedSchemaVersions: { report: 3 },
  reports: { available, photoEvidenceEnabled: false, termsVersion: terms.version },
} });
const base = (over: Partial<Observed> = {}): Observed => ({
  pending: { DB: [], REPORTS_DB: [] }, fileSha256: () => "a".repeat(64), reviews: [], secrets: [...PEPPERS],
  config: v1Config(false), readiness: { status: 200, body: { state: "completed" } },
  photoUpload: { status: 503, error: "photoEvidenceDisabled" },
  registrationChallenge: { status: 503, error: "attestationUnavailable" },
  buildNumbers: ["8", "8"], terms: draft, termsFileSha256: draft.documentSha256, ...over,
});
const failed = (stage: Stage, o: Observed) => evaluate(stage, o).filter(([, ok]) => !ok).map(([n]) => n);

test("after-deploy and stopped pass only with intake closed for every key", () => {
  assert.deepEqual(failed("after-deploy", base()), []);
  assert.deepEqual(failed("stopped", base()), []);
  const open = base({ secrets: [...PEPPERS, APP_ID], config: v1Config(true), registrationChallenge: { status: 503, error: "registrationPaused" } });
  assert.equal(failed("stopped", open).length, 3);
  assert.equal(failed("after-deploy", base({ secrets: [] })).length, 2, "both peppers");
  assert.equal(failed("after-deploy", base({ photoUpload: { status: 400 } })).length, 1);
});

test("after-intake never passes on the draft terms, even when everything remote is open", () => {
  const open = base({ secrets: [...PEPPERS, APP_ID], config: v1Config(true) });
  assert.equal(failed("after-intake", open).filter((n) => n.startsWith("terms gate")).length, 2);
  assert.deepEqual(failed("after-intake", { ...open, terms: approved, termsFileSha256: approved.documentSha256, config: v1Config(true, approved) }), []);
});

test("before-db takes only Lane 2's approval of the exact bytes of each unapplied migration", () => {
  const pending = { DB: ["0031_x.sql"], REPORTS_DB: ["0004_y.sql"] };
  const ok = (sha: string, verdict: "approved" | "rejected" = "approved") => [
    { database: "DB" as const, name: "0031_x.sql", sha256: sha, verdict, reviewedBy: "lane2" },
    { database: "REPORTS_DB" as const, name: "0004_y.sql", sha256: sha, verdict, reviewedBy: "lane2" }];
  assert.equal(failed("before-db", base({ pending })).length, 2);
  assert.deepEqual(failed("before-db", base({ pending, reviews: ok("a".repeat(64)) })), []);
  assert.equal(failed("before-db", base({ pending, reviews: ok("b".repeat(64)) })).length, 2, "changed bytes");
  assert.equal(failed("before-db", base({ pending, reviews: ok("a".repeat(64), "rejected") })).length, 2);
  assert.equal(failed("before-db", base({ pending: { DB: [], REPORTS_DB: ["0012_z.sql"] } })).length, 2, "outside 0004-0011, unreviewed");
  assert.equal(failed("after-db", base({ pending })).length, 2);
});

test("local checks: build 8 everywhere and the terms bytes match their registered hash", () => {
  assert.equal(failed("after-deploy", base({ buildNumbers: ["8", "7"] })).length, 1);
  assert.equal(failed("after-deploy", base({ termsFileSha256: "0".repeat(64) })).length, 1);
});

test("parses wrangler's migration table and the empty case; the committed review list starts empty", () => {
  assert.deepEqual(parsePending("│ Name │\n│ 0031_a_b.sql │\n│ 0032_c.sql   │"), ["0031_a_b.sql", "0032_c.sql"]);
  assert.deepEqual(parsePending("✅ No migrations to apply!"), []);
  const review = JSON.parse(readFileSync(new URL("../release/production-migration-review.json", import.meta.url), "utf8"));
  assert.deepEqual(review.reviews, []);
});
