// checkReportBudget reads every window in one D1 query (a Workers Free CPU saving, docs/release/V1_PHOTO_FREE_NEW_SPOT.md §5).
// It must still refuse on whichever window is full, answer that window's Retry-After, and ignore other submitters and
// past windows. The limit itself stays with the commit-time trigger (report-idempotency.test.ts "C").
import { test } from "node:test";
import assert from "node:assert/strict";
import { checkReportBudget, REPORT_RATE_LIMITS } from "../src/reports/rate-limit.ts";
import { reportsD1 } from "./support/sqlite-d1.ts";

const NOW = new Date("2026-10-13T03:20:00Z"); // 40 min to the hour window's end, 20 h 40 min to the day's
const HOUR = REPORT_RATE_LIMITS.find((l) => l.kind === "hour")!.max;
const DAY = REPORT_RATE_LIMITS.find((l) => l.kind === "day")!.max;
const ME = "a".repeat(64), OTHER = "b".repeat(64);

test("the single budget query refuses on the full window with its own Retry-After, and nothing else", async () => {
  const db = reportsD1();
  const put = (who: string, kind: string, start: string, n: number) => db.raw.prepare(`INSERT INTO report_rate_windows
    (submitter_hash, window_kind, window_start, report_count, expires_at) VALUES (?, ?, ?, ?, '2026-10-15T00:00:00Z')`).run(who, kind, start, n);
  assert.deepEqual(await checkReportBudget(db, ME, NOW), { allowed: true });

  put(OTHER, "hour", "2026-10-13T03:00:00Z", HOUR); // another submitter's full window
  put(ME, "hour", "2026-10-13T02:00:00Z", HOUR); // my previous hour
  put(ME, "day", "2026-10-13T00:00:00Z", DAY - 1);
  assert.deepEqual(await checkReportBudget(db, ME, NOW), { allowed: true });

  db.raw.exec(`UPDATE report_rate_windows SET report_count = ${DAY} WHERE submitter_hash = '${ME}' AND window_kind = 'day'`);
  assert.deepEqual(await checkReportBudget(db, ME, NOW), { allowed: false, retryAfterSeconds: 20 * 3600 + 40 * 60 });

  put(ME, "hour", "2026-10-13T03:00:00Z", HOUR); // both full: the hour window answers first, as before
  assert.deepEqual(await checkReportBudget(db, ME, NOW), { allowed: false, retryAfterSeconds: 40 * 60 });
});
