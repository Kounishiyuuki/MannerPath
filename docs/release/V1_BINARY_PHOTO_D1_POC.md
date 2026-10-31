# Binary photo upload + D1 photo store — PoC (configuration 3 of V1_FREE_TIER_ARCHITECTURE)

Status: **local PoC, not adopted** (2026-10-31). Code lives in `services/api/src/poc/binary-photo/` and is **not mounted
by `createApp`**; no shipped route, schema, migration, binding, Secret or Cloudflare resource changes. Photo intake
stays disabled. Builds on PR #357 (`jpeg-structure.ts`), whose validator this PoC also tightens (restart markers).

## 1. Protocol v3 (binary)

v2 today: image → base64 → inside payload JSON → base64 → inside envelope JSON. A 1 MB photo is a 1.9 MB body,
base64-decoded twice by a JS loop with a re-encode check and matched by a regex.

```
POST /v1/reports/{reportId}/photos          Content-Type: application/vnd.mannerpath.photo.v3
body       = uint32_be(headerLength) ‖ header ‖ image                       headerLength 2…4096, image 1…1,200,000 B (provisional cap; was 1.5 MB in the first PoC)
header     = {"schemaVersion":3,"payload":"<base64>","attestation":{"keyId","challenge","assertion"}}
payload    = {"schemaVersion":3,"kind":"photo","reportId","idempotencyKey","acceptedTermsVersion",
              "mediaType":"image/jpeg","byteLength","sha256"}               ≤ ~1 KiB, the only base64 left
clientData = frame("mannerpath.app-attest.photo.v3") ‖ frame(challenge) ‖ frame(keyId) ‖ frame(payload)
```

### App Attest properties kept (each has a test in `test/poc-binary-photo.test.ts`)

| Property | How | Test |
| --- | --- | --- |
| Signature covers the image | payload commits to `byteLength` + `sha256`; server recomputes both after verifying the assertion | tampered byte → `400 image: digest_mismatch`; truncated → `length_mismatch` |
| No replay | the report challenge is burned before anything is decoded (same `consumeReportChallenge` as v2) | identical body resent → `403` |
| Domain separation | new domain string; a report/v2 assertion over the same bytes never verifies | signed with report domain → `403 assertionInvalid` |
| Owner only | `submitter_hash` from the attested key must equal the report's | other device → `403 photoUnauthorized` |
| Counter, revocation, environment, bundle version | same `readKey` / `verifyAssertion` / `advanceCounterStatement` as v2 | covered by existing suites for those functions |
| Size limits | `Content-Length` pre-check, bounded streaming read, header ≤4 KiB, image ≤1.2 MB, total ≤1,204,100 B | 1.6 MB body → `413`; header 4,097 → `400` |
| Resend / idempotency | same draft key + same image with a fresh challenge → same `photoId`; same key + other image → `409` | yes |
| Attachments per report | 3 (existing trigger) | 4th → `photoAttachmentLimit` |

The iPhone change: keep `ReportPhotos.normalize`, then send the JPEG bytes raw with the header above and sign the
payload with the new domain. Server and client must ship together (App Review note: same data, different encoding).

## 2. Measured CPU (Node 24.21, Apple Silicon, process CPU per request; **not workerd**)

`scripts/photo-v3-cpu-poc.ts`, real v3 handler, node:sqlite for REPORTS_DB and PHOTOS_DB (DB and BLOB copy counted).
10 measured runs per file after one warm-up.

