# Official reverse source review — 2026-10-01 JST

Issue [#140](https://github.com/Kounishiyuuki/MannerPath/issues/140), child of #67.
Codex; branch `tooling/osm-reference-source-leads`.

## Official review result

**146 substantive official-source group reviews completed; 44 pending from 190 attempted.
New approved sources / implemented sources / published spots = 0 / 0 / 0.**
The [individual official reviews](nationwide-discovery/2026-10-01-official-reverse-reviews.json)
contain 336 fresh retrieval receipts and publisher-review paraphrases. They contain only
independently inspected official information. No reference feature or selection-density
record is included. Source registry, immutable fixtures, adapters and canonical values
are unchanged.

| Official scope | Completed | Attempted | Meaning |
| --- | ---: | ---: | --- |
| Prefectures | 27 | 47 | Bounded smoking-policy/facility/catalog review |
| Cities | 46 | 52 | Includes capitals, designated cities and existing reviewed municipalities |
| Tokyo wards | 21 | 23 | Smoking inventory/policy review; Setagaya and Meguro remain pending |
| Additional municipal facility catalogs | 17 | 17 | General facility catalogs; not smoking inventories |
| Operators/facilities | 35 | 50 | Smoking inventories, bans, facility FAQs or historical policy |
| National indoor-map source | 0 | 1 | Eligible archive not acquired; remains pending |
| Total | 146 | 190 | Unique groups, not URL count |

Completed reviews include jurisdictions labelled in **all 47 prefectures**; this is
research coverage, not published spot coverage or a completed review of every prefectural
publisher. **52 groups** contain explicit official smoking-place information. That is
an information lead, not proof of current operation for every listed site, a Point
coordinate release, or publication approval. Five completed groups correspond to already
approved pinned sources; 141 completed groups remain blocked. Osaka's new review is pending;
its existing pinned approval is unchanged. The corpus still has six reviewed sources.

Homepages, access attempts, empty shells, map-link indexes and undecoded PDF-only material
are kept pending and excluded from the completed count. A catalog review can be completed
while smoking evidence remains unestablished. General facility categories/coordinates,
prohibition polygons, utilization statistics and budget plans are never converted into
smoking points. The 17 historical municipal catalogs are additional bounded official
reviews, not newly discovered smoking sources or high-value geometry candidates.

## High-value independent publisher findings

- JR北海道's current FAQ names ten stations with smoking rooms. JR西日本 lists conventional
  express/Sanyo/Hokuriku station exceptions, and JR九州 names four Shinkansen-area exceptions.
  Their HTML establishes a review lead; no reusable georeferenced room Point was established.
  Tokyo station's JRE media guide also includes third-party facilities, so it cannot approve
  every listed facility under JR rights. JR東海's candidate PDF returned 404 and stays pending.
- Haneda, Narita, New Chitose, Kansai, Fukuoka, Aomori and Sendai publish dedicated smoking
  guidance or terminal/floor inventories. Diagrams and floor locators do not establish numeric
  smoking-room coordinate semantics or compatible reuse rights. Fukuoka warns some rooms
  cannot be used. Sendai's separate notice closes the domestic check-in-side second-floor room
  on 2026-03-02; the generic inventory must not override that closure.
- Otsu lists three station-area pilot places; Fukui describes a relocated indoor station
  facility; Sakai lists ten designated places; Miyazaki's policy and relocation notices require
  changed-site review. Takamatsu distinguishes construction closures. The exact Point/license
  chain remains unresolved for each, so none is implemented.
- Nagasaki's municipal map page explicitly describes permission at manager-installed public
  ashtrays. That statement is stronger than ashtray existence alone, but exact data rights,
  Point semantics and current individual operation were not established. Kagoshima's unrelated
  manner-ashtray dataset remains ineligible without independent smoking permission.
- Current ward inventories distinguish suspended, abolished, newly opened and under-construction
  facilities. Minato/Koto/Taito fresh pages do not approve a new release; existing pinned
  source gates and cross-release holds remain. Musashino's fourth current facility is absent
  from its three-point pinned KML and receives no invented coordinate.
- Keisei, Keio, Tokyu, Odakyu, Keikyu, Nankai, Meitetsu, Hankyu, Hanshin and subway policy pages
  record bans or closed smoking rooms. A nearby station does not imply permission, and those
  policies are discovery exclusions, never automatic canonical attenuation inputs.

Original publisher ownership is not inferred from the portal domain: the inspected Ehime
resource3138 belongs to Kihoku Town, and Hyogo's map resource is population polygon data.
Neither becomes prefecture-wide smoking evidence. Niigata's FAQ question alone supplies no
existence claim. Pacifico PDF contents were not decoded. These limits remain explicit.

## Coordinate and reference boundaries

Rebased on Claude's PR #144 main `75016e96d6b5269c6ff8a405e443694e29e22c21`, retaining
migrations0022/0023 and ADR-0011/0012. **ADR-0011 publication policy is still Proposed**;
ADR-0012 explicitly does not approve it. Publisher smoking-place coordinates remain
required here. No ABR, address join, Google/MapKit coordinate, manual pin or derived
coordinate enters this batch.

Reference analysis uses a public national download outside the repository and ordinary
local filtering/grouping. No public Overpass query was made. The reusable CLI mode emits
only existing official-manifest target identities to an external, exclusively created
queue. Reference input, extract, grouping/priority counts and intermediate files are not
committed or publicly conveyed. They never enter scanner/state, source records, fixtures,
registry approvals, canonical identity, attenuation, promotion, tiles, API or cache.

Official acquisition reuses `FetchCache`: per-host concurrency1, 1-second delay, cache,
resumable receipts, retries0, bounded timeouts and persistent403/429 host stops. A fetched
page is not a license grant; missing fields stay unreviewed. No authentication bypass or
map-provider coordinate supplementation was used. Search results supplied discovery URLs;
only acquired publisher pages count as evidence.

## Validation and corpus

No new source qualifies, so new fixture/adapter/pipeline onboarding is inapplicable.
The full existing corpus was independently reproduced in fresh local SQLite with the real
D1 migrations; no remote D1 or production deployment was used.

| Check | Result |
| --- | --- |
| `make contract` | pass |
| `make api-validate` after rebase | 619 API +69 discovery tests pass, no failure/skip |
| `services/api: npx tsc -p .` | pass |
| Reference selection/path/CLI regressions | 6 pass; malformed/missing modes fail before network/state output |
| Actual CLI publication-safety regression | pass; tracked publication files and workspace changes unchanged |
| Six pinned source ingest/observe/resolve/publish | 515 canonical /513 published /81 tiles |
| Quality | 15/15 pass, including `osm-blocked` and latest confidence gate |
| Promotion v3 | verified content SHA `2652e3574ea235ef7019c54aed5c46a7723e0d915efc2aff0904124d7746bdaf` |
| Fresh migrated bootstrap/deterministic re-export | pass, byte-identical SQL |
| Cross-source generation | 0 candidates; no canonical mutation |
| No-reference leakage | no tracked raw extract; no fixture/registry/canonical/tile/promotion mutation; synthetic reference sentinels absent |

The new safety test initially read nonexistent `QualityCheck.passed`; it was corrected to
`status === 'pass'` and now awaits the promotion verifier. The test and full validation pass.
No production quality check was altered or bypassed.

## Highest-value unresolved official work

1. Exact reusable coordinate exports and scoped permissions for JR station smoking rooms
   and airport room inventories; indoor/floor/access semantics must remain explicit.
2. Otsu/Fukui/Sakai/Miyazaki/Takamatsu: publisher-supplied smoking Points and resource-specific
   redistribution/derivation rights, then per-record current/relocation/closure checks.
3. Chuo: explicit rights covering the map CSV, not neighboring licensed datasets, plus
   suspension/relocation review; no automatic adoption of the historical79-title inventory.
4. Setagaya/Meguro and PDF/access-pending operators: substantive inventory acquisition;
   retain host stops and do not count uninspected map-link/PDF pages as completed.
5. MLIT Shinjuku indoor archive: legitimate official acquisition, actual feature categories,
   archive notices and current smoking-place operation. Schema-only evidence does not approve it.

No new prefecture/city receives publication coverage. The outcome identifies official
permission/geometry requests; it does not relax any publication or rights gate.
