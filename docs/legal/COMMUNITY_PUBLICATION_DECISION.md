# Community publication — decision packet (Issue #124)

Status: **awaiting maintainer decision.** Nothing in the repository approves community publication. Prepared in
Issue #150 (child of #67). Read with `REPORT_TERMS_PLAIN_SUMMARY.md` (what contributors agree to) and
`REPORT_TERMS_CANDIDATE.md` (the text).

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

The tile/detail DTOs have no field that could carry the right-hand column; `test/community-activation.test.ts`
checks the published bytes of a simulated activation.

## 3. Rights granted by the submitter (candidate §4)

Free, perpetual, irrevocable permission to store, normalize, convert, merge and publish reviewed facts through the
app, Watch, API, tiles and export/promotion bundles, and to convert them to future formats. Notes are excluded.
**Open:** whether third parties may reuse/redistribute (incl. commercially) MannerPath's community data (§4.2).

## 4. Privacy and minimization

Unchanged ADR-0007: personal content (note, proposed pin, observation day, submitter hash) is removed within 90 days
of receipt. The published fact is a MannerPath review result, not the personal report; it outlives the report.
The App Attest submitter key is now the verified key, not the client-chosen installId (Issue #150).

## 5. Withdrawal — options (choose one; no recommendation)

Distinguish the **original personal report** (owned by the contributor, minimized within 90 days anyway) from the
**published canonical fact** (a MannerPath review result, often corroborated by others).

There are no accounts. The only proof of authorship is the report ID returned at submission, and after the 90-day
redaction nothing links a report to a submitter, so no option can verify authorship later than that.

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

1. Is the §4 grant (incl. "irrevocable") effective for anonymous contributors via in-app consent?
2. Third-party / commercial reuse (§4.2) and the license MannerPath offers downstream.
3. §10 liability wording under 消費者契約法.
4. Whether the operator must be named / a contact published under 特定商取引法 or other law for a free app.
5. Governing law and jurisdiction clause.

## 11. Not legal, but also blocking

Production reports are written to the live remote D1; moderation and publication run locally and reach production
only as a promotion bundle that never carries reports, and a blue/green cut-over replaces the database that holds
them (`docs/OPERATIONS.md` step 7, Community publication). Before launch, decide how live reports reach moderation
and survive a cut-over — e.g. (a) a reviewed remote moderation command against the live database, (b) an export of
pending reports to the moderator's machine under the 90-day rule, or (c) a separate long-lived reports database
next to the blue/green data database. Each has privacy consequences; each needs its own engineering PR. Legal
approval alone does not start community publication.

## 12. Decide

- **APPROVE** — you accept candidate §1–§11 with your fills for: operator name, contact, governing law, terms URL,
  §4.2 third-party reuse, §8 withdrawal option (A/B/C). Then the activation PR (§8 above).
- **HOLD** — community stays blocked; reports continue to be collected under the draft and moderated as review
  signals. Nothing else changes.
- **CHANGE** — name the sections to change; a new candidate follows. Nothing activates until APPROVE.
