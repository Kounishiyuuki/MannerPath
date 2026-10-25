# Kanazawa actual candidate facts — 2026-10-26

Unapproved internal candidate inputs to `source:intake`, not an approved source release. Lane 4.
These are locally normalized facts from public pages, **not files delivered by the publishers**.
The receipts' `receivedOn` is local preparation date; `checkedAt` is a page check, never a site visit.
No source approval, legal sign-off, canonical registration, Cloudflare, production D1 or production promotion.

[PR #339 research](../../../../../docs/research/2026-10-25-kanazawa-official-smoking-spots.md) is retained as history.
Unlike that PR's source-level URL queue, these inputs contain four actual place records, partitioned by publisher.
`manifest.json` pins each factual input's SHA-256 and expected row count. IDs are local candidate queue keys,
not upstream identifiers or canonical spot IDs. The sample is partial; absence never proves closure.

## Input facts and provenance

| File / candidateId | Normalized fact recorded | Authority and location limit |
| --- | --- | --- |
| station-facts.json / kanazawa-station-west | West exit; outside building; near the entrance on the Katsu-zo side of Anto | [100bangai service page](https://www.100bangai.co.jp/info/index.php), smoking section. The mall operator refers visitors to an adjacent place; this does not establish that it manages the smoking place |
| station-facts.json / kanazawa-station-east | East exit; outside building; across from Ishikawa Ongakudo | Same section. Independent zone coordinate and smoking-place manager unconfirmed |
| museum-facts.json / kanazawa21-hirosaka | Smoking corner outside the museum, near Hirosaka entrance | [Museum visitor rules](https://www.kanazawa21.jp/data_list.php?d=1&g=35), indoor rules. Direct facility statement. [Floor map](https://www.kanazawa21.jp/data_list.php?g=9) / [PDF](https://www.kanazawa21.jp/tmpImages/videoFiles/file-9-1-file.pdf) both pages visually reviewed: Hirosaka is the north entrance; no exact smoking-point coordinate established |
| castle-facts.json / kanazawa-castle-office | Smoking place in the vicinity of the castle/Kenrokuen management office | [Official FAQ](https://shiro-niwa.pref.ishikawa.lg.jp/kanazawa-castle/info/question.php), convenience facilities section. [Park rules](https://shiro-niwa.pref.ishikawa.lg.jp/kanazawa-castle/info/request.php) prohibit smoking outside designated places. [Leaflet entry](https://shiro-niwa.pref.ishikawa.lg.jp/kanazawa-castle/download/leaflet.php) and #339's visually reviewed guide map locate the vicinity, not a reusable exact point |

All four: smoking-specific hours, public/customer/ticket restrictions, paper/heated support remain unknown.
`openingHours.status=none` means no hours stated, not closed. Facility opening hours are never transferred.
`placement=outsideBuilding` means the publisher directs visitors outside; it does not establish an unenclosed outdoor
area, roof, shelter or booth construction. Therefore `environment=unknown`. Castle placement is also unknown.
No ashtray installation, general public permission, free access or 24-hour operation is inferred.
The existence field `listed` records a page claim, not accepted evidence or lifecycle=active.

## Independent approximate anchor proposal (museum only)

The city government's [tourism facility dataset resource](https://catalog-data.city.kanazawa.ishikawa.jp/dataset/172014-tourism/resource/51a0ab9e-e702-40c2-bc0e-1c5ce1da4e66)
contains ID `AA0000001260`, name 金沢21世紀美術館, address 石川県金沢市広坂1-2-1,
latitude `36.560867`, longitude `136.658258`. Retrieve through its public
[CKAN datastore endpoint](https://catalog-data.city.kanazawa.ishikawa.jp/api/3/action/datastore_search?resource_id=51a0ab9e-e702-40c2-bc0e-1c5ce1da4e66&limit=1000).
The query returned all 20 records (`total=20`); `_id=6` is retained as receipt context, while ID is the source's identifier.
The name/address identify the host; they do not prove smoking existence. Coordinate columns are 緯度 / 経度.
CRS is not established in the reviewed resource and stays unknown. Catalog metadata reports a 2024-05-01 update;
this is not a smoking-place verification date.

Only `locationAnchorCandidate` carries this point: scope=`facility`, basis=`referenceDatasetPoint`,
reviewStatus=`UNREVIEWED`, rightsStatus=`unreviewed`. Candidate precision is `areaApproximate`; the exact-point
latitude/longitude fields remain null. Accepted pipeline precision remains unknown until anchor/source review.
Do not label the point as Hirosaka entrance, `namedZone`, `publisherPoint` or `reviewedDerived`.
No map-vendor pin, screenshot extraction, centroid, manually placed point or geocode was used.
The museum point must never become the anchor for the station or castle. A station centre could only group the
station zones as one facility result; it cannot create two exit pins (ADR-0018 same-anchor rule).

## Rights observations — decisions still required

This section describes clauses read, not permission or a legal conclusion. `licenseName`/`licenseUrl` on all receipts
remain null. There is no new `FactReferenceReview`, approval flag or entry in `docs/SOURCES.md` / `REVIEWED_SOURCES`.

| Material | Terms observed | Required decision |
| --- | --- | --- |
| 100bangai service / floor / FAQ | Page footer reserves copyright. [Privacy policy](https://www.100bangai.co.jp/privacy/) concerns personal data; it is not a reuse licence. [Company page](https://www.100bangai.co.jp/company/) identifies the publisher. No applicable information-use permission established | Maintainer reviews exact factReference scope and whether the neighbouring operator referral is acceptable. Obtain smoking-place manager confirmation independently; do not treat the referral as city approval |
| Museum visitor rules / floor map | Footer reserves copyright. Navigation's site-policy link leads to [personal-information policy](https://www.kanazawa21.jp/data_list.php?d=1&g=60); it does not grant reuse rights | Source-specific factReference review and any additional applicable terms/permission. Map/prose reproduction excluded |
| Castle FAQ / leaflet | Page footer forbids unauthorized reproduction of text/photos. [Prefecture policy](https://www.pref.ishikawa.lg.jp/about_site/sitepolicy/index.html), copyright section, restricts reproduction/diversion except lawful exceptions | Source-specific factReference review. Do not apply a general prefecture licence to a separate site's map without reviewing scope |
| Museum city anchor | Catalog label is Creative Commons Attribution; it points to an Open Definition description, not a versioned licence grant. [Original city open-data rules](https://portal-data.city.kanazawa.ishikawa.jp/pdf/opendata_rule.pdf), §2(1) defer to each data licence, §2(2) require name/publisher/URL and processing indication, §2(3) reserve third-party rights | Confirm resource-specific terms/version or applicability of numerical-data provision, coordinate meaning/CRS, registration as an anchor source and attribution. Catalogue label alone is not source approval |

Proposed attribution is in the receipts and museum anchor object; a final display must include the specific page URL,
check date and processed-data indication, plus the independent city-anchor credit. It must not imply endorsement.
Only necessary normalized facts and hashes are committed. HTML, map images, PDFs, logos and expressive prose stay
outside git. `fetch-ledger.json` records original URLs, status, byte hashes and UTC fetch time; these do not grant rights.

## Current-operation and contradiction scope

All three specified pages were fetched live and checked on 2026-10-26. The [100bangai FAQ](https://www.100bangai.co.jp/faq/)
refers both to exits and an interior Anto-nishi location; the service page directs users outside. The new data do not
adopt that interior claim. This previously recorded discrepancy is not silently resolved, nor proof of closing the
exit places. Ask the operator to distinguish current indoor vs outdoor places and the responsible manager.

[Museum closure announcement](https://www.kanazawa21.jp/data_list.php?d=503&g=61): closure planned from
2027-05-06 to 2028-03. The effect on the outside smoking corner is unknown and needs a dated follow-up before release.
Bounded searches for relocation/closure on the relevant official sites found no specific resolution of these questions;
they are not a complete operational audit. Page checks do not populate canonical lastVerifiedAt without accepted review.

## Intake and next transition

From `services/api`, Node >=24, for each `station`, `museum`, `castle`:

```sh
npm run source:intake -- \
  --metadata ../data-pipeline/research/official-source-intake/kanazawa/station-receipt.json \
  --file ../data-pipeline/research/official-source-intake/kanazawa/station-facts.json \
  --format json --out /private/tmp/kanazawa-station-intake-new.json
```

Choose fresh output paths; output is not overwritten. The committed `*-intake.json` files were generated by this CLI.
This produces receipts for 2+1+1 actual rows, not accepted observations. All remain BLOCKED and quality/promotion
notEvaluated. Nested anchor context is not auto-approved by coordinate-column detection. The advisory scanner reports
`coordinateAvailability=all` for these JSON column names even though exact latitude/longitude values are null.
That is not evidence of usable points: onboarding coordinate authority remains unknown/required for every source.
Only the museum nested anchor proposal has numbers, and it is explicitly unreviewed and approximate.

`test/kanazawa-intake.test.ts` additionally exercises `ingestRelease` in a disposable in-memory database using
explicitly blocked **test-only** sources/adapters: four raw source records, no accepted observations, resolve refused,
canonical delta 0 and unchanged existing public tile bytes/IDs. This is not a supported production registration path.

After maintainers supply the missing decisions: pin reviewed source/anchor provenance, implement a source-specific
adapter plus licensed/factReference fixture and tests, then use existing registry/resolve/quality/publication checks.
Unknown hours/tobacco/access must remain unknown; they are not alone a reason to invent data or reject existence.
G5 shipping corpus legal sign-off and signed-device attribution checks remain separate and open. No ad-hoc approval
or direct SQL publication route is supplied. Production work requires separate authorization.
