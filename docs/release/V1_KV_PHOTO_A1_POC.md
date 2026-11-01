# A1 — Workers KV photo bytes + two-request upload (PoC, measured 2026-11-01: NO-GO as built)

Scope: a verification-only design and PoC (`services/api/src/poc/kv-photo/`), never mounted by the API Worker. It answers
whether photos 1–3 per new-spot report can stay on Workers Free with every existing check. Context: the one-request v3
upload measured 26–184 ms CPU on Workers Free (V1_FREE_TIER_PROBE_RUNBOOK.md §9, on PR #363/#364).

## 1. Design

| Step | Request | Work | Writes |
| --- | --- | --- | --- |
| ① | `POST /v4/reports/{id}/photo-intents`, JSON ≤ 4 KB | challenge burned first; App Attest assertion over {reportId, idempotencyKey, terms, `image/jpeg`, byteLength ≤ 1.2 MB, sha256} with its **own domain** `mannerpath.app-attest.photo-intent.v4`; key/revocation/environment/counter as v3; report eligibility pre-check | one batch in REPORTS_DB: counter advance + intent row (stores SHA-256 of a random 32-byte ticket, never the ticket); expires in 5 min |
| ② | `PUT /v4/photo-uploads/{ticket}`, raw JPEG | intent lookup; Content-Length and bounded read must equal the attested length; SHA-256 must equal; full `validateJpegStructure` (APPn/COM refused); **claim** = one conditional UPDATE `issued → claimed` with a fresh claim token, read back; then the existing `attachValidatedJpeg` with `KvPhotoStore` | REPORTS_DB as v3 (`uploading → ready`); PHOTOS_DB ledger row (no bytes); KV value; intent `consumed` |

`KvPhotoStore` (same contract as the D1/R2 stores): ledger insert first (fence, byte budget 800 MB and **daily KV write cap
800** enforced by triggers), then `KV.put(key, bytes, {expiration: stored + 90 d})`, then a ledger re-read (a fence
that raced the put deletes the KV value again). `delete()` = permanent D1 fence, then `KV.delete`. `read()` (the only read
path, for operator review) checks the ledger, then the KV bytes' length and SHA-256. KV decides nothing.

## 2. Threats (each pinned by `test/poc-kv-photo.test.ts`, 11 tests, unless marked)

| # | Threat | Handling |
| --- | --- | --- |
| 1 | ticket replay / parallel double use | consumed is final (trigger); claim is one conditional UPDATE + own-token read-back: 3 parallel PUTs → 201, 409, 409, one KV value, one write counted; on Cloudflare a replay → 409 |
| 2 | KV.put fails after the claim | claim released to `issued`; photo stays `uploading`; the same ticket retries until expiry; the identical retry counts no second write |
| 3 | D1 update fails after KV.put | the KV value exists without `ready`; attach is retried by the same ticket, or the `uploading` row expires (15 min) and retention deletes the key; a stale value is never served (#5) |
| 4 | KV eventual consistency | `read()` returns `notVisible` for a missing or non-matching value (SHA-256 checked), never other bytes |
| 5 | stale KV value after delete | the D1 fence decides; a failed `KV.delete` leaves the value hidden and still expiring (≤ 90 d); the retry removes it; puts after a fence are refused |
| 6 | D1 Time Travel rewinds the ledger | KV has no Time Travel: a rewound `live` ledger finds no KV value → `notVisible`. A rewound intent table could re-issue an unexpired ticket (≤ 5 min window); restores are operator actions on a disposable DB only. **Not measured** for A1 |
| 7 | expired / late / forged size | 410 after 5 min; length and SHA-256 equality before any write; size forgery cannot pass the attested hash |
| 8 | storage / daily write exhaustion | 800 MB and 800 writes/day caps (80 % of KV Free's 1 GB and 1,000 writes/day) → 503 `photoIntakePaused`, ticket kept |
| 9 | mass submission | every intent needs a fresh App Attest assertion from a registered key, the challenge rate limiter and registration caps; ≤ 3 photos per report (existing trigger) |
| 10 | operator review / leaks | no public route or URL; the probe's kv-check returns status, length and SHA-256, never bytes; local re-encode before display stays required (display.ts) |

Not weakened: App Attest per photo (moved to ①, bound to SHA-256 + length, single use), server JPEG structure check,
metadata refusal, 90-day deletion with a permanent fence.

## 3. Workers Free measurements (probe Worker, synthetic photos, 2026-11-01 08:06–08:11 UTC)

Probe-only resources: existing D1 `mannerpath-free-tier-probe-{reports,photos}` (A1 delta tables added), new KV
namespace `mannerpath-free-tier-probe-photo-kv` (`0adb78dd…`; the account had no KV namespace before). CPU per invocation
from `wrangler tail` (ms, as in the runbook §9).

| Run | Request | n | P50 | P95 | P99 | max | > 8 ms | > 10 ms | failures |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 5 photos, 213–414 KB | ① intent | 5 | 6 | 11 | 11 | 11 | 1 | 1 | 0 |
| | ② upload (201) | 5 | 12 | 17 | 17 | 17 | 5 | 5 | 0 |
| 20 photos, 146–269 KB | ① intent | 20 | 4 | 7 | 9 | 9 | 1 | 0 | 0 |
| | ② upload (201) | 20 | 11 | 13 | 18 | 18 | 20 | 12 | 0 |

`exceededCpu`: 0 (KV put is native: no number-array cost). **Pass condition (P99 ≤ 8 ms for both) not met by ②**; the
continued overruns are the stop condition, so the 100-run was not started. ② still costs ~11 ms because it makes about
a dozen D1 round trips (intent read, claim + read-back, attach's reads, batch, reservation read, ledger insert + re-read,
ready update + read, metadata read, consume), each a JSON exchange.

## 4. Deletion and privacy facts

- KV `put` takes absolute `expiration` (≥ 60 s ahead); every stored key listed with 90.00 days left.
- After `delete`: the same location immediately returned no value (`kvStillAnswers: false`, again ≈ 25 s later) and the
  key was absent from `kv key list`. KV docs give up to 60 s for writes to reach other locations and **no propagation
  time for deletes**; nothing here measures other locations or Cloudflare's internal copies.
- SQL fence (D1), KV delete, key destruction and physical erasure are different things. A1 gives a D1 fence plus a KV
  delete and a KV expiration; it promises no physical erasure and no end-to-end encryption.

## 5. Usage (this run)

KV: 25 writes, 1 delete, 24 values (5.8 MB) kept with 90-day expiration. Workers: ≈ 115 requests. D1: tens of rows.
All far below Free limits (KV 1,000 writes/day, 1 GB; Workers 100,000 requests/day).

## 6. Verdict and what GO would need

**NO-GO as built** (② P99 18 ms). The direction is not exhausted: ② could drop most round trips (claim with
`UPDATE … RETURNING`, attach's reads folded into one batch, ledger insert without re-read when the batch result shows
the insert), but that changes `attachValidatedJpeg`, which mirrors the production attach, and was not attempted here.
GO would need: ② and ① P99 ≤ 8 ms over ≥ 100 measured photos with 0 `exceededCpu`; KV delete semantics accepted by
counsel; the iPhone client change; and the Time Travel ticket case (#6) measured.
