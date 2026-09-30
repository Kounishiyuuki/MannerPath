# Data pipeline

Responsibilities:

- fetch approved municipal/open datasets;
- ingest approved OpenStreetMap extracts/queries;
- normalize source records into canonical staging records;
- preserve provenance/license metadata;
- generate deterministic upserts for D1;
- produce validation reports before publishing.

An importer must have fixtures and tests before being scheduled.

## Nationwide source discovery (local only)

`discovery/manifest.json` tracks prefectures, prefectural capitals, designated cities,
Tokyo wards and official operators. Roles overlap: a capital that is also a designated
city is one target. `discovery/generate-manifest.py` deterministically imports historical
research and the six reviewed source identities; it makes no network calls or approvals.
The historical raw audit supplies hashes and attribute inventories without committing raw bytes.

From `services/api`, run:

```sh
npm run discover:sources
npm run test:discovery
```

Options include `--manifest`, `--state`, `--cache`, `--report`, `--limit`,
`--delay` (milliseconds), `--timeout` (milliseconds), `--retries` and `--reviews`.
`--revalidate` deliberately performs conditional requests, including previously inspected
resources; use it only when a new release is worth reviewing. `--rescan --cache-only`
rebuilds reports after parser changes without network access. JSON and sibling Markdown
reports include coverage and explicit truncation. Persisted host stops remain in force;
restarting the command does not probe a blocked host again.

Catalog connectors cover CKAN, ArcGIS REST, static dataset pages and CSV/JSON indexes.
Inspectors cover CSV/TSV (UTF-8 and CP932), JSON/GeoJSON, a bounded KML subset,
KMZ, SHP ZIP attributes/PRJ, GPKG attributes/CRS metadata, XLS/XLSX workbooks (sheets,
headers after title rows, rows, coordinate columns) and plain ZIPs of those tabular members.
Text decoding is BOM → declared charset → strict UTF-8 → strict CP932; undecodable bytes stay
blocked rather than guessed. Static pages yield links by file extension or by a format label
(`[CSV]`, `XLSX`) and follow ordinary `rel=next`/「次へ」 pagination on the same host.
Workbooks above 10 MB / 2M cells and downloads above `maxBytes` are `payloadTooLarge`. Standalone SHP without
its attribute sidecars is unsupported. GIS binary geometry is not decoded, and schemas,
ZIP expansion, rows and downloads have bounds. Unsupported or malformed payloads remain
blocked. ArcGIS transfer limits and catalog/resource caps are explicit partial scans.
Public-address checks reduce accidental private-network requests; DNS validation and
fetch resolve separately, so this remains a local tool for curated manifests rather
than an unrestricted crawler of arbitrary user-supplied URLs.

Discovery is independent of adapters, D1 and publication. Candidate output requires an
individual publisher/terms/coordinate/current-operation review in `docs/SOURCES.md` before
onboarding. A smoking keyword in a mixed facility description cannot establish that its
Point identifies the smoking place. Unknown category codes are inventories for review,
not inferred smoking categories. HTML/PDF/image/map information does not supply coordinates.

Raw cache and resumable state stay local under `discovery/.local/`; only compact scan
metadata/reports belong in the repository. Approved releases alone follow immutable fixture
policy. Scan bounds, failed requests and prior inspections are reported separately: a bounded
scan finding no eligible resource does not establish that a jurisdiction has no smoking sites.
Reviewed coverage is derived solely from existing reviewed source IDs, never fetch success.

Human deep follow-up is recorded separately from discovery status. The east/north/national
batch's exact publisher/export evidence and unresolved approval gates are in
`docs/research/nationwide-discovery/2026-10-01-east-deep-reviews.json`. Manifest/checkpoint
`deepReview` fields point to those attestations; rescanning preserves them. Pending attempts
have no `deepReviewedAt` and do not count as completed reviews. The report selects the latest
valid timestamp per known target (last input wins ties), counts unique groups, and keeps
legacy keyword-resource reviews separate. Even a manual approved verdict cannot create
publication coverage or approve a registry entry.

From the repository root, rebuild a local report without any downloads:

```sh
node services/data-pipeline/discovery/report.mjs --reviews docs/research/nationwide-discovery/2026-10-01-east-deep-reviews.json --out services/data-pipeline/discovery/.local/east-deep-report.json
```

