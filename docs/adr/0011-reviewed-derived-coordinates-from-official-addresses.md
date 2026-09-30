# ADR-0011 — Reviewed derived coordinates from official addresses

Status: **Proposed** (2026-10-01). The technical foundation (migration 0022,
`services/api/src/pipeline/derived-coordinate.ts`, the candidate replay) is implemented and inert. The
**publication policy in decision 8 is not approved**: until a maintainer approves it in a separate reviewed change,
the existing rule stands — *an address-only source is not geocoded into a published spot*. Nothing in
`docs/DATA_POLICY.md`, `docs/SOURCES.md`, the resolver, promotion or tiles changes with this ADR.

This ADR is an engineering decision, not legal advice. Where terms do not settle a question it says **未確定**.

## Context

The nationwide discovery run (#138: 190/190 targets, 954 resources, 161,562 rows) found no new approvable
source. The most common blocker for official smoking-place listings is `coordinatesMissing`: the publisher
lists the place and its address but supplies no coordinate. Research notes repeatedly record "do not geocode".

The question: can an official address be turned into a coordinate **without** weakening the evidence gate
(ADR-0006), and would doing so unlock meaningful coverage?

## Core principle

**Existence evidence and position evidence are separate.**

- Existence: an approved official smoking-place publisher says a smoking place exists at this address.
- Position: a reviewed, locally run, version-pinned geocoder estimates where that address is.

A geocoder is never evidence that smoking is permitted anywhere. It cannot turn a host facility, a
convenience store, a prohibition zone or an unapproved source into a spot: the gate rejects those before it
looks at the geocode.

## Options

| | Option | Verdict |
| --- | --- | --- |
| A | Keep publisher coordinates only | Safe baseline; leaves every address-only listing blocked |
| B | Reviewed deterministic geocoding: official address → reviewed local geocoder → derived coordinate | **Technically viable; proposed**, subject to decision 8 |
| C | Commercial geocoder (Google, Apple/MapKit, Yahoo!, Zenrin, …) | **Rejected**: vendor terms restrict storing/redistributing results; MapKit is presentation only (DATA_POLICY) |
| D | Arbitrary/manual map pin | **Rejected**: a human pin is neither publisher evidence nor reproducible |
| — | OSM / Nominatim as geocoder | **Rejected**: ADR-0010 keeps OSM reference-only; OSMF's Geocoding Guideline makes systematic collection a Derivative Database |

## Geocoder review (primary sources, 2026-10-01)

| Candidate | Publisher | Software license | Data license | Local/offline | Verdict |
| --- | --- | --- | --- | --- | --- |
| **abr-geocoder 2.3.1** (`@digital-go-jp/abr-geocoder`) | デジタル庁 | MIT (package `LICENSE`, source headers "Copyright (c) 2024 デジタル庁") | ABR: 公共データ利用規約（第1.0版） (PDL1.0) — reuse, modification, redistribution and commercial use permitted with 出典 and a modification notice; must not be presented as unaltered government data. **Exception:** 地番マスター / 地番マスター位置参照 fall under 登記所備付地図データ利用規約 (法務省, via G空間情報センター; reuse with 出典 and a modification notice) | Yes: `abrg download -c <lg_code>` fetches per-municipality CSVs into a local SQLite DB; `abrg` then runs without network | **Chosen technical candidate** |
| 国土交通省 位置参照情報 (街区/大字・町丁目) | 国土交通省 | n/a (data) | Not re-reviewed in this ADR (**未確定**) | Yes (download) | Not needed: ABR already carries 街区 points |
| 国土地理院 アドレス検索 API (msearch.gsi.go.jp) | 国土地理院 | n/a | No published service terms for bulk/systematic use found | No (network API) | Rejected: network dependency, no version pinning |
| normalize-japanese-addresses / community geocoders | third parties | MIT | Depends on hosted third-party data | Partly | Rejected as primary: data provenance is a third party, not the government registry |

abr-geocoder facts observed in this review (package source and a real local run, not documentation alone):

- **Levels** (`src/domain/types/geocode/match-level.ts`): `error, unknown, prefecture, city, machiaza,
  machiaza_detail, residential_block, residential_detail, parcel`. Output carries both `match_level` and
  `coordinate_level`; they can differ. The coordinate is always a *representative point* (`rep_lat/rep_lon`).
- `residential_detail` points come from ABR 住居表示-住居マスター位置参照拡張: 基礎番号 representative points,
  source GSI 住居表示住所 (`rsdt_addr_code_rdbl` → `gi.gsi.go.jp/jusho`), `rep_srid` EPSG:6668, `rep_scale` 2500.
- `residential_block` points (街区位置参照拡張) were observed in **EPSG:4612** (JGD2000) for Tokyo: datums are mixed,
  so the CRS is recorded per result.
- `parcel` points are sparse: for 千代田区, 251 of 21,269 parcel rows have a position (`mt_parcel_pos_city131016.csv`).
- The output has `others` (unmatched remainder) and `score`. With `--fuzzy` a wildcard matches arbitrary characters.
- It prints one best result; it does not enumerate alternatives.
- **Determinism**: the same input file over the same local DB produced byte-identical JSON on two runs.
- Version 2.3.x is announced as the last v2 release; v3 will follow. Version pinning is therefore mandatory.

Real results that shaped the gate (千代田区 dataset, 2026-10-01):

| Input | Result | Gate |
| --- | --- | --- |
| 東京都千代田区紀尾井町1-3 | residential_detail / residential_detail, others [], score 1 | candidate |
| 東京都千代田区霞が関1-3-1 | residential_block, others ["-1"], score 0.82 | rejected (remainder, score) |
| 東京都千代田区丸の内 | match `machiaza` but coordinate `city` | rejected (precision; coordinate coarser than match) |
| 東京都千代田区紀尾井町99-99 | machiaza, others ["99-99"] | rejected (nonexistent number falls back to town point) |
| 千代田区有楽町2-9 (no prefecture) | printed 東京都千代田区**千代田区**有楽町2-9, machiaza, score 0.59 | rejected (normalization changed meaning) |
| 東京都千代田区外神田1-17-6 JR秋葉原駅 | residential_detail, others ["JR秋葉原駅"], score 0.88 | rejected (remainder not silently dropped) |

## Decisions

### 1. Precision model (from `coordinate_level`, never `match_level`)

| MannerPath precision | abr `coordinate_level` | Policy |
| --- | --- | --- |
| `residentialDetail` | `residential_detail` | candidate for publication, still needs human approval |
| `residentialBlock` | `residential_block` | human review **with independent site evidence** |
| `parcel` | `parcel` | human review with independent site evidence; also carries the 法務省 license; a large lot (a park) can be far from the booth |
| `insufficient` | `machiaza_detail` and coarser, `unknown`, `error` | never publishable (the database refuses an approval) |

There is no "exact building" level: ABR does not model buildings or entrances. A derived coordinate is at best
the representative point of an address, never an entrance or a floor.

### 2. Fail closed

A candidate is rejected on any of: source not approved; row not an official smoking-place listing; current
operation not confirmed; address not publisher-supplied; address reuse not reviewed; input rule not reviewed
(only `verbatim`); no result; geocoder, version or dataset release not reviewed/pinned;
fuzzy matching; more or fewer than one candidate; any unmatched remainder; score ≠ 1; insufficient precision;
coordinate coarser than match; no/invalid coordinate; prefecture/municipality mismatch; any disagreement with
another reviewed geocoder run (no distance tolerance). Two places geocoding to one point form a review group.
The closest result is never picked.

### 3. Provenance (migration 0022)

`derived_coordinate_geocodes` (immutable) stores, per raw `source_records` row: the publisher column and verbatim
official address, the exact geocoder input and input rule, geocoder id/version/options, the dataset release as a
content digest, normalized output, remainder, score, both provider levels, MannerPath precision, coordinate and
CRS, `lg_code`, the geocoder data licenses (the source license stays on `sources`), an evidence digest and
`generated_at`. A rerun with another version or dataset is a new row.

`derived_coordinate_reviews` is append-only and bound to the evidence digest. An approval must confirm all six
checks (official address, normalized address, returned location, precision, region sanity, current official
listing); below `residentialDetail` it also needs site evidence. The newest decision wins.

`coordinateOrigin` is `publisher | derivedGeocode`. Publisher and derived coordinates are never collapsed into one
provenance kind. If the policy is approved, the location row of `spot_field_provenance` gains a `derivedGeocode`
rule namespace that points at the geocode row; that link is **not** migrated now.

### 4. Publication gate (if approved)

All of: approved existence source; publisher-supplied, reuse-reviewed address; reviewed geocoder with a pinned
dataset; deterministic rerun reproducing the digest; sufficient precision; unique result; global coordinate
invariants; expected jurisdiction; current-operation evidence; an approving review of that exact digest.
**Automatic geocode → publish is forbidden.** `derivedPublicationDecision` returns `policyNotApproved` today for
every input.

### 5. No silent moves

A new geocoder version or dataset never moves a published derived coordinate: the new run has a new digest, the
old review does not apply to it, and it needs its own review and release.

### 6. Replacement by a publisher coordinate

When the publisher later supplies a coordinate, the change is a relocation review item under ADR-0009 policy v1
(every coordinate change is reviewed; no threshold). The spot keeps its identity; source priority never
overwrites the derived coordinate automatically. `planPublisherCoordinateReplacement` encodes this.

### 7. Presentation

Derived coordinates are never labelled official coordinates. Proposed `evidenceQuality`
`officialListingDerivedLocation` in a new evidence-quality version; clients already treat unknown values as
non-official. Navigation shows one line — 「位置は公式住所から推定」 — and nothing else changes in the UI.
Attribution adds the ABR (and, for parcel, 法務省) credit next to the source's. API/UI changes land with decision 8.

### 8. Publication policy — **requires maintainer approval (not granted)**

Proposed text: *"An address-only official smoking-place listing may be published with a derived coordinate only
through ADR-0011's gate and an approving review; the coordinate is marked derived everywhere."* Until approved,
`DERIVED_COORDINATE_PUBLICATION_POLICY.status` stays `proposed` and the resolver has no derived-coordinate path.

## Impact (replay over committed research, `npm run replay:derived-coordinates`)

26 address-only official smoking candidates (8 prefectures), 51 stated spots plus 15 candidates without a stated
count. **0 pass the gate today, and 0 pass even in the simulated best case** (policy approved, every
license-established source approved, every street address at residential detail). The binding blocker is
license, not coordinates: 18 candidates have unknown reuse terms and 6 are explicitly blocked. The two
license-established ones fail on other grounds — 札幌 大通公園 (current operation unknown; parcel precision) and
静岡市 (no address at all). If the reuse terms of the exact-address, currently operating candidates were resolved,
5 sources (川崎市, 新宿区, 文京区, 渋谷区, 板橋区; ≥21 spots) and one new prefecture (神奈川県) would reach the
gate. Details: `docs/research/2026-10-01-derived-coordinate-impact.md`.

## Consequences

- The foundation lets a future approval be a small, reviewable switch rather than new machinery.
- Adopting decision 8 alone unlocks nothing today; license work (asking publishers for reuse terms) comes first
  and would often yield publisher coordinates anyway.
- The ABR dataset (≈ 400 MB for one prefecture's download) is never committed. A reviewed setup pins it by content
  digest in `REVIEWED_GEOCODERS.datasetReleases`, which is empty now, so every real run fails closed.
