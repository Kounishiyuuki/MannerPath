# Data pipeline

Responsibilities:

- fetch approved municipal/open datasets;
- ingest approved OpenStreetMap extracts/queries;
- normalize source records into canonical staging records;
- preserve provenance/license metadata;
- generate deterministic upserts for D1;
- produce validation reports before publishing.

An importer must have fixtures and tests before being scheduled.

## Reviewed multi-source first releases

Four municipal adapters now enter the same ingest → observation → resolution → tile/detail path:
Taito, Osaka City's designated smoking locations, Koto's station-front locations and Musashino's licensed KML public smoking sites.
Source review, licensing and exact attribution
are in `docs/SOURCES.md`; immutable fixture evidence is under `fixtures/`.

Against the **local** API D1 database, after migrations:

```sh
cd services/api
npm run local:migrate
npm run local:pipeline
npm run local:pipeline -- osaka-designated-smoking-areas
npm run local:pipeline -- koto-station-smoking-areas
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
