// TEST ONLY. Adds verification states the reviewed Taito fixture never produces to a COPY of the local D1 database,
// so the iPhone UI tests can render them in the real app (scripts/run-iphone-ui-tests.sh, visual-audit phase):
//   - an ADR-0017 areaApproximate spot inside a park (test/support/area.ts, the same pipeline the API tests run);
//   - an ADR-0012 communityReported spot from one moderated report (REPORTS_DB is in memory and discarded).
// The community source stays blocked and the report terms stay draft in the code and registry; this copy simulates
// their approval by hand, exactly as test/coverage-first-multiconfidence.test.ts does. It never runs against the
// default local state, a remote database, or anything a release is built from.
//
//   node --experimental-strip-types --no-warnings scripts/local-ui-fixture.ts <miniflare D1 sqlite file>
import { DatabaseSync } from "node:sqlite";
import { isoSeconds } from "../src/db.ts";
import { COMMUNITY_SOURCE_ID } from "../src/pipeline/community-adapter.ts";
import { applyCommunityApplication } from "../src/pipeline/community-reconciliation.ts";
import { createReport } from "../src/reports/create.ts";
import { recordModerationDecision, setReconciliationState } from "../src/reports/moderation.ts";
import { CURRENT_REPORT_TERMS } from "../src/reports/terms.ts";
import { publishTiles } from "../src/tiles/publish.ts";
import { areaPipeline } from "../test/support/area.ts";
import { proposeNewSpot, reportsOf, storesOf } from "../test/support/community.ts";
import { sequentialSpotIds } from "../test/support/fixture.ts";
import { SqliteD1 } from "../test/support/sqlite-d1.ts";

const file = process.argv[2];
if (process.argv.length !== 3 || !file.includes(".wrangler/state.ui-fixture/")) {
  throw new Error("local-ui-fixture: pass the D1 sqlite file of the .wrangler/state.ui-fixture copy, and nothing else");
}
const raw = new DatabaseSync(file);
raw.exec("PRAGMA foreign_keys = ON;");
const db = new SqliteD1(raw);
const now = new Date();

// ADR-0017: 公園内喫煙所 is stated only as inside 上野恩賜公園, ~400 m from the UI tests' fixed location.
await areaPipeline({ db });

// ADR-0012: one moderated user report, within the 50 m duplicate radius of the UI tests' fixed location.
const { reportId } = await createReport(reportsOf(db), {
  schemaVersion: 1, type: "missing", proposedLocation: { latitude: 35.7119, longitude: 139.7776 },
  installId: "8f1c4d2e-0a3b-4c5d-8e9f-0a1b2c3d4e5f", note: "TEST ONLY", acceptedTermsVersion: CURRENT_REPORT_TERMS.version,
  claim: { spotType: "ashtray", hostType: "convenienceStore", environment: "outdoor", accessType: "public" },
} as never, { now, attestationStatus: "notProvided", submitterHash: "0123456789abcdef".repeat(4) });
await recordModerationDecision(reportsOf(db), reportId, { state: "accepted", decidedBy: "ui-fixture", reason: "confirmed", now });
await setReconciliationState(reportsOf(db), reportId, "queued", now);
const applicationId = await proposeNewSpot(storesOf(db), {
  reportIds: [reportId], locationReportId: reportId, decidedBy: "ui-fixture", now, tier: "communityReported",
});
await applyCommunityApplication(db, applicationId, { now, newSpotId: sequentialSpotIds("C") });
raw.prepare(
  `UPDATE sources SET publication_status = 'approved', attribution_text = 'TEST ONLY simulated community attribution',
     license_name = 'TEST ONLY simulated report terms', license_url = 'https://example.invalid/report-terms' WHERE source_id = ?`,
).run(COMMUNITY_SOURCE_ID);
raw.prepare("UPDATE report_terms_versions SET publication_rights = 'granted' WHERE terms_version = ?").run(CURRENT_REPORT_TERMS.version);

console.log("publish", JSON.stringify((await publishTiles(db, { now: isoSeconds(now) })).published.length), "tiles");
raw.close();
