# v1.0 at zero monthly cost — architecture review and photo PoC

> **2026-11-01 結果：** Workers Free での写真受付はすべての検証構成で NO-GO（構成3・A1 を含む、CPU P99 > 8 ms）。
> 採用された構成はない。詳細と v1.0 の方針は [V1_PHOTO_FREE_RELEASE_PLAN.md](V1_PHOTO_FREE_RELEASE_PLAN.md)。

Status: **design + local PoC only (2026-10-31, main `1e2d009`)**. Nothing here changes a route, a schema, a Cloudflare
resource, a plan or production intake. Workers Paid is **not** approved. Every remote or production claim below is
either quoted from a source with its date or marked unverified.

## 1. Free tiers and limits (sources read 2026-10-31)

| Service | Fixed fee | Free allowance | Over the allowance | Hard spend cap | Payment method | Shared between staging and production |
| --- | --- | --- | --- | --- | --- | --- |
| Workers Free | 0 | 100,000 requests/day (reset 00:00 UTC); **10 ms CPU per HTTP request and per Cron run**; 5 Cron Triggers/account; 50 subrequests/invocation; 100 Workers/account [L] | Error 1027; the route's fail-open/fail-closed mode decides the response [L]. The pricing page lists no Free overage rate (inferred: no usage billing) | n/a (no billing) | not required for Free (**unverified** on this account) | **Yes**: limits are per account |
| Workers Paid | USD 5/month minimum | 10M requests, 30M CPU-ms/month [P] | billed per million [P] | **none documented**; only a per-invocation CPU limit "to prevent accidental runaway bills" [P] | required | per account |
| D1 (Free) | 0 | 5M rows read/day, 100k rows written/day, 5 GB total; 10 DBs, **500 MB per DB**; 2 MB max row/BLOB; 50 queries/invocation; Time Travel **7 days** [DP][DL][TT] | "you will not be able to run queries against D1" until 00:00 UTC [DP] | n/a on Free | — | per account |
| R2 Standard | 0 | 10 GB-month, 1M Class A, 10M Class B per month, free egress [R] | per-unit rates [R] | **none documented** [R][B] | "Complete the checkout flow to add an R2 subscription" [RG]; whether a card is needed is **unverified** | per account |
| Edge rate-limiting rule (WAF) | 0 | **1 rule**, IP only, 10 s period, 10 s mitigation, block only [W] | — | — | — | per zone; **needs a custom-domain zone** (workers.dev has none) — unverified for this account |
| Workers rate-limit binding | not stated | period 10 or 60 s; approximate; per Cloudflare location, not global [RL] | — | — | — | per namespace |
| GitHub Pages (public repo) | 0 | 1 GB site, soft 100 GB/month bandwidth [GH] | soft limits | — | — | one site |
| MapKit (iOS, native) | covered by the Apple Developer Program (USD 99/year, already required for the App Store) | MapKit JS / server: 250k views + 25k service calls/day per membership [MK]; native MapKit pricing not stated on that page | — | — | — | — |

Sources: [L] developers.cloudflare.com/workers/platform/limits · [P] …/workers/platform/pricing (updated 2026-10-02) ·
[DP] …/d1/platform/pricing (2026-10-30) · [DL] …/d1/platform/limits · [TT] …/d1/reference/time-travel (2026-04-21) ·
[R] …/r2/pricing (2026-10-30) · [RG] …/r2/get-started · [B] …/billing/understand/billing-policy (2026-05-29) ·
[W] …/waf/rate-limiting-rules (2026-08-25) · [RL] …/workers/runtime-apis/bindings/rate-limit ·
[GH] docs.github.com/…/github-pages-limits · [MK] developer.apple.com/maps/mapkitjs.

**Consequence.** The only way to make a *hard* zero bill is to use nothing that can bill: Workers Free + D1 Free on an
account with no paid subscription. Once R2 (a subscription with usage billing and no documented cap) or Workers Paid is
added, the bill is zero only while usage stays inside the allowance; Cloudflare documents no hard cap.

## 2. Measurements (local, Node 24.21, Apple Silicon; **not workerd**)

Inputs: the iOS Simulator's sample photos and two macOS wallpapers, run through a Swift copy of
`ReportPhotos.normalize` (≤2 MP, ≤2048 px, opaque, JPEG q0.85, APP1–15/COM removed). Outputs were 172–1,073 KB; every
file was APP0(JFIF, no thumbnail) → SOF0 baseline 4:2:0 → DHT×4, DQT×2, DRI → one 3-component scan → EOI, no trailing
bytes. Harness: `services/api/scripts/photo-cpu-poc.ts` runs the real route in-process (node:sqlite instead of D1, so
DB CPU is over-counted); process CPU per request, median of 7 after one warm-up run.

