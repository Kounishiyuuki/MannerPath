# Nationwide official-source expansion — seven airports

Parent #67; rollout/blocker queues #113 and #137; address-only lane #141 unchanged.
Baseline: `0b7f2c8fe15189f728c589b41ef9a7cbc2c32c03`. Reviewed 2026-10-14 JST.

## Selection and prior blockers

The existing exact-point municipal queue is saturated by resource rights, current-operation and anchor blockers;
those rejected resources were not fetched again without a new reason. The eight airport source packages at
`cbce6dca21b5e6c131ce58071a85588b7dae4a75` had already established government terminal anchors and explicit smoking
facts, but waited for ADR-0018. That ADR is now Accepted and implemented in main, justifying this bounded re-review.
All eight airports are in previously zero-coverage prefectures. Seven pass the current factReference/anchor gates;
Kagoshima's commercial-purpose link restriction remains unresolved. No geocoding, map-vendor POI, OSM value,
centroid or smoking-point fabrication was used. Station datasets require further independent anchors and are next.

## Results

| Candidate | Result | Explicit smoking zones → canonical spots | Prefecture |
|---|---|---|---|
| Matsuyama | Implemented, factReference / facility anchor | 5 → 1 | Ehime |
| Takamatsu | Implemented; closed international boarding room excluded | 3 → 1 | Kagawa |
| Oita | Implemented, partial two-zone scope; old cash-corner location excluded | 2 → 1 | Oita |
| Kochi | Implemented, factReference / facility anchor | 2 → 1 | Kochi |
| Yonago | Implemented, factReference / facility anchor | 2 → 1 | Tottori |
| Miyazaki | Implemented, factReference / facility anchor | 2 → 1 | Miyazaki |
| Hiroshima | Implemented; domestic-arrival exterior closed 2025-02-28 excluded | 3 → 1 | Hiroshima |
| Kagoshima | Not approved: commercial-purpose linking restriction | 0 | Kagoshima |

All accepted records have `areaApproximate`, `scope=facility`, `accessType=unknown`, `accessDetail=null`.
Smoking hours, openNow, tobacco support, physical type and environment remain unknown. Five source names retain
mixed/after-security qualifiers; Miyazaki and Hiroshima say utilization conditions are unconfirmed. Every source is
partial, pinned-first-release only, with no automatic refresh or cross-release identity/relocation approval.

Current operation means the first-party smoking scope was live at checkedAt, not a site visit. Thirty-six bounded
requests returned HTTP 200; no blocked host was bypassed. Closure notices were reviewed and excluded claims retained.
This is not proof that contradictory evidence or other smoking places do not exist.

## Rights, anchor and evidence

Operator pages are existence evidence under ADR-0018 D-R, not openly licensed raw datasets. Copyright/reproduction
restrictions are distinguished from prohibitions on information/database/service use. Only normalized factual cells,
short scope locators, URL/check date and digests are retained; original HTML, images, maps and logos stay out of git.
Public attribution links operator homepages, honoring link conditions; exact evidence URLs remain internal. Public
full tile and spot-detail regression tests verify that restricted deep links are not exposed.

Government C28-21 TerminalBuilding points are independently licensed and attributed facility anchors. ZIP/member
hashes, Airport→TerminalBuilding→point keys, administrative identity and coordinate meaning were verified for every
candidate. A terminal point is never a smoking point or a named-zone anchor. See the source entries in
`docs/SOURCES.md`, each fixture's `PROVENANCE.md` and the accompanying machine-readable review JSON for exact URLs,
HTTP observations, coordinate keys, rights classification, excluded claims and recheck URLs.

## Coverage and inventory separation

| Repository pinned corpus | Before | After | Delta |
|---|---:|---:|---:|
| Approved adapters | 8 | 15 | +7 |
| Municipal / operator | 7 / 1 | 7 / 8 | 0 / +7 |
| Canonical spots | 517 | 524 | +7 |
| Published spots | 515 | 522 | +7 |
| Excluded canonical spots | 2 | 2 | 0 |
| Tiles | 83 | 90 | +7 |
| Actual prefectures with spots | 5 | 12 | +7 |
| Uncovered prefectures | 42 | 35 | −7 |
| Discovery targets / implemented / reviewedResources | 191 / 8 / 8 | 198 / 15 / 15 | +7 / +7 / +7 |

The old source-prefecture map omitted Sendai, so the old metric reported 4 prefectures plus one unassigned spot.
Adding its reviewed Miyagi jurisdiction corrects attribution of the existing spot; it does not add a spot or newly
cover Miyagi. The corrected baseline is five prefectures. After expansion all published spots are assigned.

Production deployment remains the historical six-source / 513-published inventory. Default production health still
checks six; `--repository-reviewed` checks fourteen, with Sendai explicitly `HEALTH_NOT_CONFIGURED`. Historical
community campaign artifacts are not rewritten to imply deployment.

## Validation and next priorities

Fresh all-source pipeline, quality, duplicate/conflict checks, repeated ingestion, tile hashes and promotion are
validated locally. All original 83 tile hashes are unchanged. Every repeated resolve is `alreadyApplied`; no
cross-source duplicate candidate is generated. Promotion builds are deterministic and verified against a fresh
migrated target, with identical re-export. Node 24.21.0; `make contract`, `make api-validate`, and `git diff --check`
are required before PR/merge. Real local D1 also applied all 33 canonical migrations and verified the new seven-source pipeline (7 canonical/published/tiles, quality pass, duplicate candidates zero, repeated ingestion alreadyApplied). Two full real-D1 attempts hit a local Worker bridge `ECONNRESET` in the existing Osaka resolution batch before reaching new sources; the full 15-source corpus/promotion verification therefore uses the migration-backed node:sqlite D1 adapter. No production D1 migration, publication or Cloudflare action belongs to this change.

Next: prepared JR West/JR Hokkaido sources with independent station points (no N02 LineString midpoint); Aomori and
Shizuoka official airport smoking pages plus C28 anchors; Niigata/Chiba/Kawasaki municipal sources only after their
specific outstanding rights/current-operation/anchor gates are resolved. Kagoshima requires linking clarification.
