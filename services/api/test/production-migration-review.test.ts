// Lane 2's content review is recorded separately from Lane 3's operational preflight.
// This test detects drift in the approved artifact; it never approves a new file or performs an operation.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { evaluate, EXPECTED_PENDING, type Observed } from "../scripts/production-v1-check.ts";
import { REPORT_TERMS } from "../src/reports/terms.ts";

const reviewedFiles = {
  DB: [
    "0031_derived_coordinate_evidence_guards.sql",
    "0032_location_precision_v2.sql",
    "0033_spot_evidence_holds.sql",
  ],
  REPORTS_DB: [
    "0004_report_idempotency.sql",
    "0005_app_attest_key_revocation.sql",
    "0006_bulk_report_rejection.sql",
    "0007_photo_deletion_attempts.sql",
    "0008_admin_review_audit.sql",
    "0009_new_spot_photo_gate.sql",
    "0010_new_spot_photo_erasure_window.sql",
    "0011_new_spot_independent_evidence.sql",
  ],
} as const;
const artifact = JSON.parse(readFileSync(new URL("../release/production-migration-review.json", import.meta.url), "utf8"));

test("Lane 2's committed decisions cover only the eleven independently reviewed migration files", () => {
  assert.ok(Array.isArray(artifact.reviews));
  const actual = artifact.reviews.map((r: { database: string; name: string }) => `${r.database}/${r.name}`);
  const expected = Object.entries(reviewedFiles).flatMap(([database, names]) => names.map((name) => `${database}/${name}`));
  assert.equal(new Set(actual).size, actual.length, "duplicate approvals are not allowed");
  assert.deepEqual(actual.sort(), expected.sort(), "future or unrelated files require a new independent review");
});

for (const [database, names] of Object.entries(reviewedFiles)) {
  for (const name of names) {
    test(`Lane 2 approval binds ${database}/${name} to its exact reviewed bytes`, () => {
      const review = artifact.reviews.find((r: { database: string; name: string }) => r.database === database && r.name === name);
      assert.ok(review);
      assert.equal(review.verdict, "approved");
      assert.equal(review.reviewedBy, "lane2");
      assert.match(review.sha256, /^[0-9a-f]{64}$/);
      const directory = database === "DB" ? "migrations" : "migrations-reports";
      const digest = createHash("sha256").update(readFileSync(new URL(`../${directory}/${name}`, import.meta.url))).digest("hex");
      assert.equal(review.sha256, digest, "SQL byte changes invalidate this approval");
    });
  }
}

// Exercise the actual #387 consumer offline. No observe(), remote CLI or HTTP probe is invoked.
function observation(): Observed {
  const terms = REPORT_TERMS[0];
  return {
    pending: structuredClone(EXPECTED_PENDING),
    fileSha256: (database, name) => createHash("sha256").update(readFileSync(new URL(`../${database === "DB" ? "migrations" : "migrations-reports"}/${name}`, import.meta.url))).digest("hex"),
    reviews: structuredClone(artifact.reviews), secrets: [],
    config: { status: 200, body: { reports: { available: false } } },
    readiness: { status: 503, body: null }, photoUpload: { status: 503, error: "photoEvidenceDisabled" },
    registrationChallenge: { status: 503, error: "attestationUnavailable" },
    buildNumbers: ["8"], terms,
    termsFileSha256: createHash("sha256").update(readFileSync(new URL(`../../../${terms.documentPath}`, import.meta.url))).digest("hex"),
  };
}

test("the real preflight accepts this reviewed artifact only for the exact pending files and bytes", () => {
  const o = observation();
  assert.ok(evaluate("before-db", o).every(([, outcome]) => outcome === "pass"));
  const fails = (value: Observed) => evaluate("before-db", value).some(([, outcome]) => outcome === "fail");
  assert.ok(fails({ ...o, fileSha256: () => "0".repeat(64) }), "changed SQL bytes are unapproved");
  assert.ok(fails({ ...o, reviews: o.reviews.slice(1) }), "missing approval");
  assert.ok(fails({ ...o, reviews: [...o.reviews, o.reviews[0]] }), "duplicate approval");
  assert.ok(fails({ ...o, reviews: o.reviews.map((r, i) => i === 0 ? { ...r, verdict: "rejected" } : r) }), "rejected file");
  assert.ok(fails({ ...o, pending: { ...o.pending, DB: [...o.pending.DB, "0034_unreviewed.sql"] } }), "unreviewed future file");
});

test("migration approvals cannot satisfy the separate draft-terms intake gate", () => {
  const o = observation();
  const gates = evaluate("after-intake", o).filter(([name]) => name.startsWith("terms gate:"));
  assert.ok(gates.length > 0);
  assert.ok(gates.every(([, outcome]) => outcome === "fail"));
});
