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

## 2. Safe alternative: crypto-erasure with operator-held keys (PoC: `src/poc/binary-photo/photo-crypto.ts`)

Make every byte Cloudflare stores ciphertext that Cloudflare cannot decrypt, then destroy the key on the operator side.

- The Worker holds only the current epoch's **public** key (not a secret). Per photo: ephemeral P-256 ECDH →
  HKDF-SHA-256 → AES-256-GCM; AAD binds storage key and epoch. Envelope `MPE1 ‖ epoch ‖ ephemeral key ‖ IV ‖ ct+tag`.
- The epoch **private** key exists only with the operator; the local Admin decrypts in memory for review.
- Epochs of 14 days. All photos of epoch E are fenced and E's private key is destroyed by `epochStart(E) + 90 d`, so
  every photo becomes unreadable — in every layer above — within 90 days of storage (76–90 days of review time).
- Why not a Worker Secret as the key: a deleted Secret's fate in older Worker versions/rollbacks and its storage
  erasure are not documented (secrets page, read 2026-10-31); a key Cloudflare never had needs no such assurance.

Evidence (local): round trip; wrong key, other storage key, swapped epoch and tampered byte all refused; after a fence
the database file contains no plaintext (only ciphertext residue); `sealPhoto` 1.2 MB median 1.50 ms, max 2.21 ms
(Node 24); runs in local workerd (`/probe/seal` 200). On real Workers Free: probe F11.

Costs and risks of the alternative:

| Item | Effect |
| --- | --- |
| CPU | +~1.5 ms per photo (Node); F1 + F11 must still leave the P99 ≤ 8 ms margin |
| Operator key duty | generate epoch key pairs ahead (e.g. a quarter = 7 public keys committed/deployed); keep private keys in a vault that is **excluded from backups** or whose backups expire before `keyDestroyBy`; destroy on schedule (calendar + checklist). The guarantee now depends on this discipline |
| Key loss | photos of that epoch become unreviewable (fail safe for privacy, not for review) |
| Missing current public key | intake for photos fails closed (`503`) — must alert well before an epoch starts |
| Admin | must load the epoch private key from the vault per session, never write it to disk |
| Scope | photos only. Text fields in REPORTS_DB keep layers 2–4; same technique possible later, larger change |

Standard reference for the concept: "cryptographic erase" in NIST SP 800-88 (not re-read for this note).

## 3. Without the alternative

If crypto-erasure is not adopted, configuration 3 can still ship only with wording that promises SQL deletion and
discloses layers 2–4, and with the operator's (and counsel's) acceptance of that residue. R2 (configuration 2) does not
remove layer 4 and adds billing risk, so it is not a privacy improvement over D1 on this point.

## 4. Wording proposals (for counsel; not approved, not shipped)

With crypto-erasure (recommended):

> 写真は、審査のためだけに、暗号化した状態で非公開のクラウドストレージ（Cloudflare）に保存します。復号に必要な鍵は運営者だけが
> 管理し、保存した日から 90 日以内に鍵を破棄します。鍵の破棄後は、保存先やその復旧用の仕組みに写真の暗号化データが残っていても、
> 運営者を含め誰も写真を復元できません。審査用の保存データからは、それより前（報告の受信から 81 日以内）に削除します。

Without crypto-erasure:

> 写真は、審査のためだけに非公開のクラウドストレージ（Cloudflare）に保存し、報告の受信から 81 日以内に保存データから削除します。
> ただし、保存事業者の障害復旧の仕組みにより、削除後 7 日間は復元可能な状態で残ります。また、保存事業者の内部の記録領域から
> データが物理的に消去される時期は、運営者が確認・保証できません。

Both replace PHOTO_TERMS_CANDIDATE.md 第 6 条の 2 第 3 項 (which describes the R2 overwrite method) when configuration 3
is chosen; the privacy-policy photo footnote (PHOTO_PRIVACY_REVIEW.md §5) follows the same text. 〔LEGAL-REVIEW〕

## 5. Real-environment items

F1–F10 in V1_FREE_TIER_PROBE_RUNBOOK.md are unchanged. Added: **F11** — CPU of `sealPhoto` on Workers Free
(`free-probe:run --mode seal`, its own time window). F6 and F8 now also decide the layer 2/3 statements above.
