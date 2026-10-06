# Next implementable official source: bounded comparison

Research date: 2026-10-06. Base: `152a16d5edbeff33e5fc491c645b47b239583cb6`
(#199 merged). Related issues: #67, #113, #137, #141; none is closed by this record.

## Decision

**No adapter implementation.** None of the three candidates below has a confirmed
reusable smoking-location release with both rights and safe position semantics.
This is a bounded investigation, not proof that no implementable source exists nationwide.
No municipality is newly approved. Added sources / imported spots / published spots: **0**.

The production baseline remains the existing release evidence of **513 published spots,
six approved municipal sources, community 0** in
[the production audit](../PRODUCTION_CONTENT_RIGHTS_AUDIT.md). Production was not queried or changed.

Fuchu, Hachioji and Kokubunji are excluded; the prior blocked/rejected releases are not
reused. Existing research mentions Urayasu/Ebina in an OpenPOI discovery corpus; those
third-party entries are neither evidence nor coordinate inputs for this investigation.

## Comparison

Priority: rights → coordinates → official evidence → count → maintainability.
Counts describe the inspected municipal prose, **not** validated importable rows.
No candidate passes the first two gates, so no implementation winner is selected.

| Candidate | Official smoking evidence / count | Rights and attribution | Coordinates | Implementation / maintenance | Decision |
| --- | --- | --- | --- | --- | --- |
| Urayasu | Municipal page names three smoking spaces | Ordinary page reuse not authorized; municipal open-data CC BY 4.0 not proven to cover this page | No smoking-point coordinates verified | Small HTML list, but licensing scope and reusable positions unresolved; displayed date is old | Hold; 0 importable rows confirmed |
| Ebina | Municipal page identifies east-exit police-box-front and east-exit north-side smoking places (two named places) | Ordinary-page commercial redistribution requires permission; CC BY 4.0 explicitly restricted to listed open datasets | No licensed smoking-point coordinates verified | Small list; closure and tobacco-type distinctions require maintenance | Hold; 0 importable rows confirmed |
| Narashino | Municipal page introduces an external JT map, not a municipal smoking-place release; count unknown | Municipal link does not license external records; no usable municipal release attribution established | No municipal smoking-point coordinates verified | External service is not an acceptable municipal adapter input | Reject this referral page as canonical source |

## Urayasu

- [Municipal smoking-space page](https://www.city.urayasu.lg.jp/todokede/kankyo/kankyo/bika/1000670.html):
  names Urayasu station Seseragi plaza, Shin-Urayasu station plaza and Maihama station
  north exit. These are explicit smoking-space statements, not inferred station hosts.
  The displayed update date is 2012-01-31; do not treat the retrieval date as publisher freshness.
- [Copyright policy](https://www.city.urayasu.lg.jp/site/1005105.html): unauthorized
  copying/reuse outside statutory exceptions is not permitted. This investigation
  does not assume a statutory exception permits a commercial canonical dataset.
- [Open-data terms overview](https://www.city.urayasu.lg.jp/shisei/keikaku/joho/1022110/index.html):
  open data generally uses CC BY 4.0, with exceptions; attribution to the city is required.
  This does not establish that the ordinary smoking-space page is an open-data release.
- [Officially linked BODIK catalog](https://odcs.bodik.jp/122271/) and
  [map-data dataset](https://data.bodik.jp/dataset/_mapshp) were inspected. Map-data
  metadata is CC BY 4.0 and describes EPSG:2451; inspected resource titles do not
  establish a smoking-point layer. No map ZIP was imported or used to infer points.
  The separate [open-data-map dataset](https://data.bodik.jp/dataset/122271_opendatamap)
  could not be fetched through the research browser (cache miss); its contents remain unknown.

**Re-entry condition:** exact reusable smoking release (or permission covering the
smoking evidence) plus reviewed publisher coordinates or a licensed, reviewed
ADR-0017 anchor/mapping. No assumption that all catalog/map layers were exhaustively searched.

## Ebina

- [Municipal smoking rules and places](https://www.city.ebina.kanagawa.jp/guide/kurashi/bika/1007924.html),
  displayed update 2026-01-26: the police-box-front space is heated-tobacco-only;
  paper tobacco is directed to the north-side space. The page also notes west-exit
  closure; a former west-exit location must not be reinstated from historical records.
- [Copyright policy](https://www.city.ebina.kanagawa.jp/about/1005671.html): ordinary
  site reuse is limited and other uses require prior permission. No commercial
  redistribution permission for this smoking page was confirmed.
- [Open-data library](https://www.city.ebina.kanagawa.jp/shisei/denshi/opendata/1008755/index.html)
  explicitly limits CC BY 4.0 to the listed datasets, not all municipal pages.
- [Point-data catalog](https://www.city.ebina.kanagawa.jp/shisei/denshi/opendata/1008755/1004083.html)
  lists June 2019 general facility CSVs, not an identified smoking-place release.
  [Other open data](https://www.city.ebina.kanagawa.jp/shisei/denshi/opendata/1008755/1004085.html)
  likewise does not establish a licensed smoking-point file in its visible attachments.
  CSV contents were not exhaustively inspected; absence of a smoking dataset is not claimed.

**Re-entry condition:** exact licensed smoking-point resource with current operation
status, or permission covering evidence plus a compliant position mapping. A licensed
station/park coordinate alone neither proves smoking permission nor becomes `publisherPoint`.

## Narashino

[The municipal referral page](https://www.city.narashino.lg.jp/soshiki/kurin_suishin/gyomu/seikatukankyo/kankyo/26290.html)
(displayed update 2025-05-14) identifies the map provider as JT. A municipal hyperlink
does not turn externally provided spots into municipal provenance or authorize their
redistribution. No external map records were ingested, and no commercial reuse,
attribution or coordinate claim is made for them.

**Re-entry condition:** a distinct municipality-published, reusable smoking-location
release. Do not retry this referral as a municipal source or use tobacco-promotion
content in the product.

## Boundaries and follow-up

- No registry, adapter, fixture, release metadata, schema or code changes.
- No geocoding, Apple/OSM/third-party coordinate extraction, or guessed `publisherPoint`.
- ADR-0011 remains proposed/inert; approximate placement requires the actual licensed
  anchor and review required by ADR-0017, not an arbitrary station center.
- Unknown hours, rights and position precision remain unknown, not false or approved.
- Community #124 remains blocked; OSM is not adopted. No new release gate is introduced.
- No Cloudflare calls, remote writes, deployments or production publication.
- This record advances candidate triage for #113/#137 and the #67 coverage backlog;
  it does not implement or approve #141 or claim additional coverage.

Validation for this docs-only record: `make api-validate`, `make contract`,
`git diff --check`. No new pipeline/migrations are run because there is no new adapter.
