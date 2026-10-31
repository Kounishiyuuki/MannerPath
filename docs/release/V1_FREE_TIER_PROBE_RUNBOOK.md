# Free-tier probe — real Cloudflare verification of configuration 3 (prepared, NOT RUN)

Status: **prepared 2026-10-31; nothing created, deployed or run on Cloudflare.** Every remote step below needs the
operator's approval first. Production, staging, R2 and Workers Paid are out of scope and untouched. Builds on #357
(free-tier review) and #358 (binary v3 + D1 photo store PoC).

## 1. What the probe answers that local runs cannot

| # | Question | Local evidence so far | Pass condition on Cloudflare |
| --- | --- | --- | --- |
| F1 | v3 photo upload CPU on **Workers Free** (10 ms) | Node: median 0.9–2.5 ms, 6/100 > 10 ms (#358) | 100 uploads, **0** CPU-limit failures, analytics `cpuTimeP99` ≤ 8 ms |
| F2 | Retention pass CPU (Cron) | Node 0.2–2.2 ms | 0 failures, P99 ≤ 8 ms (if the optional Cron is enabled) |
| F3 | Registration + challenge CPU | Node 3.4–4.4 ms | 0 failures |
| F4 | D1 bound BLOB 1.2 MB vs the 100 KB statement limit | local workerd: 90 KB … 2,000,001 B all accepted and intact; SQL literal > 100 KB → `SQLITE_TOOBIG` | 1.2 MB insert + intact read-back |
| F5 | D1 2 MB row limit enforcement | local accepts 2,000,001 B (not enforced locally) | record actual behavior |
| F6 | `PRAGMA secure_delete` | **local workerd D1: `SQLITE_AUTH` (refused)** | record; expected refused |
| F7 | Photo-store fence on D1 | local workerd: re-put, resurrect UPDATE, row DELETE all refused | same |
| F8 | Time Travel: a restore to before the fence returns the photo; window length on Free | not testable locally | bytes come back after restore (confirms the −9 day lead is necessary); `time-travel info` shows ≤ 7 days |
| F9 | Importing the report schema (incl. 0003 triggers with `CASE`) via `d1 execute --file` | local import: 114 statements OK | import succeeds (a known `migrations apply` failure for 0003 exists, REPORTS_MIGRATION_RECOVERY.md) |
| F10 | Workers rate-limit binding on Free | not documented | deploy accepts `ratelimits` and challenges are served |

## 2. Code (this PR)

| File | Role |
| --- | --- |
| `src/poc/free-tier-probe/worker.ts` | Probe Worker. Every route needs a bearer-token header carrying the `PROBE_TOKEN` Secret; both DBs must hold the probe identity row; trusts only the driver's **test** App Attest root. Routes: real challenge/key routes, v3 photo route, synthetic report, D1 checks, retention; optional Cron |
| `src/poc/free-tier-probe/d1-checks.ts` | F4–F7 facts with D1 `meta` (rows written, `size_after`) |
| `src/poc/binary-photo/erasure.ts` | −9 day erasure lead (7 Time Travel + 1 outage + 1 retry), refuses a lead ≤ 7 |
| `scripts/free-tier-probe-config.ts` | Writes `.wrangler/free-tier-probe/worker.jsonc` + schema files; refuses committed/placeholder/equal IDs; no `env` block |
| `scripts/free-tier-probe-run.ts` | Driver: only loopback or `https://mannerpath-free-tier-probe.<sub>.workers.dev` with `--confirm-probe`; ≤ 120 uploads, ≤ 100 MB per run; stops at the first unexpected status; token only from the environment |
| `scripts/free-tier-probe-analytics.ts` | One read-only GraphQL call: requests, errors, `cpuTimeP50/P99` by status for the probe script |
| tests | `free-tier-probe-guards`, `poc-photo-erasure-lead`, `poc-binary-photo` (incl. the residue limitation), `jpeg-structure` |

Provisional limits (2026-10-31): 1.2 MB per photo (`PHOTO_V3_IMAGE_MAX_BYTES`), 3 per report (existing trigger),
photo store budget 400 MB = 80 % of a 500 MB D1 database (→ `503 photoIntakePaused`), erasure from `delete_after − 9 d`,
and no new photo for a report inside that lead (`410 reportExpired`).

## 3. Local rehearsal (done, workerd via `wrangler dev --local`)

```sh
npm run free-probe:config -- --local
D=.wrangler/free-tier-probe-local
npx wrangler d1 execute REPORTS_DB --local --config $D/worker.jsonc --persist-to $D/state --file $D/reports-schema.sql -y
npx wrangler d1 execute PHOTOS_DB  --local --config $D/worker.jsonc --persist-to $D/state --file $D/photos-schema.sql -y
# $D/.dev.vars (git-ignored, mode 600): PROBE_TOKEN, REPORT_SUBMITTER_PEPPER, RATE_LIMIT_KEY_PEPPER — random, synthetic
npx wrangler dev --local --config $D/worker.jsonc --persist-to $D/state --port 8799 --ip 127.0.0.1
PROBE_TOKEN=… npm run free-probe:run -- --base-url http://127.0.0.1:8799 --photos <client-equivalent jpegs> --uploads 10
```

Result: request without token → 404; register 201; 10/10 uploads 201 (0.17–1.07 MB); usage ledger 5,712,832 B / 10;
retention `complete`; D1 facts as in §1 (F4, F6, F7). It found and fixed two defects before any remote run: a named
export in the Worker entry (workerd refused to start) and a fence batched with `PRAGMA secure_delete`, which D1 refuses —
the whole fence failed and a later put was accepted. The fence no longer depends on the PRAGMA.

**Known limitation (pinned by a test):** without `secure_delete`, SQLite keeps a fenced photo's bytes in free pages until
they are reused; overwriting with `zeroblob()` first does not help (49,470 of 49,731 fragments remained). Those pages
are unreachable through SQL, export or the adapter, but they are provider-held copies of the class already accepted for
R2 in PHOTO_STORAGE_OPERATIONS.md. **The operator (and counsel) must accept or reject this before production.**

## 4. Cloudflare resources (operator, after approval)

| Resource | Name | Notes |
| --- | --- | --- |
| Account plan | **Workers Free**, no payment method, no R2 subscription | check Billing in the dashboard first |
| Worker | `mannerpath-free-tier-probe` | workers.dev only, no route/custom domain, preview URLs off |
| D1 | `mannerpath-free-tier-probe-reports` | report stream (0003 widened to `image/jpeg`) + probe identity |
| D1 | `mannerpath-free-tier-probe-photos` | photo store + probe identity/config/check tables |
| Secrets | `PROBE_TOKEN`, `REPORT_SUBMITTER_PEPPER`, `RATE_LIMIT_KEY_PEPPER` | fresh random ≥ 32 chars, interactive entry, never reused anywhere |
| Rate-limit binding | `CHALLENGE_RATE_LIMITER` namespace `9701`, 120/60 s | F10 |
| Cron (optional) | `*/5 * * * *` | uses 1 of the account's 5 Free Cron Triggers |
| API token (analytics) | Account Analytics: Read | read-only, revoke after |

## 5. Operator procedure (each numbered step: approval → run → record → stop on surprise)

```sh
cd services/api
# 1. Create (two DBs) and record the UUIDs.
npx wrangler d1 create mannerpath-free-tier-probe-reports
npx wrangler d1 create mannerpath-free-tier-probe-photos
# 2. Generate the isolated config (no Cron first).
npm run free-probe:config -- --reports-database-id <uuid> --photos-database-id <uuid>
D=.wrangler/free-tier-probe
# 3. Import schemas (F9). On failure: STOP, record the error; do not retry blindly.
npx wrangler d1 execute REPORTS_DB --remote --config $D/worker.jsonc --file $D/reports-schema.sql
npx wrangler d1 execute PHOTOS_DB  --remote --config $D/worker.jsonc --file $D/photos-schema.sql
# 4. Secrets (interactive) and deploy (F10 shows here).
npx wrangler secret put PROBE_TOKEN --config $D/worker.jsonc
npx wrangler secret put REPORT_SUBMITTER_PEPPER --config $D/worker.jsonc
npx wrangler secret put RATE_LIMIT_KEY_PEPPER --config $D/worker.jsonc
npx wrangler deploy --config $D/worker.jsonc
curl -s -o /dev/null -w '%{http_code}\n' https://mannerpath-free-tier-probe.<sub>.workers.dev/probe/usage   # expect 404
# 5. Runs: 10 uploads, then 100 (record UTC start/end of each).
PROBE_TOKEN=… npm run free-probe:run -- --base-url https://mannerpath-free-tier-probe.<sub>.workers.dev \
  --photos <client-equivalent jpegs ≤1.2 MB> --uploads 10 --confirm-probe mannerpath-free-tier-probe
#    …then --uploads 100.
# 6. CPU (F1/F3), ≥ 10 min after the run.
CLOUDFLARE_API_TOKEN=… npm run free-probe:analytics -- --account-id <32-hex> --since <start> --until <end>
# 7. Time Travel (F8): use "key" and "fencedAfter" from the d1-checks "store.delete (fence)" line.
npx wrangler d1 time-travel info mannerpath-free-tier-probe-photos --timestamp <fencedAfter>
npx wrangler d1 time-travel restore mannerpath-free-tier-probe-photos --bookmark <bookmark>    # disposable DB only
npx wrangler d1 execute PHOTOS_DB --remote --config $D/worker.jsonc \
  --command "SELECT state, length(bytes) FROM photo_objects WHERE storage_key = '<key>'"     # expect live + bytes
# 8. Optional Cron (F2): regenerate with --cron, deploy, wait 30 min, analytics, then regenerate without --cron and deploy.
```

## 6. Load, free-tier usage and limits (per full run: 10 + 100 uploads + checks)

| Quota (Free, per account per day unless noted) | Probe use | Share |
| --- | --- | --- |
| Workers requests 100,000/day | ≈ 3 per upload + ~10 → ≈ 345 | 0.3 % |
| Workers CPU 10 ms per invocation | measured, not consumed | — |
| D1 rows written 100,000/day | ≈ 10 per upload + checks ≈ 1,200 | 1.2 % |
| D1 rows read 5,000,000/day | < 10,000 | < 0.2 % |
| D1 storage 500 MB per DB, 5 GB account | photos ≤ 110 × 1.07 MB ≈ 118 MB worst case (+ ≤ 14 MB transient checks) | ≤ 27 % of one DB |
| Cron Triggers 5/account | 0 (1 if F2 is run) | — |
| Cron runs if enabled | 288/day | 0.3 % of requests |

**Billing risk.** Workers Free has no usage billing; over a limit, requests fail (Workers 1027, D1 errors until 00:00
UTC). The risk is only that the account is *not* on Free: if Workers Paid or an R2 subscription exists, usage beyond
allowances is billed and Cloudflare documents no hard cap. Check Billing before step 1. The probe uses no R2.

**Stop conditions.** Any unexpected status (the driver stops itself), any analytics row with a non-`success` status,
any D1 daily-limit error, any schema import error, or the dashboard showing a paid plan. Stop = do not continue;
`wrangler delete` the Worker if traffic must end now (cleanup below).

## 7. Cleanup (separate approval; synthetic data only)

```sh
npx wrangler delete --config .wrangler/free-tier-probe/worker.jsonc
npx wrangler d1 delete mannerpath-free-tier-probe-reports
npx wrangler d1 delete mannerpath-free-tier-probe-photos
rm -rf services/api/.wrangler/free-tier-probe services/api/.wrangler/free-tier-probe-local
# revoke the analytics API token; the three probe Secrets disappear with the Worker
```

Unlike the durable report store, these databases hold only synthetic data created by the driver, so deleting them is
the intended end state. Record names, times and aggregate results before deleting.

## 8. Conditions for moving to a production implementation

All of: F1 and F3 pass; F2 passes if Cron is used; F4, F7, F9, F10 pass; F5, F6, F8 recorded and the designs here hold
(a 1.2 MB cap below the enforced row limit; fence without `secure_delete`; −9 day lead covers the observed Time Travel
window); the operator and counsel accept the free-page residue (§3); the iPhone HEIC / > 4,096 px refusal is fixed and
a device run passes (#358 §3); plus the existing activation decisions (#124 terms, ADR-0021 D1/D6, App Privacy).
If F1 fails, configuration 3 is not viable on Workers Free as built; record the numbers and return to the options in
V1_FREE_TIER_ARCHITECTURE.md rather than relaxing a check.