| Route / step | CPU (median) |
| --- | --- |
| `GET /v1/config` | 0.2 ms |
| App Attest registration (test PKI chain) | 3.4–4.4 ms |
| Attested text-only report `POST /v1/reports` | 0.7–1.4 ms |
| Photo route, **current** (jpeg-js decode → PNG encode) | 242–466 ms |
| …of which `sanitizeEvidencePhoto` alone | 215–381 ms |
| Photo route, **B** (structure check instead of re-encode; shipped base64 decoder) | 10.6–77 ms |
| Photo route, **B + strict atob decoder** (no JS re-encode check) | 4.4–23 ms (172 KB → 4.4; 409–658 KB → 11–15; 877 KB → 20.5; 1,073 KB → 23.2) |
| `validateJpegStructure` alone | 0.2–1.3 ms |
| Stored size: current PNG derivative vs client JPEG | 1.12–5.58 MB vs 0.17–1.07 MB (×4.6–10.0) |

What remains in B is transport, not imaging: the body is base64 inside JSON inside base64; a 1 MB photo becomes a
1.9 MB request, decoded twice and matched by a `^[A-Za-z0-9+/]+={0,2}$` Zod regex (≈10 ms per 1 MB photo in the
profile). A binary body would remove all three; its cost was **not measured** (it needs a protocol change). Estimated
from measured parts only (text report 0.8 ms + SHA-256 of 1 MB ≈0.6 ms + structure check ≤1.3 ms) it would be ≈3 ms in
Node — an estimate, not a PASS.

Not established by any of this: CPU in workerd as Cloudflare counts it, and whether Cloudflare enforces 10 ms strictly
per request. Measure on a deployed Free Worker before relying on any figure (needs a separately approved resource).

## 3. Photo options

| | A. Optimize the server re-encode | B. iPhone re-encodes, Worker checks structure | C. Quarantine, operator re-processes locally | D. Other free storage (D1 instead of R2) |
| --- | --- | --- | --- | --- |
| Fits 10 ms | **No** in any variant measured: decode alone is 200+ ms in JS; WASM/native codecs not measured | Only with smaller images or binary transport (§2); not proven on workerd | Upload path = B's check (C alone stores unchecked bytes) | Storage choice; CPU as B |
| Modified client sends a hostile file | Decoded by the Worker | Strict allowlist: SOI, one JFIF APP0 without thumbnail, DQT, DHT, SOF0 (8-bit, 1/3 components, sampling ≤2), DRI, one full baseline scan, only `FF00`/RST in data, EOI last; ≤2048 px, ≤2 MP, size cap. Everything else refused (`test/jpeg-structure.test.ts`, 8 tests incl. 5,000-case fuzz) | Same as B on upload | Same as B |
| EXIF/GPS/XMP/ICC/comments/thumbnails/appended files | Removed by re-encode | **Refused** (not stripped): no segment that can hold them is accepted; the client already strips them, so honest uploads pass | Same | Same |
| Data hidden in pixels or entropy bytes | Survives re-encode as pixels | Survives (same as today in substance) | Same | Same |
| Decoder exploits / decompression bombs | Worker decoder (JS, bounded) | **No server decode.** Whoever decodes must be bounded: Admin should re-encode through the existing `sanitizeEvidencePhoto` locally (no CPU limit) before the browser sees it | This is C's role | — |
| App Attest on upload | unchanged | unchanged (assertion over the payload) | unchanged | unchanged |
| Private viewing | unchanged | unchanged; JPEG instead of PNG at rest | unchanged | D1 binding only via the loopback Admin; no URL exists |
| Deletion ≤ 90 days, permanent fence | R2 marker overwrite | as today | as today | `bytes = NULL` + trigger refusing re-PUT and re-insert (local PoC: refused both). **Time Travel keeps 7 days of history** → start erasure at `delete_after − 8 days` |
| Unreviewed photo never published | unchanged (photos are never public; 0009/0010 gates) | unchanged | unchanged | unchanged |
| Storage per photo | PNG derivative **1.12–5.58 MB measured** (4.6–10× the client JPEG); above D1's 2 MB row limit | JPEG 0.17–1.07 MB measured | same as B | same as B |
| Monthly cost | Paid USD 5 | 0 within allowances | 0 | **0, hard** (no billing product) |
| Change size | — | server: validator, migration for `image/jpeg`, faster decoder or binary body; iPhone: none for the format, protocol change for binary | Admin: local re-encode before display | new D1 store + adapter + migration; retire R2 adapter path |

