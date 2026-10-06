# Next official source — bounded review, 2026-10-06

Base: `aa61281fcd4dfc6b4683688f5f7eafbea7144305`. Related open issues:
[#67](https://github.com/Kounishiyuuki/MannerPath/issues/67),
[#113](https://github.com/Kounishiyuuki/MannerPath/issues/113),
[#137](https://github.com/Kounishiyuuki/MannerPath/issues/137),
[#141](https://github.com/Kounishiyuuki/MannerPath/issues/141).

**Outcome: select Fuchu City's two public smoking places for the next publisher-permission
follow-up, not for onboarding. No new source passes all publication gates in this bounded
review. Added sources / implemented adapters / new published spots: 0 / 0 / 0.**
Do not mistake the selection for license approval, implementation completion or nationwide coverage.
Production's existing release evidence remains 513 published spots / six approved official
municipal sources / zero community. No production query or mutation was performed here.

## Scope and prior blockers

Issue #113's high-volume target remains unmet. Issue #137's 19-item queue has no approved
source; Chuo rights/operation conflicts, Shinjuku registered archives, Suginami access and
Yamanashi access/geometry remain unresolved. Those blocked releases were not retried or
reused. Previously rejected host coordinates and prohibition features were not repurposed.
The Fuchu prohibition-route dataset already mentioned in the west/central survey is
**not** the candidate here: the newly inspected ordinary `kituenjo.html` listing describes
two public smoking places. The old route dataset stays excluded.

Targeted web searches also returned usage statistics and a non-municipal citizen survey
on an open-data portal (the Nonhoi map); neither is canonical official smoking-point evidence.
Only publisher pages below inform the comparison. This is not an exhaustive national scan.

## Candidate comparison

Priority considers official existence evidence first, then count, applicable rights,
coordinate precision, implementation effort and maintenance. Counts describe what was
actually established, not inferred points or importable records.

| Candidate | Official evidence / count | License applicability | Coordinate evidence | Cost / maintenance | Decision |
| --- | --- | --- | --- | --- | --- |
| [Fuchu public smoking places](https://www.city.fuchu.tokyo.jp/kurashi/sekatu/bika_gaichu/kituenjo.html) | Publisher names two public smoking places; updated 2026-06-01 | Open-data CC BY 4.0 cannot be extended to this ordinary page without evidence | Addresses only in inspected listing; no reviewed smoking-site coordinate release | Small named scope; relatively recent listing. Low expected parser cost **if** a licensed point release is supplied; refresh cadence unknown | First follow-up; publication blocked by rights and position |
| [Hachioji smoking-place listing](https://www.city.hachioji.tokyo.jp/tantoumadoguchi/017/001/p007184.html) | Six station-area sections, **not six established spots**; exact reusable row count unknown | Catalog-only CC BY scope; ordinary page subject to separate copyright terms | Images/maps, not inspected licensed smoking Point data | Higher operation-review cost: temporary closure and daily cleaning restriction; no stable reviewed feed | Lower priority, no onboarding |
| [Kokubunji smoking points](https://www.city.kokubunji.tokyo.jp/kurashi/seikatsu/1011391/1013202.html) | Three station-area map links, **not three established spots**; exact count unknown | Exact listing/PDF license applicability unresolved | PDF map references only in inspected HTML | Older page (2020-06-30); catalog fetch returned 403, host follow-up stopped | Access/rights/position unresolved; no onboarding |

Fuchu is chosen for a narrowly scoped, recent, explicit public-place listing and a
verifiable open-data catalog boundary, not because two spots beat an unverified larger count.
None is presently an implementation-ready source. No arbitrary scoring number hides a failed gate.

## Fuchu primary evidence and rights boundary

- Listing: https://www.city.fuchu.tokyo.jp/kurashi/sekatu/bika_gaichu/kituenjo.html
  The publisher identifies 府中駅前喫煙所 and けやき並木通り喫煙所, gives addresses and
  operating times, and qualifies availability during cleaning/inspection. These are explicit
  smoking-place statements, not evidence inferred from a station or convenience store.
- [Open-data policy/catalog](https://www.city.fuchu.tokyo.jp/gyosei/opendata/index.html):
  CC BY 4.0 applies only to the designated open data. Publisher attribution is required.
- [Website policy](https://www.city.fuchu.tokyo.jp/aboutweb/policy.html): ordinary content
  is distinguished from open data; unauthorized republication is not granted by the catalog license.
  This report makes no legal ruling about individual facts; repository policy requires reviewed reuse.
- Full catalog metadata downloaded from
  https://www.city.fuchu.tokyo.jp/gyosei/opendata/index.files/metadata.csv
  (catalog label: 2026-09-01). Exact bytes: 1,464,759; SHA-256
  `2166e9f7aa907c582bbffaa0046a177440bc856188877a83c876eefd213383d2`.
  Strict CP932 decode and `csv.DictReader` found 1,605 records. Six records contain
  喫煙/灰皿/たばこ somewhere in their fields, but none contains 公衆喫煙所 or the exact
  listing URL. The six are statistics, revenue/sales/fire/youth records or prohibition routes,
  not a smoking-place point release. This establishes only the inspected catalog's scope,
  not absence of any future/other official resource. Raw bytes remain outside git.

Candidate identifier for planning only: `fuchu-public-smoking-places` (not registered).
Applicable license name/URL, commercial use, modification, redistribution, share-alike
and required attribution for the **exact candidate release** all remain `unreviewed`.
Do not publish a speculative CC BY credit. No raw candidate fixture, registry constant,
release fingerprint or adapter was created from unapproved content.

## Exact unlock conditions and implementation boundary

1. A maintainer may ask Fuchu's responsible environment-policy/open-data departments for
   a licensed CSV/GeoJSON or equivalent smoking-place release, including reuse in commercial
   apps, normalization, client/database redistribution and required attribution. No contact
   or request was sent by this task; permission is not assumed.
2. Obtain publisher smoking-site coordinates with coordinate semantics/CRS and stable row
   references, and inspect both places plus operation restrictions against that exact release.
   If only an area anchor is supplied, separately review the reusable official anchor and
   ADR-0017 `areaApproximate` mapping. A station centroid cannot silently become a smoking pin.
3. Record original bytes, retrieval metadata, hash, license scope and conflicts in immutable
   fixture provenance; review `docs/SOURCES.md` before the adapter enters the reviewed registry.
4. Follow the existing `SourceAdapter` ingest → observation → resolution → publish path:
   exact schema, pinned first-release URL/hash/count, explicit existence/name/location provenance,
   unknown tobacco support and honest freshness. Do not substitute fetch time for observation time
   or assume unrestricted opening during cleaning. Add parser drift, non-smoking-host rejection,
   fingerprint, attribution/detail, precision and fresh-pipeline/golden tests before approval.
5. Run local quality and promotion review separately from any production launch. No automatic
   refresh or production corpus expansion is authorized by this research.

ADR-0011 is still Proposed: #141's derived-coordinate publication policy is not approved.
An address cannot be geocoded into `publisherPoint`; no geocoding was performed. Selected
candidate precision is `unknown`, not a canonical value. Confidence/existence and location
precision remain separate. OSM remains reference-only/blocked and community #124 remains blocked.

## Local validation

Node 24.21.0. Exported the base commit's `services/api` and `services/data-pipeline` with
`git archive` into a fresh `mktemp` tree, linking only installed `node_modules`. All
Wrangler/pipeline commands ran in that tree's `services/api`, so the existing worktree's
local D1 and production artifacts were not reused or altered.

- `npm run local:migrate`: canonical migrations 0001–0030 applied locally.
- `npm run local:pipeline -- <sourceId>` for each of
  `taito-public-smoking-areas`, `osaka-designated-smoking-areas`,
  `koto-station-smoking-areas`, `musashino-public-smoking-areas`,
  `minato-designated-smoking-areas`, `kyoto-public-smoking-places`: all succeeded.
- `npm run local:quality`: 515 canonical / 513 published / 81 tiles / six sources;
  canonical and published community counts zero; 16/16 checks pass, `failedChecks = 0`.
- `PATH=/opt/homebrew/opt/node@24/bin:$PATH make api-validate`: typecheck PASS;
  861 API tests and 69 discovery tests PASS.
- Focused existing `community-reconciliation`, `derived-coordinate`, `kyoto-source`
  suites: 30/30 PASS, including unreviewed source rejection, blocked community and
  coordinate/attribution gates. These are baseline regressions, **not** source-specific
  tests for an implemented Fuchu adapter; no such adapter or tests are claimed.

Local logs/state: `/tmp/mannerpath-next-official-source-Vwwmym/`; API log:
`/tmp/mannerpath-next-official-source-api.log`. These checks validate the unchanged
accepted baseline, not a new candidate or live production state. No remote D1, R2 or
Worker command was run; no approved registry, migration, promotion artifact, source
fixture, source schedule, OSM/community policy or release gate was changed.

## Issue progress

#67 / #113: bounded new-candidate comparison and a concrete publisher follow-up target;
no source-volume or coverage target achieved. #137: existing blockers preserved; none unlocked.
#141: policy boundary respected; no derived-coordinate approval or implementation progress claimed.
All four issues remain open; this report does not close release/legal/privacy gates.
