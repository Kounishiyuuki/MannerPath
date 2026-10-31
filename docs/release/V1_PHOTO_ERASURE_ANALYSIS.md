# Photo erasure on D1 — what "deleted" means, layer by layer (2026-10-31)

Status: analysis + local PoC. No legal approval implied; wording proposals in §4 are for the operator and counsel.
Scope: configuration 3 (Workers Free + D1 photo store, PRs #357/#358/#360). The same layers apply to the personal
fields that the 90-day redaction removes from REPORTS_DB today (note, pin, date, submitter hash), and — at the provider
layer — to R2 (PHOTO_STORAGE_OPERATIONS.md already states provider-internal erasure is not established).

## 1. Layers

"SQL deletion" (the row no longer returns the bytes) and "physical erasure" (no copy of the bytes exists anywhere) are
different claims. Evidence column: L = local test in this repo, P = probe item for real D1 (runbook), D = Cloudflare docs.

| # | Layer | After the fence (`bytes = NULL`) | How long | Who can reach it | Evidence |
| --- | --- | --- | --- | --- | --- |
| 1 | Live rows | gone at once; re-put, resurrection and row removal refused | immediate | SQL, export, the app | L (node:sqlite, local workerd D1); P: F7 |
| 2 | D1 Time Travel | a restore to a bookmark before the fence brings the photo back | **7 days** after the fence on Free ("always on", cannot be disabled) | account administrators via the D1 API/wrangler | D (time-travel page, 2026-04-21); P: F8 |
| 3 | SQLite free pages in the live database file | the old bytes stay in freed pages until SQLite reuses them | **no upper bound**: if intake stops, pages may never be reused | not through SQL or `d1 export` (rows only); whatever reads the file — the provider, and possibly Time Travel/backup copies of it | L: 1,987 / 49,470 fragments remained; `zeroblob()` overwrite did not help; `PRAGMA secure_delete` → `SQLITE_AUTH` (local workerd D1). P: F6 |
| 4 | Provider durability copies, replicas, internal backups | unknown | **undocumented** | the provider | none available |
| 5 | Operator side | Admin decodes in memory and serves `no-store`; nothing written to disk by design | session | the operator's machine | design; browser/OS caches not audited |

**Conclusion.** The design guarantees SQL deletion within the 90-day ceiling (−9 day lead; tests incl. a day of
storage failure and a D1 outage) and closes the Time Travel window inside it. It **cannot guarantee physical erasure
within 90 days** on D1 (layers 3 and 4), and nothing in Cloudflare's documentation lets us claim it. The current
candidate wording "受信から 90 日以内に削除" is accurate only as SQL deletion; "完全に消去" must not be promised.

## 2. Safe alternative: crypto-erasure with operator-held day keys (PoC: `src/poc/binary-photo/photo-crypto.ts`)

"Unreadable" (cryptographic erasure: the key is gone) is a different claim from "physically erased" (layer 3/4 bytes
gone). Crypto-erasure makes the residue in every layer unreadable; it does not remove it.

### 2.1 Options compared

| Option | Within 90 days for every photo | Review time lost | Destroying one key affects | Residue risk | Verdict |
| --- | --- | --- | --- | --- | --- |
| A. 14-day creation epochs (first PoC) | yes (destroy at epoch start + 90 d) | up to 14 days for photos stored late in an epoch | every photo of the epoch, incl. ones still under review | as C | replaced |
| B. Per-photo data key wrapped to an operator key, wrapped key stored in D1 | only when the wrapping key is destroyed → same as A/C | — | — | the wrapped data key itself is D1 residue (layers 2–4) | adds nothing over C unless the data keys live outside D1 |
| B′. Per-photo data key held only in an operator key store | yes, per photo; also allows early erasure on request (ADR-0021) | none | that photo only | moves the problem to the operator store, where deleting one entry on an SSD is not sanitization | possible later; needs a store with reliable per-entry destruction |
| **C. Per-deadline-day keys + forward key chain (recommended)** | **yes: key destroyed in (t + 89 d, t + 90 d]** | **< 1 day** | only photos with the same deadline day | operator stores **one** 32-byte seed; destruction = replacing it with the advanced seed | **recommended** |
| D. Worker Secret as key | — | — | — | rollback/old-version and storage erasure of deleted Secrets undocumented | rejected |
| E. No encryption | no physical guarantee (§1) | — | — | layers 2–4 in plaintext | only with disclosed residue |

### 2.2 Scheme C

- Photo stored at `t` → sealed to the X25519 public key of day `k = floor((t + 90 d) / 1 d)`; envelope `MPE2 ‖ day ‖
  ephemeral key ‖ IV ‖ AES-256-GCM(ct+tag)`, AAD = storage key + day. Worker holds only public keys (published ahead).
- Operator: `seed_{k+1} = HMAC-SHA-256(seed_k, "advance")`; day private key = HMAC(seed_k, "x25519") as an X25519
  scalar. The stored seed is always that of the oldest day still alive; each day the operator replaces it with the
  advanced seed, which destroys that day's key. A stolen current seed reveals future days only, never past ones.
- Tests (all pass): lifetime in (89 d, 90 d] at any time of day; wrong day/other storage key/swapped day/tampering
  refused; **destroying day 0 leaves days 1–4 readable**; a chain object that was advanced refuses use; a reloaded seed
  cannot derive destroyed days; the fenced database file contains no plaintext.
- CPU (Node 24): `sealPhoto` 1.2 MB **median 0.64 ms, max 1.24 ms**; deriving a key 90 days ahead 2.91 ms (operator).
  Runs in local workerd (`/probe/seal` 200). Real Workers Free: **F11**.

### 2.3 Key management (operator)

| Topic | Rule | Residual risk |
| --- | --- | --- |
| Generation | `crypto.getRandomValues` (32 bytes) once; publish public keys for days `today+90 … today+90+N` | entropy source of the operator machine; not FIPS-validated (see §2.4) |
| Storage of the seed | one secret in one place: a local file/keychain item **excluded from Time Machine, iCloud and any backup**, on an encrypted volume | a backup or sync copy holding an old seed defeats erasure for every day it covers |
| Backup | **none** (recommended). Loss ⇒ photos become unreviewable (privacy-safe failure); new chain + new public keys | if backups are required, they must advance daily and expire before the oldest covered day's deadline — not recommended |
| Replication | never copy the seed to another machine, CI, Cloudflare, chat or a password manager with history | password managers usually keep item history |
| Loading into Admin | Admin reads the seed per session, derives only the needed day keys as non-extractable `CryptoKey`s, zeroes its byte copies | JS cannot zero a `CryptoKey` or strings; GC timing is uncontrolled |
| Memory residue | end the Admin process after review; no core dumps; keep FileVault on (encrypted swap/hibernation) | a live process or memory image during the session can expose current keys |
| Destruction | daily (cron/launchd on the operator machine + alert): load seed → `advanceTo(today)` → write the new seed over the old one → fsync → verify the old day fails | overwriting a file on an SSD/APFS is **not** physical sanitization of the old seed's blocks; assurance rests on the encrypted volume (FileVault) and on no copies — record this limitation |
| Missed destruction | the key of an overdue day still exists → the 90-day statement is false for those photos until fixed; alert on any day > 0 overdue | operator availability |
| Current public key missing | photo intake fails closed (`503`); alert ≥ 7 days ahead | — |

### 2.4 NIST SP 800-88 Rev. 2 (September 2025, read 2026-10-31 from nvlpubs.nist.gov) — fit of scheme C

| NIST text (paraphrased, section) | Scheme C | Status |
| --- | --- | --- |
| For logical/virtual storage such as cloud, CE "may be the only viable purge sanitization technique" (§3.1.2) | D1 is exactly this case | fits |
| CE pre-condition: no sensitive data previously stored in plaintext on the media (§3.2.2, citing ISO/IEC 27040) | photos must be sealed **before** the first byte reaches D1; any plaintext pilot data breaks CE for that store | design requirement; **any earlier plaintext photo store needs a fresh database** |
| Algorithm strength ≥ 128 bits; RNG entropy ≥ key size (§3.2.1) | AES-256-GCM, X25519 (~128-bit), HKDF/HMAC-SHA-256, 256-bit seed | fits on paper |
| Key-transport private keys are valid CE targets; **public** key sanitization is not valid (§3.2.3, fn. 12) | the destroyed item is the private side (seed) | fits |
| All copies of target keys must be able to be sanitized; zeroization recommended (§3.2.3) | one seed, no backups, overwrite daily | partial: overwrite on SSD is not proven zeroization of old blocks |
| Unwrapped keys in volatile memory must also be eliminated (§3.2.3) | short Admin sessions, process exit | partial: JS cannot guarantee it |
| Do not trust CE where data/keys were backed up or escrowed without high confidence in key handling (§3.2.2) | no seed backups | depends on operator discipline |
| Implementation quality: independent validation or vendor statement; federal agencies need FIPS 140 modules (§3.2.4) | WebCrypto in workerd/Node, not a validated module claim | **not met formally** (not required for a private operator, but must not be claimed) |
| Long-lived sensitivity / future cryptanalysis (§3.2.2) | 90-day review photos; X25519 is not post-quantum | acceptable risk to state, not to hide |

Conclusion: scheme C follows the CE model NIST describes for cloud storage, but **we cannot claim NIST-conformant
cryptographic erase**: key zeroization on the operator's SSD and memory elimination are best effort, and no validated
module is used.

## 3. REPORTS_DB has the same residue (separate issue)

The 90-day redaction (`retain`) sets `note`, `proposed_latitude/longitude`, `observed_on` and `submitter_hash` to NULL.
Layers 2–4 of §1 apply unchanged: Time Travel can restore the pre-redaction rows for 7 days, and the old values stay in
SQLite free pages until reuse. This affects the shipped report design (production REPORTS_DB already exists), not only
photos. Options: (a) disclose the same limits; (b) start redaction ≥ 8 days before the 90-day ceiling (closes Time
Travel, not free pages); (c) seal these fields with the same day-key scheme (larger change: moderation reads them in the
Admin today). Decision belongs to the operator and counsel; nothing is changed here.

## 4. Wording proposals (for counsel; not approved, not shipped)

Only what is proven or designed may be stated. Not proven today: Cloudflare-side physical erasure; D1 behavior on the
real service (F6, F8); the operator's key handling in practice.

If scheme C ships and its operation is in place:

> 写真は、審査のためだけに非公開のクラウドストレージ（Cloudflare）に保存します。写真は保存前に暗号化し、復号のための鍵は
> 運営者だけが管理します。審査用の保存データからは報告の受信から 81 日以内に削除し、復号のための鍵は保存から 90 日以内に破棄
> します。保存事業者の仕組み上、暗号化された状態のデータがその後も一定期間残ることがあります。

Without encryption:

> 写真は、審査のためだけに非公開のクラウドストレージ（Cloudflare）に保存し、報告の受信から 81 日以内に保存データから削除します。
> 保存事業者の障害復旧の仕組みにより、削除後 7 日間は復元可能な状態で残ります。保存事業者の内部の記録領域から物理的に消去される
> 時期は、運営者が確認・保証できません。

Neither text says 「完全に消去」 or 「誰も復元できません」. 〔LEGAL-REVIEW〕

## 5. Real-environment items

F1–F10 in V1_FREE_TIER_PROBE_RUNBOOK.md are unchanged. Added: **F11** — CPU of `sealPhoto` (X25519 day keys) on Workers Free
(`free-probe:run --mode seal`, its own time window). F6 and F8 now also decide the layer 2/3 statements above.
