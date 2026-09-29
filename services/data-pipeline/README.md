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

Two municipal adapters now enter the same ingest → observation → resolution → tile/detail path:
Taito and Osaka City's designated smoking locations. Source review, licensing and exact attribution
are in `docs/SOURCES.md`; immutable fixture evidence is under `fixtures/`.

Against the **local** API D1 database, after migrations:

```sh
cd services/api
npm run local:migrate
npm run local:pipeline
npm run local:pipeline -- osaka-designated-smoking-areas
```

The no-argument command retains Taito behavior. The Osaka command retains all 524 mixed CSV rows
as raw evidence and normalizes only 344 explicitly designated smoking locations. Each source keeps
its own release, parser/mapping/resolver versions and identity; publication and detail attribution
are read through the existing registry gates. Neither command enables automatic source refresh.
A changed Osaka file needs a fresh review; observation date remains unknown.

The existing promotion exporter supports a single release's fresh-database bootstrap, not a
multi-source production rollout. Multi-source promotion, repeated releases, overlap matching and
broader field support remain separate work. These commands never target a remote database.