Rejected: removing server-side checks without B's allowlist; C alone (stores unchecked bytes, may hold metadata).

## 4. Configurations compared

| | 1. As built (Workers Paid + R2) | 2. Workers Free + B + R2 | 3. Workers Free + B + C + D1 photo store (**recommended to evaluate**) |
| --- | --- | --- | --- |
| Monthly | ≥ USD 5 | 0 inside allowances; overage billed | 0, and nothing that can bill |
| Hard zero | No | No (R2 has no documented cap) | **Yes, if** the account holds no paid subscription and no card — **unverified** |
| Security vs today | baseline | equal on metadata (refuse vs strip), weaker on "server decoded it once", offset by Admin re-encode | as 2; fence semantics simpler (SQL trigger) but Time Travel window adds 7 days of provider-held history |
| Capacity | R2 10 GB free; at the measured ~3.7 MB mean PNG, 1,000 reports × 3 photos held 90 days ≈ 11 GB — **over** the free 10 GB | R2 10 GB free; same load as JPEG ≈ 1.8 GB | 500 MB per photo DB (≈470–2,900 photos at 1.07–0.17 MB) within the 5 GB **account** total that also holds DATA_DB and REPORTS_DB |
| Engineering | done | M | M–L |
| Operator load | as planned | as planned + local re-encode is automatic in Admin | same as 2 |
| Release change | none | 3–4 PRs | 4–5 PRs |

## 5. Staying inside the allowances (proposal; values for the maintainer to set)

- **Per photo** ≤ 1.2 MB (all measured client output fits; lowering q to 0.75 or 1.5 MP gives margin), ≤ 3 per report.
- **Global intake budget**: a D1 counter refusing new photos when the photo store passes 80 % of its 500 MB or a daily
  photo count is reached (`503 photoIntakePaused`), checked in the same batch as the reservation. Deletion never pauses.
- **Requests**: 100k/day is per account and shared by staging, production, tiles and cron (288 runs/day at 5 min).
  Staging must stay small or live in a separate account. Tile traffic is the first bottleneck as users grow — not
  measured here.
- **D1 rows**: 5M read / 100k written per day per account. When exceeded, *every* query fails until 00:00 UTC —
  including retention. Erasure lead therefore needs ≥ 24 h on top of the Time Travel 7 days: start at
  `delete_after − 8 days` and alert on any failed retention run.
- **Abuse**: existing per-key budgets and App Attest stay; the one free WAF rule needs a custom-domain zone (10 s, IP).
- **When exceeded**: Workers → 1027 (choose fail-closed for write routes); D1 → errors until reset; app shows
  "temporarily unavailable"; no automatic upgrade.

## 6. Required PRs (none started; each needs approval) and order

1. Additive migration allowing `image/jpeg` at rest + `validateJpegStructure` in the photo route (replaces the
   re-encode for JPEG; PNG uploads refused) + equally strict faster base64 decoding. Server only.
2. Admin: decode/re-encode through `sanitizeEvidencePhoto` locally before any byte reaches the browser.
3. (if config 3) D1 photo store: schema with fence trigger, adapter implementing `EvidencePhotoStorage`, erasure lead
   `−8 days`, intake budget counter; R2 binding left unset.
4. (optional, for margin) binary photo upload protocol v3: server + iPhone + App Review note.
5. Staging measurement on a Free Worker (needs approved resources) → then the activation decisions already listed in
   ADR-0021 §12.5 and `V1_PHOTO_STAGING_RUNBOOK.md`.

## 7. Verdict

| Claim | Status |
| --- | --- |
| Text reports, registration, config fit 10 ms | PASS in Node only; **not verified on workerd** |
| Photo intake fits 10 ms with B | **NOT PROVEN**: 4.4–23 ms in Node with the fast decoder; needs binary transport or smaller images, then a workerd measurement |
| B keeps metadata out | PASS for the allowlist (unit + fuzz tests); depends on refusing, not stripping |
| D1 can hold and fence photos | PASS locally (1 MB round-trip, re-PUT refused); remote 2 MB/100 KB statement behavior **unverified** |
| Hard zero bill | Possible only with config 3 and no billable product on the account; **unverified** on the account |
