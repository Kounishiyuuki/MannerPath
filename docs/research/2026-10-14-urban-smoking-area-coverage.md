# Urban smoking-area coverage — 2026-10-14

Lane 4; #67 / #113 / #137. Baseline main `f6ddf4e9516b3977d052351c8c24453f2b66b0e9`.
This is a research result, not source approval, implementation or deployment.

## Result and batch criterion

**Zero sources or spots approved in this batch.** The request explicitly says not to adopt candidates whose ashtrays
cannot be confirmed. Smoking-place permission/existence and physical ashtray installation were therefore checked
separately: an official smoking-room label is not converted into an installed-ashtray fact. Unknown is not absence.
An [official municipal response](https://www.city.shijonawate.lg.jp/site/ikenbako/130104.html) explicitly describes a
designated smoking place without ashtrays; this is a counterexample only, never canonical source data.

The optional clarification about this criterion had no answer when this result was prepared, so the explicit stricter
requirement remains in force. No weaker adoption criterion is assumed and no global policy/ADR is amended.

This does **not** mean that these cities have no smoking places. Several primary pages explicitly list smoking
places; independent government host anchors now resolve blockers that predated accepted ADR-0018. The remaining
batch-specific ashtray evidence and some source-specific location/operation/rights blockers stay visible.

## Priority-city review

| City | Primary evidence and independent anchor | Remaining blocker / result |
|---|---|---|
| Kanazawa | 21st Century Museum current visitor rules list outdoor Hiro坂口 corner. City tourism datastore ID AA0000001260 has a facility point (36.560867,136.658258), original numeric-data reuse terms read. | Ashtray installation unknown; facility scope only, no Hiro坂口 exact/zone pin. Long museum closure starts2027-05-06, requiring re-review of outdoor continuity. No onboarding. |
| Kanazawa | City road-management department now explicitly instructs use of station smoking places. 香林坊大和8F elevator-front smoking area is listed by its own operator. | This resolves an older manager-referral/existence gap, not the separate exit-zone anchor or ashtray gap. 百番街 indoor contradiction and Forus information-use ban remain blocked. |
| Toyama | Current JR West smoking page lists 富山駅; live page, station identity and terms re-read. City station/tram XLSX Sheet1 row89/ID88 matches 富山駅・北陸新幹線, with stated DMS point. | Ashtray installation unknown. Unit conversion is reproducible; datum unspecified, approximate facility only. No geocoding or N02 midpoint. |
| Toyama | StationCity operator lists Maroot4F, Toyamarche and MarieToyama1F smoking places; municipal market page explicitly names ashtray locations. | StationCity needs individually matched host anchors and final rights/ashtray review. Market has visit-permission requirements and no reviewed anchor, outside the station/downtown priority; not adopted as an easy replacement. |
| Fukui | Current city guidance/2023 station-underpass relocation notice describes public indoor smoking room and its own hours. Original city station XLS has a representative 福井駅 point (36.062122,136.223318). | Ashtray installation unknown. Resource header is CC BY3.0, not the portal default CC BY2.1JP. Station host point never becomes an exact underpass room point. Old outdoor location not revived. |
| Fukui | Official tender-results navigation and prefectural procurement system checked for station-underpass cleaning specification. | Historical2024 specification could not be retrieved; server search error. No speculative proof from a third-party tender listing or toilet photos. |
| Nagano | Municipal station plans/meetings, JR current station guide/removal notice, downtown Central Square operator rules and municipal GIS paths reviewed. | Historical proposal is not operation; station ashtray-removal conflict retained. No fully reviewed current ashtray/rights/anchor tuple found in bounded scan. |
| Niigata | Current municipal smoking page updated2026-10-05 lists 石宮公園; municipal park CSV SAUID6420 provides a licensed park point (37.9126374,139.0594717), CC BY2.1JP. | Ashtray installation unknown; official exterior photo does not verify it. Park point only represents the park, never the smoking booth. Midnight–04:00 restriction belongs to the smoking place and is preserved. |
| Niigata | Current station-south smoking listing and separate market/public-facility map checked. | No legitimate reviewed south-zone anchor; no park point substitution. Former station-front smoking place closed2024-08-05 remains excluded. |

The four concrete smoking-designation + government-anchor candidates (museum, JR Toyama, Fukui underpass,
Ishimiya park) are held, not newly approved sources. Location is `areaApproximate`/`facility` if later accepted;
no single facility anchor becomes several pins. Unconfirmed access/support remain unknown. No facility hours are
transferred into smoking hours; raw overnight restrictions need normal hours parser review at implementation.

## Additional explicit-ashtray route

Fukushima's current municipal designated-smoking list explicitly mentions ashtrays, and station-east relocation
on2025-12-01 was preserved. Its original website terms explicitly prohibit reuse of published information without
consent; municipal GIS also prohibits commercial use. This fails ADR-0018 D-R closed. Neither current existence nor
coverage pressure overrides that prohibition. No data/coordinate is adopted from those resources.

## Evidence boundaries and reproducibility

The [JSON review](2026-10-14-urban-smoking-area-coverage.json) records primary URLs, HTTP/check receipts, whole-resource
SHA-256, original rights clauses/locators, government point row/key/conversion, exclusions and uncertainty. Raw HTML,
images, maps, PDF bodies and cached downloads stay outside git. Search snippets, neighbouring venue referrals,
questionnaire respondents and third-party tender services are discovery/conflict leads only.

Existing rejected sources were revisited only for a concrete change: accepted ADR-0018 now permits factReference
and independently licensed facility anchors, or a newly found manager publication. Explicit information-use bans,
closures and old proposals were not silently reset. Each priority city had multiple official paths inspected.
A bounded failure or access error is not evidence that a place does not exist.

## Corpus and validation

Fresh migration-backed local pipeline: **15 sources,524 canonical,522 published,90 tiles,12/47 prefectures**;
zero cross-source candidates and zero failed quality checks. Two existing Taito canonical exclusions remain.
Before/after are identical; no source registry, adapter, fixture, health baseline, tile or production inventory changed.
All five priority cities still have zero repository-reviewed spots in this batch. Kanazawa remains an important gap
although Ishikawa has the separate Komatsu Airport source.

Required commands are `make contract`, `make api-validate` (tsc/API/discovery plus existing quality/promotion
regressions) and `git diff --check`; fresh corpus/promotion reproduction is recorded in the PR validation results.
Production remains unchanged; no remoteD1 or Cloudflare action.

## Next priority

Obtain current manager-issued ashtray/equipment evidence for the four held candidates. If the maintainer instead
clarifies that explicit official smoking designation is sufficient for dedicated rooms/areas, re-review those
candidates under that instruction rather than silently assuming it. Resolve station-exit/zone anchors independently;
never derive points from LineString midpoints, map images, Google/MapKit/OSM or adjacent unrelated facilities.