`--pass v2` is a resumable named rescan: an interrupted run skips targets already completed
in that pass, keeps prior blockers as `previousBlockerCodes`, and inspects identical bytes once
(`duplicateOf`). `--max-pages` / `--max-resources` bound each target. The v2 run (#136) is in
`docs/research/nationwide-discovery/2026-10-01-v2-run.json` with reviews in `2026-10-01-v2-reviews.json`.
The XLS/XLSX parser is SheetJS 0.20.3 (Apache-2.0, no dependencies), a pinned devDependency of
`services/api` from the official tarball; the npm-registry 0.18.5 has unfixed advisories.

`probe-endpoints.mjs` reports 404s and redirects for manifest catalog/home URLs without editing
the manifest. Only a reviewed change to a publisher-official URL repairs an entry.

The original #132 run remains historical evidence. Manifest regeneration is an initial
discovery bootstrap, not a way to replace later human review annotations.

Each host is serialized with a configurable delay, timeout and retry budget. HTTP 403 or
429 stops that host; other hosts continue. There is no proxy rotation, authentication bypass,
private endpoint guessing or block avoidance. Cache entries retain URL, SHA-256, ETag and
Last-Modified; conditional validation never substitutes for approval of a changed release.

## Reviewed multi-source first releases

Six municipal adapters now enter the same ingest → observation → resolution → tile/detail path:
Taito, Osaka City's designated smoking locations, Koto's station-front locations, Musashino's licensed KML public smoking sites, Minato's designated smoking points, and Kyoto City's public smoking places.
The shared observation boundary rejects non-finite or out-of-range coordinates before storing an
observation (latitude -90…90, longitude -180…180). Adapters retain any tighter source-specific bounds.
Source review, licensing and exact attribution
are in `docs/SOURCES.md`; immutable fixture evidence is under `fixtures/`.

Against the **local** API D1 database, after migrations:

```sh
cd services/api
npm run local:migrate
npm run local:pipeline
npm run local:pipeline -- osaka-designated-smoking-areas
npm run local:pipeline -- koto-station-smoking-areas
npm run local:pipeline -- musashino-public-smoking-areas
npm run local:pipeline -- minato-designated-smoking-areas
npm run local:pipeline -- kyoto-public-smoking-places
```

The no-argument command retains Taito behavior. The Osaka command retains all 524 mixed CSV rows
as raw evidence and normalizes only 344 explicitly designated smoking locations. Each source keeps
its own release, parser/mapping/resolver versions and identity; publication and detail attribution
are read through the existing registry gates. These commands do not enable automatic source refresh.
A changed Osaka file needs a fresh review; observation date remains unknown.

Koto adds 3 station-front locations from its licensed CP932 CSV; the sibling park CSV stays
blocked by the current park prohibition. The first release is pinned to hash/URL/NULL observation
date/count. Hours and tobacco support remain unknown. The adapter starts with partial coverage,
cross-release disabled and no refresh target. All 23 wards were surveyed before selection:
`docs/research/2026-09-29-tokyo-n1-source-survey.md` records rejected candidates and next priorities.

Musashino adds 3 station public smoking locations from the exact licensed ZIP/KMZ KML member,
retaining all 25 Placemarks as raw evidence. Run `npm run local:pipeline -- musashino-public-smoking-areas`
from `services/api`; no refresh is enabled. Its fixture PROVENANCE.md records resource-level CC BY 4.0,
WGS1984 point semantics and NULL observation dates.

The existing promotion-bundle.v3 exporter supports all approved sources in one fresh-database
bootstrap (migration 0018). It carries published canonical state, provenance, attribution and tile
membership; ADR-0008 excludes source_observations and withheld canonical spots. Fresh bootstrap is
publication reproduction, not an ingestion-workspace backup. No schema or ADR change is made here.

Minato's mixed facility CSV retains 169 raw records and derives 114 reviewed smoking points.
Its publisher trailer is verified separately, and the unchanged original file remains the release
fingerprint. One smoking point omitted from the current official aggregate list stays raw-only.
See `docs/research/2026-09-30-tokyo-n1-source-batch-2.md` and its fixture `PROVENANCE.md`.

Kyoto adds 17 city-run smoking places selected by the publisher's own 喫煙場所 category (cate_id 138)
from its CC BY 4.0 general facility list; all 1,777 facility rows stay raw evidence. The two 西大路 rows
conflict with the city's current smoking page and are withheld. The release is pinned to hash, URL,
the publisher's as-of date (2026-09-03) and count. There is no refresh target, because the portal
download is a POST form.

The promotion exporter supports `npm run local:export -- --bundle v3 --out <file>` for one
reviewed release per source into a fresh database, using migration 0018. v2 remains available.
Repeated-release validation, cross-source merges and broader field support remain separate work.
These commands never target a remote database.
