# Community publication — decision packet (Issue #124)

Status: **awaiting maintainer decision.** Nothing in the repository approves community publication. Prepared in
Issue #150 (child of #67). Read with `REPORT_TERMS_PLAIN_SUMMARY.md` (what contributors agree to) and
`REPORT_TERMS_CANDIDATE.md` (the text).

## Current v1.0 decision entry (2026-11-06)

Use [Q1–Q3 choices](v1-text-reports/OWNER_CHOICES.md) and [final text review](v1-text-reports/FINAL_TEXT_REVIEW.md).
All remain unapproved. The old readiness table below is historical, not a release verdict. Current blockers include
residual retention/rights-request feasibility, actual maintenance evidence, revised iOS consent summaries and final version/hash/Web alignment.
A report ID alone is not proof of ownership; 90-day minimization does not erase every record, and automatic early erase/withdrawal is not implemented.

## 0. Historical one-page readiness (re-audited 2026-10-03 against `main` f534778)

**Historical 2026-10-03 assessment only (superseded for current release readiness).** The following READY labels are limited to the old code audit. `COMMUNITY_PUBLICATION` stays
`pending`, so the community source stays `blocked` and no community spot publishes.

| # | Item | Status | Evidence |
| --- | --- | --- | --- |
| 1 | Per-report terms consent | READY | `acceptedTermsVersion` inside the App Attest–signed payload; `src/reports/terms.ts`; migration 0021 |
| 2 | Reports before the approved version | READY | rights attach to exactly one version; draft (`.draft`) and unversioned reports never gain rights (`decisionProblems`, `terms.ts`) |
| 3 | Source publication gate | READY | source status and license derive from `COMMUNITY_PUBLICATION` (`community-publication.ts`); `pending` ⇒ `blocked` |
| 4 | Attribution | MAINTAINER DECISION REQUIRED | candidate `MannerPath 利用者報告（審査済み）` already rendered from `sources[].attributionText` |
| 5 | Additive (non-`is_current`) source promotion | READY | v3 `ADDITIVE_TABLES`; v4 `additiveReleases` declaration (`test/promotion-v4.test.ts`, "v4 additive community releases") |
| 6 | `lastVerifiedAt` semantics | READY | stays unknown for community spots; `lastReviewedMonth` (ADR-0012) carries review freshness |
| 7 | Withdrawal / removal | MAINTAINER DECISION REQUIRED | option A/B/C (§5). Foundation exists (per-report redaction, holds, report-ID lookup); the endpoint/command is built after the choice |
| 8 | Moderation | READY | `reports:moderate` against REPORTS_DB (ADR-0014, `docs/OPERATIONS.md`) |
| 9 | Publication holds | READY | reviewed `prohibited` / absence findings become holds (`community-effects.ts`) |
| 10 | REPORTS_DB → sanitized artifact → DATA_DB | READY | ADR-0014; replay-protected artifact is the only boundary (`community-artifact.ts`) |
| 11 | Promotion v2/v3/v4 | READY | v2 is single-source; community travels by v3/v4 with granted terms rows (`test/community-activation.test.ts`) |
| 12 | Nationwide seed / acquisition workflow | READY | `community:seed`, `/v1/coverage/tasks` (ADR-0013, #149) |
| 13 | Photo evidence rights boundary | READY (boundary) | photos are private, never canonical, no DTO field, disabled by default (ADR-0016). Photo processing/publication is a **separate later** decision, not part of this approval |
| 14 | Rollback | READY | `state: "suspended"` revokes the version and blocks the source; tested |
| 15 | Config / terms version distribution | READY | `/v1/config` publishes `CURRENT_REPORT_TERMS`; intake refuses any other version (409 `termsVersionOutdated`) |
| 16 | Apple consent UI | READY | shows the bundled document of each registered version; activation adds the new version (Swift change ⇒ Mac `make apple-validate`) |
| 17 | Old clients | READY (by design) | draft-only builds get 409 and must update; release the approving build before `/v1/config` switches (checklist C) |
| 18 | App Attest | READY (code) | intake requires App Attest in production; the physical-device run (#35) and secrets are launch operations, not a #124 decision |

**Current technical blockers:** see the current decision entry above. Do not reuse the historical “none” verdict.

**Remaining maintainer decisions** (the `MAINTAINER-INPUT` markers in `REPORT_TERMS_CANDIDATE.md`):
1. APPROVE / HOLD / CHANGE the candidate, and whether counsel reviews it first (§10 lists the open legal questions;
   nothing here asserts legal sufficiency).
2. Version / effective date (`report-terms.YYYY-MM-DD`).
3. Operator name, public contact, public terms URL.
4. Governing law and jurisdiction.
5. §4.2: third-party / commercial reuse of community data.
6. §8: withdrawal option A / B / C (and the matching §4.1 wording).
7. §10: liability wording (consumer-contract-law review).
8. Attribution text (candidate above).

**Activation changes once approved:** §8 below (terms document, `COMMUNITY_PUBLICATION`, Apple `ReportTerms` + bundled
copy, `docs/SOURCES.md`), plus the withdrawal path for the chosen option, then `docs/COMMUNITY_LAUNCH_CHECKLIST.md`
C–E (REPORTS_DB, App Attest on a physical device, edge rate limit, retention schedule, app release before config,
promotion and blue/green).

## 1. What is being approved

One new report-terms version (e.g. `report-terms.2026-11-01`) as the legal basis for publishing **reviewed facts**
derived from community reports that explicitly consented to **that version**, and the community source
`mannerpath-community-reports` as an approved source with license "MannerPath 利用者報告規約 (<version>)" and
attribution `MannerPath 利用者報告（審査済み）`.

Not being approved: the draft version, reports without consent, reports consented to the draft, bulk auto-accept,
any change to official sources.

## 2. What becomes publishable, and what never does

| Publishable (after moderation, as `communityReported` / `communityVerified`) | Never public |
| --- | --- |
| Adopted location (`communityPinned` precision) | Notes / free text, host name, hours note |
| Spot type, subtype, access, host type, environment, tobacco support — only values the reviewed reports agree on | Observation day, submission time |
| Evidence tier and independent-confirmation count | Submitter hash, App Attest key, installId |
| `lastReviewedMonth` (month of review; `lastVerifiedAt` stays unknown) | Report IDs (internal + promotion bundle only) |
| Publication holds from reviewed `prohibited` / absence findings | Any contributor name or ID |
| | Photos (ADR-0016: private evidence; a separate decision) |

The tile/detail DTOs have no field that could carry the right-hand column; `test/community-activation.test.ts`
checks the published bytes of a simulated activation.

## 3. Rights granted by the submitter (candidate §4)

The current unapproved candidate proposes free, ongoing permission to store, normalize, convert, merge and publish reviewed facts through the
app, Watch, API, tiles and export/promotion bundles, and to convert them to future formats. Notes are excluded.
**Q1 recommendation:** third-party/commercial reuse with attribution and terms URL; still unapproved. Statutory rights are not excluded.

## 4. Privacy and minimization

The implementation schedules minimization of personal report fields at receipt +90 days; actual cleanup must run.
Authentication, receipts/audit, independent checks, support and recovery history are separate. It is not full or physical erasure.
Residual retention and request handling require the Q2 decision and operational evidence. The verified App Attest key,
not a client-chosen install ID alone, supplies the submitter identity.

## 5. Historical withdrawal options (Q1/Q2 now govern)

Distinguish the **original personal report** (owned by the contributor, minimized within 90 days anyway) from the
**published canonical fact** (a MannerPath review result, often corroborated by others).

There are no accounts. A report ID helps locate the target but is not ownership proof. Dedicated safe identity
verification, early full erase and exported-evidence withdrawal are unimplemented. Do not promise those operations
from the following design options. Current Q1/Q2 recommend case review, statutory-rights preservation and honest limits.

| | A. Personal data only | B. Unlink and re-evaluate | C. Full takedown |
| --- | --- | --- | --- |
| What happens | The report's personal fields are redacted immediately (early ADR-0007 redaction). The published fact stays. | Redact, and drop the report as evidence; the spot is re-reviewed on the remaining evidence and may lose a tier or be held. | Redact, and unpublish every fact that rests on the report until someone else independently confirms it. |
| Fits "irrevocable" in §4.1 | yes | partly (needs §4.1 reworded) | no (needs §4.1 reworded) |
| Effect on others' contributions | none | can downgrade a fact others confirmed | removes facts others confirmed |
| Abuse risk | low | medium (withdraw to weaken a rival's spot) | high (one request unpublishes shared facts) |
| Engineering | existing redaction; one-report trigger | new evidence-removal path + re-review | new evidence-removal path + forced hold |
| ADR-0007 consistency | direct | needs an ADR-0007 amendment | needs an ADR-0007 amendment |
| Contributor control | lowest | middle | highest |

Foundation available today for any option: per-report redaction (`reports_only_redaction_updates`), publication
holds, and report-ID-based evidence lookup. No withdrawal endpoint or command is implemented; that is a follow-up
once an option is chosen.

## 6. Attribution

`MannerPath 利用者報告（審査済み）`, carried as `sources[].attributionText` of the community source. API tiles,
spot detail, iPhone and Watch already render source attribution from that field, so one value is consistent
everywhere. No contributor names or IDs.

## 7. Risks

- The candidate is not reviewed by a lawyer. Japanese consumer-contract law may limit §10's liability wording.
- Facts may not be copyrightable; §4.4 is belt-and-braces, not a guarantee.
- Contributors may copy pins from other maps (§4.5 forbids it; moderation cannot always detect it).
- Moderation load grows with launch (`docs/OPERATIONS.md`, community moderation runbook).
- Older app builds bundle the draft and must update before they can report again (by design, §9.3).

## 8. Exact code switch (the activation PR)

One small PR, checked by `test/community-activation.test.ts`:

1. `docs/legal/report-terms/<version>.md` — the candidate with every `MAINTAINER-INPUT` filled and the CANDIDATE
   notice removed.
2. `services/api/src/reports/community-publication.ts` — `COMMUNITY_PUBLICATION` from `{ state: "pending" }` to
   `{ state: "approved", termsVersion, documentPath, documentSha256, termsUrl, approvedBy, approvedOn }`.
   Terms registry (`granted`) and source registry (`approved`, license, attribution) derive from it.
3. `apps/apple/.../Features/Reports/ReportDomain.swift` — add the version to `ReportTerms.documents` (not draft), and
   copy the document into `Features/Reports/Terms/<version>.md` so the app shows the full text.
4. `docs/SOURCES.md` — community entry: publication status approved, license, attribution, date.

Then `npm run community:activate -- --terms-version <version>` applies it to the local D1; production receives it
through the reviewed promotion bundle (`docs/COMMUNITY_LAUNCH_CHECKLIST.md`). The command refuses unless step 2 says
`approved` for exactly that version.

## 9. Rollback

`COMMUNITY_PUBLICATION.state = "suspended"` (one-line PR): the version's rights become `revoked`, the source
`blocked`; the next publish drops community spots from tiles. Reports, applications and canonical rows stay for later
review; official sources are untouched. Fastest production rollback: switch `database_id` back to the pre-launch
database (blue/green). Stop accepting reports: remove `REPORT_APP_ATTEST_APP_ID` (fails closed). See
`docs/OPERATIONS.md`, community rollback.

## 10. Unresolved legal questions (for counsel, if you use one)

1. Is the current §4 reuse grant effective and compatible with statutory withdrawal/correction rights? No blanket irrevocability is assumed.
2. Third-party / commercial reuse (§4.2) and the license MannerPath offers downstream.
3. §10 liability wording under 消費者契約法.
4. Whether the operator must be named / a contact published under 特定商取引法 or other law for a free app.
5. Governing law and jurisdiction clause.

## 11. Not legal: the report path (resolved)

Decided and implemented as option (c): a separate long-lived reports database (`REPORTS_DB`) next to the blue/green
data database, with moderation against it and a sanitized, replay-protected artifact as the only boundary into
canonical data (ADR-0014, `docs/OPERATIONS.md` "Community publication" and "Report store"). Raw reports stay in the
report store and are minimized there after 90 days. This item no longer blocks; the legal and maintainer decisions
above still do.

## 12. Decide using current Q1–Q3

Use [OWNER_CHOICES](v1-text-reports/OWNER_CHOICES.md): select the text/conditions to adopt, change or hold.
A conditional text choice is not final approval or resolution of retention/request-handling blockers.
Final approval must identify the finalized text, chosen conditions, approver and date. No statement in this packet records that approval.
Intake availability must be separately verified; HOLD does not mean production currently accepts draft reports.
