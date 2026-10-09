# Production source health monitoring extension — 2026-10-09

The original implementation was merged as PR #221 while this work was in progress. This extension is based on that current main and preserves its original CLI, checker, tests and research report. `source:health:monitor` reuses `productionHealthTargets` for approved adapters and resource URLs, adding offline mode and recurring resource/rights fingerprints. The existing daily read-only workflow compares this [separate monitor baseline](2026-10-09-production-source-health-monitor.json), exits nonzero for review findings and retains the original artifact policy. No new schedule, notification writer, production operation or target is introduced.

This read-only audit covers the six reviewed production source identities. It does not approve a new release, change publication status, deploy, or contact production D1. Independent bounded official HTTP evidence is recorded in [the evidence JSON](2026-10-09-production-source-health-evidence.json): request URL, final URL, HTTP status, media type, byte count and SHA-256. Raw response bodies remain outside the repository. Requests used a 15-second timeout, three-redirect ceiling, 2 MiB response ceiling and no retries. HTTP metadata and check dates are never substituted for observation dates.

| Source | Live classification | Availability and content | Freshness | Rights review |
| --- | --- | --- | --- | --- |
| Taito | HEALTHY; legacy URLs UNAVAILABLE, newer release found | Current reviewed CSV 200, 7,266 bytes, exact `5123ee41251bf22ebacfbcaee5d781c883ad8823f8861c4824a3deff012c6c74`; 12-column schema, 34 rows unchanged | Publisher explicitly labels 2026-08-18 as-of; current page updated 2026-09-11 | Same official page still scopes CC BY 4.0 to its downloads |
| Osaka | CONTENT_CHANGED independently; Node CLI TEMPORARILY_UNAVAILABLE | CSV 200, 245,184 bytes, `682674a162cdcd2632ebef906bd5ba00cc0879f5588c8a626cfc722aaa95104a`; 15-column header unchanged, 529 raw rows instead of 524; all 344 selected designated-smoking rows identical | Live Last-Modified 2026-10-08; observation date remains unknown | Original city page retains exact export link and CC BY link to 2.1 JP; no observed rights drift |
| Koto | HEALTHY | CSV 200, 314 bytes, exact `e36e81d58348db6607a374f18a77ae54801eb55b810fba2849cf49c14318126d`; CP932, four columns, three rows | Last-Modified 2026-01-15; observedOn unknown, no SLA | Official package API retains CC-BY-4.0 and exact station resource; Tokyo terms remain available |
| Kyoto | HEALTHY via documented download form | Resource GET is HTML, not CSV. Published form POST returns 200, 843,922 bytes, exact `bd37bbcbc413751f8ae5e3e5c88b397a452f953aad1b330c326cbaba137715cc`; 53 columns and 1,777 rows unchanged | Resource title still says 2026-09-03 as-of | Exact resource 21432 states city copyright and CC BY 4.0; third-version terms retain per-dataset applicability |
| Musashino | HEALTHY; older edition needs freshness follow-up | ZIP 200, 13,232 bytes, exact `3cc620efb082a2b6ee1f30b757dd35d26691924d427dc0c4812d654e009b3f5c`; nested doc.kml 28,067 bytes, exact `fc6986b986ec315691299a12583f14a8fd942e34075fd1e9e44837dc72c57a7c` | Still the 2022 edition; ZIP Last-Modified 2023-04-18, observedOn unknown | Exact 4(2) item still supplies ZIP and its scoped CC BY 4.0 statement |
| Minato | HEALTHY; historical BLOCKED access not reproduced | Original CSV 200, 96,869 bytes, exact `d11ad6a5c2c72bba114d58bc7cce9f84f54338c75ee37cdd275b7680c6314220`; 31-column schema unchanged; 169 facility rows plus verified publisher trailer | Resource Last-Modified 2026-07-16; trailer Ver20260714 is export metadata, observedOn unknown | Original package keeps CSV UUID/URL; original terms still permit CC BY 4.0; exception annex still lists only GTFS and baby stations |

## Current recurring check and manual rights review

The [recurring baseline comparison](2026-10-09-production-source-health-monitor-check.json) reports Taito, Koto and Musashino `healthy`, Osaka `temporarilyUnavailable`, and Kyoto and Minato `rightsReviewRequired`. Kyoto and Minato still return exact pinned payloads with passing schema/parser probes. Their alerts reflect changed whole-page rights fingerprints, not an established change in license or publication permission. The initial baseline table above describes the first inspection; this later comparison is the current automated result.

Manual follow-up retained the earlier bounded response bodies outside the repository and fetched the four changed original pages once more, with a 15-second timeout and 2 MiB ceiling. A full HTML comparison establishes these differences:

| Original publisher page | Observed difference from initial audit | Current full SHA-256 | Equality after removing only observed dynamic fields |
| --- | --- | --- | --- |
| Kyoto resource 21432 | Access and download counters | `e9fdd8b32d96d4f59d8a04ee8531bf98238cc391204f19ab3e92a28eab4f22ce` | Exact equality |
| Kyoto dataset 00003 | Access counters | `c887844343a42097b734b8455618df30c1b63c718b32ae48e69451fda5f8ec17` | Exact equality |
| Minato original about terms | Request-session HTML meta value | `269d61180e9d0ae1cccd48873574e7e93e7fc8f999ff47c6b4739252c667cc56` | Exact equality |
| Minato original exception annex | Request-session HTML meta value | `a8e8da59f1617c237a63221ecd5d5cbd4f6c2b184e966d31ad7034d54445bc70` | Exact equality |

These follow-up hashes differ again from the recurring report because the observed fields change between requests. [Compact evidence](2026-10-09-production-source-health-evidence.json) records initial/current hashes and normalized equality; raw HTML and session values are not committed. The normalization is solely a manual comparison aid, not a CLI filter or replacement baseline.

The exact Kyoto resource still states city copyright and CC BY 4.0, with the same resource identity/download form; its dataset license and third-version original terms remain applicable. Minato's full legal prose remains byte-identical, including copying/transmission/adaptation/commercial-use permission and compatibility with CC BY 4.0; its exception annex still excludes only GTFS and baby-station content. Therefore no material rights drift is observed between the retained audit and this follow-up. This is a scoped manual continuity finding, not a new rights grant. The automated `rightsReviewRequired` statuses remain recorded and the baseline fingerprints are preserved, without automatic reset or publication changes.

**P2:** Whole-page rights hashing on these dynamic publisher pages causes recurring review alerts even when legal text is unchanged. Explicitly reviewed scoped fingerprint design could reduce noise in a later change; until then retain the conservative alerts and require human comparison. This finding does not justify suppressing future legal changes.

## Taito old 404: successor investigation

