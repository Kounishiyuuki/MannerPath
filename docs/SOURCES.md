# Source Registry

Every data source must be registered here before its data is published (`DATA_POLICY.md`, ADR-0006).

Rules:

- Do not fill in license details from memory or assumption. Copy them from the source's own published terms and link to them.
- Any field not yet reviewed is written `unreviewed`. A source with any `unreviewed` license field is not published.
- OSM-derived data is not published until ODbL obligations are reviewed (`DATA_POLICY.md`).

## Template

| Field | Value |
|---|---|
| Source ID | |
| Name | |
| Kind | municipal / operator / osm / userReport |
| Dataset URL | |
| License name | unreviewed |
| License URL | unreviewed |
| Required attribution text | unreviewed |
| Redistribution to clients allowed | unreviewed |
| Modification/derivation allowed | unreviewed |
| Share-alike obligations | unreviewed |
| Observation date available | per-record / dataset-level / none |
| Reviewed by / date | |
| Publication status | blocked / approved |

## Registered sources

### OpenStreetMap

| Field | Value |
|---|---|
| Source ID | `osm` |
| Kind | osm |
| License name | ODbL (obligations for MannerPath's combined dataset: unreviewed) |
| Redistribution to clients allowed | unreviewed |
| Share-alike obligations | unreviewed |
| Publication status | blocked |