| Input | Bytes | Median | Min–max | Runs > 10 ms |
| --- | --- | --- | --- | --- |
| client-equivalent photos (8 files, ImageIO, ≤2 MP, q0.85) | 172 K–1.07 M | **0.9–2.5 ms** | 0.8–12.7 ms | 3 / 80 |
| near the cap, 1632×1224 | 1,471,032 | 4.2 ms | 3.7–16.5 ms | 1 / 10 |
| near the cap, 2048×976 | 1,472,588 | 4.0 ms | 3.5–16.4 ms | 2 / 10 |
| for comparison: v2 current route (PR #357) | same photos | 242–466 ms | — | all |
| retention pass, 5 photos fenced in PHOTOS_DB | — | 0.2–2.2 ms | — | 0 / 6 |

Verdict: **median well inside 10 ms; the tail is not.** 6 of 100 photo runs exceeded 10 ms (max 16.5 ms), most likely
GC pauses (not proven). Whether Cloudflare counts such pauses, and whether an occasional overrun fails the request or
is tolerated, is not documented — **this is not a PASS until measured on a deployed Workers Free Worker.** Lowering the
cap to 1.2 MB (all real client output ≤1.07 MB) removes the near-cap rows.

## 3. JPEG structure check — additional verification

- The app's `ReportPhotos.normalize`, copied verbatim (by script) and run under UIKit in an iOS 18.6 Simulator, on 15
  inputs (Simulator sample photos, wallpapers, a JPEG carrying GPS + camera model, grayscale, PNG with alpha, 1×1,
  2048-wide panorama, over-limit sizes). Every output the client produced (7) passed the server check; none contained
  `GPS`/`Exif`/camera strings. Together with 8 ImageIO-on-macOS outputs and 2 near-cap files: **17/17 accepted**.
- New strictness: with a restart interval, exactly `ceil(MCUs / interval) − 1` markers must appear, in order RST0…7.
  Tests: interval without markers, swapped, missing middle, missing last, extra marker — all refused.
- Total: 9 validator tests (incl. 5,000-case fuzz) + 8 PoC route/store tests, all passing.
- **Client-side finding (not changed here):** the same `normalize` refused 8/15 inputs before any upload: every HEIC
  (`[jpeg, png]` type check), every image wider/taller than 4,096 px (the 4,288 px Simulator photos; also any 24 MP
  iPhone photo, 5,712 px), and files over 8 MB. `PhotosPicker` + `loadTransferable(Data.self)` likely yields the HEIC
  original for camera photos — **unverified on a device**. If so, ordinary iPhone photos cannot be attached today.

## 4. D1 photo store (PHOTOS_DB)

| Item | Design | Evidence |
| --- | --- | --- |
| Where | a dedicated D1 database, not REPORTS_DB (keeps the report store's 500 MB for reports) | design |
| Row | `photo_objects(storage_key PK, state live/deleted, bytes BLOB, sha256, byte_length, …)` — one row per photo, one bound BLOB parameter | 1.07 MB round-trip byte-identical in a local workerd D1 check (wrangler local mode, earlier session, not committed) and in node:sqlite tests here |
| 2 MB limit | image cap 1.2 MB < 2,000,000 B | design; remote enforcement **unverified** (local accepted 2,000,001 B) |
| 100 KB statement limit | the BLOB is a bound parameter, not SQL text; whether D1 counts it toward 100 KB is **not documented** | **remote test required**; fallback: ≤90 KB chunk rows in one batch (≈14 statements at 1.2 MB, within 50 queries/invocation). **Update (probe PR): local workerd D1 accepted bound BLOBs of 90 KB … 2,000,001 B intact; a >100 KB SQL literal was refused (`SQLITE_TOOBIG`) — the bound parameter is not counted locally; remote still unverified** |
| Create-only put, identical retry, conflict | `INSERT … ON CONFLICT DO NOTHING` then compare | tests |
| Permanent fence | `live → deleted` only; triggers refuse resurrection, edits and row removal; delete before put creates the fence | tests |
| Residual bytes | **Superseded (probe PR):** local workerd D1 refuses `PRAGMA secure_delete` (`SQLITE_AUTH`), and batching it made the whole fence fail; the fence no longer uses it. Free pages keep fenced bytes until reused; `zeroblob()` overwrite does not help | node:sqlite: 1,987 fragments without the PRAGMA, 0 with it — but the PRAGMA is unavailable on D1. See V1_FREE_TIER_PROBE_RUNBOOK.md §3 |
| Space reuse | freed pages go to the free list and are reused; the file does not shrink | local: 50 MB live → fenced → 50 MB new → file stays 50.1–50.7 MB |
| Usage ledger | `photo_store_usage.live_bytes/live_count` maintained by triggers; insert refused at `budget_bytes` | test: budget reached → `503 photoIntakePaused`, reservation left for cleanup |

## 5. Capacity, Time Travel, deletion within 90 days, monitoring, pause

- **Budget**: `budget_bytes` default 400 MB (80 % of 500 MB). Because the file keeps its peak size, the budget bounds
  the peak, and the D1-reported database size (`meta.size_after`, unverified) is the second signal.
- **Account total 5 GB** is shared with DATA_DB and REPORTS_DB (their current sizes are not measured here).
- **Time Travel (7 days on Free, always on)** keeps restorable history of deleted photos. **Erasure lead** therefore
  = 7 days (Time Travel) + 1 day (a D1 daily-limit outage blocks every query until 00:00 UTC) + 1 day retry
  = **delete_after − 9 days**. A photo is reviewable for ~81 days. (Today's R2 path uses −24 h; this is a D1-specific
  change for the production PR, with the 0010 export gate updated to the same lead.)
- **Cron**: the existing 5-minute retention (5 photos/pass → up to 1,440/day; measured 0.2–2.2 ms/pass). Free plan
  allows 5 Cron Triggers per **account** — staging and production share them.
- **Alerts**: any `failed`/`overdue` retention outcome, `live_bytes > 0.8 × budget`, oldest queued deletion > 24 h.
- **Pause**: budget reached → `503 photoIntakePaused` (deletion never pauses). Daily D1 or Workers limits reached →
  the platform refuses everything until 00:00 UTC (Workers: error 1027 — set write routes fail-closed).

## 6. Operator display (Admin)

`display.ts`: the stored JPEG is re-checked and then decoded by the bounded JS decoder and re-encoded to a fresh PNG
**on the operator's machine** (no CPU limit) before any byte reaches the browser; the uploaded bytes never do. Test:
output is PNG, differs from the upload, and an EXIF-carrying JPEG is refused. Production change: `private-photo-view.ts`
accepts `image/jpeg` rows and calls this before serving (today it only accepts PNG).

## 7. No regression of review, deletion and publication gates

Shipped code paths are unchanged (PoC is not mounted). PoC tests show: a pending photo counts 0 in
`photoEvidenceStrength`; approval counts 1; after retention it counts 0, the D1 object is fenced, the budget returns
to 0, and a late put is refused. `make api-validate` result is in the PR.

## 8. Only on real Cloudflare (each needs separately approved resources)

1. CPU of the v3 route and of retention as Cloudflare counts it, incl. tail and GC, on **Workers Free**.
2. D1: a 1.2 MB bound BLOB (statement-length rule), the 2 MB limit, `PRAGMA secure_delete` acceptance in a batch,
   `meta.size_after` behavior after fences, rows-read/written accounting of BLOB rows.
3. Time Travel retention of fenced rows, and whether a restore can resurrect a fenced photo (procedure: never restore
   PHOTOS_DB; document as operational rule).
4. Error 1027 behavior and fail-closed routing on Free; daily-limit behavior for D1 mid-batch.
5. Device: the iPhone's actual `normalize` output for camera photos (HEIC, 24/48 MP) and the client refusal above.

## 9. Recommendation

Keep configuration 3 as the first candidate: binary v3 + strict JPEG check + local re-encode in Admin + D1 photo store
without secure_delete (unavailable; residue accepted or not by the operator), −9 day erasure lead and an 80 % budget. Do not adopt until §8.1–8.2 pass on a Free Worker. The
client HEIC/size refusal (§3) must be resolved for photos to work at all, whichever storage is chosen.

Production PRs (none started): (1) iPhone: accept HEIC/large originals by downscaling before the size check; send v3.
(2) API: v3 route + `attachEvidencePhoto` split into prepare/attach (no copy) + JPEG-at-rest migration (table rebuild
of `community_evidence_photos`, reviewed like 0003). (3) PHOTOS_DB store + migration + erasure lead −9 d + gate 0010
update. (4) Admin JPEG display path. (5) Free-Worker measurement (approved resources) before any activation decision.