Both official historical files [20230601](https://www.city.taito.lg.jp/kusei/online/opendata/seikatu/shisethutizujouhou.files/20230601_koshukitsuenjo.csv) and [20240627](https://www.city.taito.lg.jp/kusei/online/opendata/seikatu/shisethutizujouhou.files/20240627_koshukitsuenjo.csv) return HTTP 404. Their error responses are 1,058 bytes, SHA-256 `dbf12b751fabebc14987ee60fccc5b1675e7df10cb5a41f180ebe0874db8f056`. This proves only that these URLs are unavailable.

The same publisher's [official dataset page](https://www.city.taito.lg.jp/kusei/online/opendata/seikatu/shisethutizujouhou.html) directly links [20260818_koshukitsuenjo.csv](https://www.city.taito.lg.jp/kusei/online/opendata/seikatu/shisethutizujouhou.files/20260818_koshukitsuenjo.csv), explicitly labels the 2026-08-18 edition and continues the applicable CC BY 4.0 offer. That current URL is already the production adapter's pinned resource and returns identical reviewed bytes. Historical discovery artifacts containing an older URL remain historical evidence. No removal or rights-expiry conclusion is justified.

The newer dated release is a successor in the same dataset lineage, not proof that it is the same historical resource/corpus. Substituting it into a historical resource attribution would be unsafe. No production URL repair is necessary or made.

## Minato CSV 403: same-domain investigation

The [original CSV](https://opendata.city.minato.tokyo.jp/dataset/c02688a0-2e85-4637-aa36-edb37b3d010b/resource/02705cbf-d01a-4f32-98c1-05329a11d316/download/minatokushisetsujoho_fukugo.csv) returns 200 with exactly the reviewed bytes in this run. The [original official package API](https://opendata.city.minato.tokyo.jp/api/3/action/package_show?id=minatokushisetsujoho_fukugo) still names resource `02705cbf-d01a-4f32-98c1-05329a11d316` with the same download URL and its existing GeoJSON sibling. No replacement is needed. The [original terms](https://opendata.city.minato.tokyo.jp/about) and [exception annex](https://opendata.city.minato.tokyo.jp/pages/exhibit) return 200 and preserve the reviewed scope.

Earlier 403 evidence is compatible with environment-dependent access blocking; this successful run does not prove every runner can fetch the resource. A future 403 is `accessBlocked`, not `removed` or a license-revocation inference. Do not retry aggressively, bypass access controls, substitute the unapproved sibling, or rewrite publication metadata.

## Node 24 CLI transport observation

The [companion CLI live report](2026-10-09-production-source-health-monitor.json) records five healthy sources. Osaka is `temporarilyUnavailable` from the Node 24 runner because default secure TLS rejects the publisher connection with `ERR_SSL_DH_KEY_TOO_SMALL`. The independent bounded HTTP audit above successfully obtained the official bytes and establishes full-export content drift. These are separate observations: a transport failure prevents that runner from measuring content, while another transport's successful request does not erase Node's compatibility failure. No TLS security settings are weakened. Publisher-side TLS compatibility needs follow-up.

## Schema, parser and rights boundaries

A Node 24 offline probe on independently acquired live bytes invoked every production adapter's `parse`, `includesRecord` (where present) and `observe`: all passed. Raw/selected counts were Taito 34/34, Osaka 529/344, Koto 3/3, Kyoto 1,777/17, Minato 169/114 and Musashino 25/3. No release approval or resolver publication was invoked for changed Osaka bytes. The independent CSV probes compare full ordered headers against immutable fixtures and count complete records; Osaka's current header remains identical despite its changed full export. Musashino's nested KML hash also matches the reviewed parser input. Minato's adapter must continue validating its trailer; an ordinary CSV count of 171 after-header records must not be mistaken for 171 facility rows. Kyoto's `application/force-download` response is the publisher's documented POST download; an HTML resource-page success alone is not a successful parser probe.

Rights inspection is separate from content comparison. The above publisher statements preserve the expected scoped license evidence; cosmetic page hashes and check dates are not grants or revocations. Automated tooling reports unavailable, missing or changed rights evidence for human review and never parses license prose into publication approval. Observation dates remain unknown for Osaka, Koto, Musashino and Minato. Availability and identical bytes do not establish current on-site operation or completeness.

## New findings and action priorities

- **P0:** None established. No demonstrated privacy leak, production mutation, rights loss, or falsely newly approved release.
- **P1:** Osaka's full export differs from the approved pinned release. Review 529 raw rows and release provenance before any refresh. The smoking subset is unchanged, but identical selected rows cannot automatically approve changed full raw evidence. Production remains pinned to the reviewed 524-row release.
- **P2:** Taito historical catalog references point at unavailable 2023/2024 files. Current production is healthy; maintained advisory references need explicit successor context rather than resource-identity rewriting.
- **P2:** Osaka's publisher TLS is incompatible with default Node 24 security (`ERR_SSL_DH_KEY_TOO_SMALL`). The recurring CLI must report the access failure; fix publisher TLS or review an official equivalent transport without disabling TLS checks.
- **P2:** Minato's historical 403 and current 200 show that access evidence is runner-specific. Continuous checks must preserve status/URL/evidence and classify blocking independently of rights.
- **P2:** Musashino remains a 2022 edition with unknown exact observation dates and known partial coverage. Review a newer separately licensed release if supplied; age does not establish closure or removal.
- **P2:** Four sources lack an exact observation date and all six lack a publisher availability SLA. Monitor byte/schema/parser/rights evidence without inventing freshness guarantees.

## Metadata repair and invariance

No safe URL fix is justified: all six production resource identities remain reachable through their reviewed transport, and Taito's new dated file is already pinned. No production source, adapter, fixture, publicationStatus, observation or tile data is modified by this research. Any later URL-only repair must prove same publisher, same resource, continued rights and identical corpus before comparing source count, spot IDs, published spots and tile output. The Node 24 offline `source-health-invariance.test.ts` passed: before/after source count is 6, canonical spot count is 515, published spot count is 513, exact spot IDs match, and generated tile bytes match. This verifies the read-only health run leaves the pinned fixture-backed corpus unchanged. It is not a production D1 inspection.

## Repeatable check

The companion health CLI is maintainer tooling with no D1 or deployment access. Keep live requests out of unit tests; fixtures exercise statuses, byte/type limits, redirect/timeout failures, schema/parser/content drift and deterministic output. A live report is a time-specific advisory artifact, never a replacement release. The CLI live report is linked above. Its `checkedAt` identifies the start of this audit batch; the Osaka-only diagnostic rerun preserves the default TLS failure as a stable error code.

Initial isolated implementation validation used Node 24.21.0 (`PATH=/opt/homebrew/opt/node@24/bin:$PATH`), before integrating the already-merged #221 baseline:

- `make api-validate`: PASS, typecheck plus 933 API tests and 101 discovery tests.
- `node --experimental-strip-types --experimental-sqlite --no-warnings --test test/source-health*.test.ts` from `services/api`: PASS, final 24 offline tests, including CLI and stable TLS diagnostics added while the full suite was running.
- `make contract`: PASS.
- `git diff --check` and `git diff --cached --check`: PASS.

The existing full suite's Wrangler checks target disposable **local** D1 only. No production D1 inspection/write, deploy or publication-status change occurred.

Final integration validation on main `69e85b1` (which includes PR #221), under Node 24.21.0:

- `make api-validate`: PASS, typecheck plus 958 API tests and 101 discovery tests.
- `node --experimental-strip-types --experimental-sqlite --no-warnings --test test/source-health*.test.ts` from `services/api`: PASS, 47 legacy/monitor/CLI/corpus tests, all offline.
- `make contract`, `git diff --check`: PASS; the staged diff was checked before commit.
- The scheduled monitor command was run separately with `--live --baseline=../../docs/research/2026-10-09-production-source-health-monitor.json --fail-on-review`: exit 1 as intended for Osaka TLS and Kyoto/Minato page-fingerprint review alerts. See the separate monitor-check JSON and manual rights comparison above; the baseline was not overwritten.
- Independent integration review found no remaining code P0/P1/P2 findings. Existing CLI, source registry, publication decisions and original research artifacts remain intact.
