# Nationwide official/operator discovery — first run (2026-09-30)

Issue [#130](https://github.com/Kounishiyuuki/MannerPath/issues/130), branch
`tooling/nationwide-source-discovery`. Local-only discovery; no community implementation,
source-policy change, remote D1 or production deployment.

## Result and stopping condition

Condition B reached: **190 jurisdiction/operator/national groups** were mechanically
classified and reachable bounded raw resources inspected. **215 raw resources**
(214 unique hashes) were successfully parsed in this batch; **61 prior inspections**
were reused rather than downloaded again. There are **37 blocked groups** and
**73 groups with scan bounds**. These are a first pass, not an exhaustive nationwide
absence claim. Host-stop fallback preserves recorded 403/429 on cache-only reinspection.

The manifest tracks 47 prefectures, 92 municipalities, 50 operators and one national group.
Overlapping roles cover 47 capitals, 20 ordinance-designated cities and all 23 Tokyo wards.
57 targets have explicit catalog connectors; other targets have bounded official page entry points.
All 190 targets were attempted; no manifest region remains unscanned. Portal-wide queries can
include another jurisdiction's dataset and are discovery evidence, never coverage attribution.

Three keyword candidates were individually checked against the publisher's exact CSV rows and
landing pages. None meets the smoking-point gate:

- 津市: discarded portable/metal/glass ashtrays in a waste-sorting table, no smoking locations.
- 大阪市: a catalog index points to the already implemented environment/recycling CSV; no new source.
- 杉並区: a catalog entry for road-smoking prohibition districts, no permitted smoking-site Points.

Exact URL/hash and unresolved gate fields are in
[the manual review attestations](nationwide-discovery/2026-09-30-reviews.json).
No applicable license is inferred. Ineligible metadata rows are rejected before full license or
operation approval; their unreviewed fields are recorded explicitly rather than presented as checked.
**New approved sources: 0; implemented sources: 0; new published spots: 0;
new covered prefectures: 0; new covered major cities: 0.**

The machine-readable [run](nationwide-discovery/2026-09-30-run.json) and generated
[coverage tables](nationwide-discovery/2026-09-30-run.md) distinguish discovery status from publication.
Existing partial coverage remains three prefectures, two capitals/designated cities and three wards,
from six reviewed municipal sources. This does not represent complete jurisdiction coverage.

## Tool and reproducibility

New modules under `services/data-pipeline/discovery/` separate manifest/research seed, connectors,
raw cache, format/content scan, candidate evaluation, state and report generation. From `services/api`:

```sh
npm run discover:sources -- --delay 1000 --timeout 12000 --retries 1
npm run discover:sources -- --rescan --cache-only --reviews ../../docs/research/nationwide-discovery/2026-09-30-reviews.json --report ../../docs/research/nationwide-discovery/2026-09-30-run.json
npm run test:discovery
```

The live first pass used one request per host, a 1-second host delay, a 12-second request timeout,
one retry and four independent target workers. BODIK returned 403 on its single probe and stopped;
Tokyo catalog, Kobe and Centrair host stops did not interrupt other hosts. No bypass was attempted.
Raw bytes/checkpoints remain in ignored `.local/`, not committed fixtures. Conditional requests
use ETag/Last-Modified when explicit revalidation is requested. Cache-only parser rebuilds preserve
raw SHA identity and never perform network requests. The report contains inspection timestamps
separately from original fetch times; neither becomes observation time.

Supported connectors: CKAN, ArcGIS REST, static/index pages, CSV/JSON indexes.
Supported inspection: CSV/TSV, JSON/GeoJSON, bounded KML, KMZ, SHP ZIP DBF/PRJ and GPKG metadata/attributes.
SHP/GPKG geometry is not converted to coordinates. XLS/XLSX remain incompatible in the new scanner;
existing historical inspections are retained. Caps and malformed formats remain explicit blockers.
Category inventories preserve coded categories but never infer an unknown code as smoking.

## Validation and unchanged corpus

`make contract`, `make api-validate`, API `tsc -p .`, discovery mock/fixture tests and both diff checks
passed for the final implementation. API validation includes the new discovery suite.
The full API suite includes quality, promotion, cross-source and all-migration integration coverage.

A separate fresh local SQLite/D1-compatible verification applied every real migration, ingested all
six reviewed fixtures, published the combined corpus, ran quality and cross-source candidate generation,
built promotion v3, applied it to a fresh migrated target and re-exported identical bytes.
Result: **6 reviewed sources, 515 canonical, 513 published, 81 tiles; quality all pass;
promotion v3 byte-identical; 0 cross-source candidates**. No new source means new-source onboarding
and a Wrangler fresh-D1 run are inapplicable; no schema, registry or corpus values changed.

## Next batch

All manifest regions were attempted, but 73 bounded groups and deeper catalog pages remain incomplete.
Highest-value blocked lanes remain BODIK facility data (Issue #118), licensed exact smoking Points
from Tokyo wards, Shibuya ArcGIS layers and MLIT indoor archive access/geometry/terms evidence.
Resume blocked hosts only after publisher access is legitimately restored; keep their recorded stops
until then. Improve portal-specific pagination and facility/category targeting for truncated groups,
then inspect additional new raw releases. Operator homepages/floor maps alone do not supply reusable
smoking coordinates. Maintain the same individual approval gate before any adapter work.
