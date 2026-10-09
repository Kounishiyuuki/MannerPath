# Production source health — 2026-10-09

Base: `origin/main`, `d13e6b9f10f47b44abf86e430b74610e46060ca1` (after #218/#219).
Scope: the six approved municipal adapters. Blocked community/OSM and generic POIs are excluded.
Main advanced during the task to `a37fdcfa5358814c5485efcc7f334dd8cfb5aa4e` (Apple UI #216);
`git diff` confirms no changes to services/api, source fixtures or source/rights contracts from the requested base.
The branch retains the requested base and its source corpus remains the current main baseline.
Checks ran on 2026-10-09 JST; HTTP evidence timestamps use UTC (2026-10-08 evening).

## Outcome

| Municipality / publisher | Source ID | Audit status | Resource HTTP | Live raw / selected rows | Reviewed raw / selected rows | Action |
| --- | --- | --- | --- | --- | --- | --- |
| 台東区 / Taito | `taito-public-smoking-areas` | HEALTHY | 200 | 34 / 34 | 34 / 34 | Current CSV byte-identical; no repair |
| 大阪市 / Osaka | `osaka-designated-smoking-areas` | CONTENT_CHANGED | 200 with ordinary Python HTTPS; Node 24 TLS failure | 529 / 344 | 524 / 344 | Separate release review; no import |
| 江東区 / Koto | `koto-station-smoking-areas` | HEALTHY (resource); ACCESS_BLOCKED (catalog HTML) | CSV 200, catalog 403 | 3 / 3 | 3 / 3 | Keep station-only scope; no bypass |
| 京都市 / Kyoto | `kyoto-public-smoking-places` | HEALTHY | 200, public POST download | 1,777 / 17 | 1,777 / 17 | Same dated release; no repair |
| 武蔵野市 / Musashino | `musashino-public-smoking-areas` | HEALTHY | 200 ZIP | 25 / 3 | 25 / 3 | ZIP and extracted KML unchanged |
| 港区 / Minato | `minato-designated-smoking-areas` | HEALTHY | 200 | 169 / 114 | 169 / 114 | Prior access failure not reproduced |

All six live payloads pass their current adapter's parser, exact header and in-scope observation/coordinate probes.
No moved current resource, schema drift or source-removal evidence was found. Accessible rights notices show no
material change; Koto's live exact catalog notice remains inaccessible and is explicitly not re-approved here.
There is no URL metadata fix, fixture replacement, registry edit, new source, imported live release or production mutation.

## Inventory and official evidence

The [machine-readable audit](2026-10-09-production-source-health.json) records every source's publisher,
canonical landing page, exact resource URL, license/original-terms URLs, byte-identical approved attribution,
expected format and complete ordered header (including duplicate/empty columns), coordinate authority,
reviewed hash and raw/selected counts, review/evidence dates, update cadence, adapter versions and fixture/PROVENANCE
paths. Each HTTP response includes checkedAt, method context, status, redirect chain, final URL, MIME,
ETag, Last-Modified, Content-Length, downloaded bytes and SHA-256. Missing headers are null rather than guessed.
No response bodies, facility records, contact information or unrelated raw data are committed.

| Municipality | Canonical landing page | Exact resource | Original rights evidence |
| --- | --- | --- | --- |
| Taito | [施設地図情報](https://www.city.taito.lg.jp/kusei/online/opendata/seikatu/shisethutizujouhou.html) | [20260818_koshukitsuenjo.csv](https://www.city.taito.lg.jp/kusei/online/opendata/seikatu/shisethutizujouhou.files/20260818_koshukitsuenjo.csv) | Exact landing page explicitly [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/legalcode.ja) |
| Osaka | [マップナビ open data, item 14](https://www.city.osaka.lg.jp/toshikeikaku/page/0000250227.html) | [opendata_1012.csv](https://www.mapnavi.city.osaka.lg.jp/osakacity/osakacity/opendatafile/map_1/CSV/opendata_1012.csv) | Item's license image still links [CC BY 2.1 JP](https://creativecommons.org/licenses/by/2.1/jp/); do not substitute general-site 4.0 |
| Koto | [Tokyo dataset](https://catalog.data.metro.tokyo.lg.jp/dataset/t131083d0000000061) | [Station CSV](https://www.opendata.metro.tokyo.lg.jp/koto/131083_237_public_smoking_area_station.csv) | [Ward delegation](https://www.city.koto.lg.jp/012107/koto_opendata.html), [Tokyo terms](https://portal.data.metro.tokyo.lg.jp/terms/); prior exact package evidence in PROVENANCE |
| Kyoto | [Dataset 00003](https://data.city.kyoto.lg.jp/dataset/00003/) | [Resource 21432](https://data.city.kyoto.lg.jp/resource/?id=21432), POST | Dataset and exact resource still CC BY 4.0 / 京都市; [third-edition terms](https://data.city.kyoto.lg.jp/contents.php?category=0) |
| Musashino | [Annual indicators, exact item 4(2)](https://www.city.musashino.lg.jp/shiseijoho/tokeishiryo/chiikiseikatsu_kankyoshihyo/1040384/1040390.html) | [toilet.zip](https://www.city.musashino.lg.jp/_res/common/opendata_kikaku/toilet.zip) | Same item retains scoped CC BY 4.0 notice |
| Minato | [Facility dataset](https://opendata.city.minato.tokyo.jp/dataset/minatokushisetsujoho_fukugo) | [Exact CSV](https://opendata.city.minato.tokyo.jp/dataset/c02688a0-2e85-4637-aa36-edb37b3d010b/resource/02705cbf-d01a-4f32-98c1-05329a11d316/download/minatokushisetsujoho_fukugo.csv) | [Same-host terms](https://opendata.city.minato.tokyo.jp/about), [exception annex](https://opendata.city.minato.tokyo.jp/pages/exhibit) |

### Taito historical 404

The [previous bounded provider audit](2026-10-08-open-provider-batch-2.md) reported historical Taito URLs returning
404. Those catalog references are old releases, not the production adapter's pinned August 2026 release.
The current landing page links that exact current CSV, and both return 200 without redirects. Downloaded
7,266 bytes have SHA-256 `5123ee41251bf22ebacfbcaee5d781c883ad8823f8861c4824a3deff012c6c74`, identical to main.
No moved-source search is warranted for a working current resource. This does not restore old releases or verify
that existing relocation/temporary-closure attenuations have ended; those remain unchanged.

### Minato historical 403

The previous audit's CSV 403 is not reproduced: the same approved CSV URL returns 200, no redirect,
96,869 bytes, hash `d11ad6a5c2c72bba114d58bc7cce9f84f54338c75ee37cdd275b7680c6314220`.
The named dataset page, original terms and exception annex also return 200. No proxy, cookies, credentials,
403 bypass, JSON substitution or alternate mirror was used. Availability is time/environment-specific;
a past 403 did not establish resource deletion, license expiration or closure of any smoking location.

### Osaka content and transport change

Resource SHA-256 changed from `f58b62791396bc46ceca436a7c4ad598520a5c9dd4162b37723ef519399e69ce`
to `682674a162cdcd2632ebef906bd5ba00cc0879f5588c8a626cfc722aaa95104a`; bytes 242,493 → 245,184.
The 15-column ordered schema, including both `分類` columns, is unchanged; raw rows 524 → 529.
All 344 selected smoking rows are byte-value identical to the reviewed selected rows, and their normalized
observations are identical (set comparison of SHA-256 over row arrays/observations: zero added/removed).
The new raw rows are outside approved scope. A changed source release still needs independent review;
the pinned corpus is not replaced even when its selected subset appears unchanged.

Standard Node 24 fetch fails before an HTTP response with `ERR_SSL_DH_KEY_TOO_SMALL`. Ordinary Python HTTPS
retrieved the above 200 response; the committed CLI conservatively reports `unavailable` with the TLS cause
code. These are two distinct facts, preserved together in JSON: the source content changed and the standard
monitoring transport cannot negotiate its current TLS. No security level, certificate check or cipher policy
was weakened. Publisher TLS remediation is needed before the Node monitor can validate bytes live.

### Koto catalog restriction

The approved station CSV is unchanged and accessible. The catalog HTML returns 403, as in its original review.
We did not probe another path on the blocked catalog host. Accessible ward delegation and Tokyo original terms
still support the historical review, but do not prove the inaccessible current resource-specific notice unchanged.
That notice requires later authorized human review; no new rights grant is inferred. The excluded park resource
is not fetched, imported or promoted. A landing-page 403 never changes the station source's publication status.

## Freshness and reproducibility

HTTP Last-Modified/ETag, portal dates and successful fetch times describe files, not smoking-operation observation.
Taito's reviewed dataset as-of date is 2026-08-18; Kyoto's is 2026-09-03. Osaka, Koto, Musashino and Minato have
unknown exact observation dates. This audit advances none of their `lastVerifiedAt` values.
Musashino's unchanged 令和4年 indicator edition / 2023 Last-Modified is a freshness concern despite healthy retrieval.
Annual publication wording is not an update SLA. Stable hashes do not prove present operation or completeness.

The repository's immutable fixtures remain reproducible for every adapter. Musashino separates the downloaded
ZIP hash (`3cc620efb082a2b6ee1f30b757dd35d26691924d427dc0c4812d654e009b3f5c`) from the extracted KML hash
(`fc6986b986ec315691299a12583f14a8fd942e34075fd1e9e44837dc72c57a7c`). Kyoto uses the ordinary published form
POST fields `upload_file=20260903182354_data（令和8年9月3日現在）.csv` and `download=このデータをダウンロード`;
GET at that same URL yields HTML and is not a CSV download.

## Read-only monitoring design

`services/api/src/source-health/check.ts` separates injected HTTP transport from advisory classification.
`services/api/scripts/source-health.ts` defines only the six approved official targets using current adapter URLs
and reviewed fixtures. It never calls ingest, resolve, refresh storage, registry writes, D1, R2 or publication.
The existing refresh/check orchestrator was deliberately not reused because it persists evidence to D1/R2.

Bounds: 20-second end-to-end request/body deadline, five redirects, 5,000,000 downloaded bytes, up to 100 archive
members and 5,000,000 expanded bytes per extracted member. Downloads stream with declared-length and actual-length
checks. ZIP/KMZ extraction is in memory with CRC32, local-header consistency and expansion validation.
No retries, crawling or moved-source search occurs in the CLI. Same-origin redirects are recorded as advisory
`moved`; cross-origin/non-HTTPS destinations are not fetched and require rights review. Missing reviewed license
metadata fails closed before fetching. Wrong/missing MIME is `unknown`, not a parse of an HTML error page.

Status vocabulary: `healthy`, `moved`, `unavailable`, `accessBlocked`, `schemaChanged`, `contentChanged`,
`rightsReviewRequired`, `unknown`. 401/403 are accessBlocked; 404 and transport errors are unavailable with notes.
Neither means SOURCE_REMOVED or confirmed TEMPORARILY_UNAVAILABLE. Actual deletion would need independent official
removal evidence and human review, and is not auto-classified. Archive/parser/in-scope coordinate failures fail the
schema probe. `assertResolvable` is not called: the immutable publication fingerprint gate is separate from whether
new data remains readable. All live results are metadata only, deterministically ordered with no implicit timestamp.

The CLI checks availability, payload changes and schema; it does **not** automatically interpret or monitor legal
notices, verify operation or discover a newer sibling resource. Rights drift, publisher identity and resource meaning
need human review. A move or content change never becomes a registry repair or a publication decision.

From the repository root, under Node 24:

```sh
npm --prefix services/api run source:health -- --live
npm --prefix services/api run source:health -- --live --source=taito-public-smoking-areas
# Machine-readable stdout without npm's command banner:
node --experimental-strip-types --no-warnings services/api/scripts/source-health.ts --live > /tmp/source-health.json
```

Exit 0: every requested source healthy. Exit 1: advisory anomaly (JSON still emitted). Exit 2: CLI/configuration error.
The current Osaka TLS issue intentionally causes exit 1. Never reset a baseline automatically to clear an alert.

`.github/workflows/source-health.yml` runs this explicit live command daily at 06:20 JST (GitHub scheduling may delay
execution) and via workflow_dispatch. It runs separately from offline tests, has contents-read permission only,
10-minute job timeout, and preserves metadata JSON artifacts for 30 days even on failure. There are no secrets,
Cloudflare bindings, deployments, issue/comment writes or automatic source edits. GitHub's failed-workflow status
provides the alert; maintainers must enable their preferred workflow notifications and triage artifacts.
The schedule begins only after this Draft PR is reviewed/merged to main; it was not activated remotely in this task.

## Corpus regression

No count was preselected. The main snapshot was extracted using `git archive origin/main` into an external temporary
directory. Before and after replay used the same Node 24 version, fresh in-memory `SqliteD1`, all real migrations,
`test/support/reviewed-fixtures.ts` / `importAllReviewedSources`, deterministic source-prefixed spot IDs and the frozen
`test/support/fixture.ts` NOW, followed by `publishTiles`. The complete sorted snapshots were compared by SHA-256.

| Derived measure | Main before | Branch after |
| --- | --- | --- |
| Approved sources | 6 | 6 |
| Immutable raw rows | 2,532 | 2,532 |
| Candidates / source observations | 515 | 515 |
| Canonical spots | 515 | 515 |
| Published spots | 513 | 513 |
| Tiles / parts | 81 / 81 | 81 / 81 |

Source IDs, spot IDs, every canonical spot, tile manifests, part bodies and assembled v1 tile bodies are identical.
The JSON artifact retains both count snapshots and their full comparison digests. The focused corpus test additionally
runs all six 403/404 classifications and a changed Taito payload against a populated isolated corpus, then compares
**every database table**, registry objects, manifests/parts and assembled bodies to prove advisory checks cannot mutate it.
This is a repository corpus replay, not an inspection or mutation of deployed production.

## Validation and remaining review

Node 24.21.0 final checks:

- `PATH=/opt/homebrew/opt/node@24/bin:$PATH make api-validate`: PASS; TypeScript src compile, 934 API tests and 101 discovery tests.
- `make contract`: PASS.
- New source-health + corpus focused tests: 23/23 PASS.
- Existing municipal/source/adapter focused tests: 46/46 PASS; pipeline/registry/refresh tests: 41/41 PASS.
- Explicit CLI + module TypeScript compile: PASS using an external temporary tsconfig extending the API config and Node 24 declarations (`@types/node@24.10.0`); no repository dependencies changed. The normal tsconfig covers src only.
- Workflow YAML parsing: PASS. The remote schedule was not run or activated from this branch.
- Live CLI: exit 1 as designed for Osaka TLS failure; all other resource probes healthy. Normal HTTPS audit and cached-byte parser probe establish Osaka CONTENT_CHANGED separately.
- Omitting `--live`: exit 2 usage error, no stdout/no network.
- Repository diff whitespace checks: PASS; the exact `git diff --check origin/main...HEAD` is also checked after commit.
- Independent code and security review: no remaining code P0/P1/P2 findings; upstream/review limitations below remain. Focused tests cover 200, redirects, 403/404, timeout,
stream/declared-size overflow, wrong MIME, schema drift, changed content, missing rights, safe transport error codes,
all six fixture probes, nested stored/deflated archives, CRC corruption, duplicate members and expansion limits.
Unit/CI tests inject local responses and perform no live HTTP.

- P0: none found.
- P1: none found.
- P2: Osaka changed full release requires review and its weak-DH TLS needs publisher remediation; Koto current exact
  catalog rights notice remains inaccessible; Musashino's old edition and four sources' unknown observation dates
  need periodic evidence review. These are explicit follow-ups, not approvals or automatic data updates.
- Source/rights/publication contracts and accepted ADRs are unchanged. No remote D1, production mutation, deploy,
  new source or store/POI inference occurred.
