# Bounded live high-value source refresh

Date: 2026-10-06. Base main: `02ad59c5d332ef6b082b54219d5970b8968432b8`
(#205 merged). Scope: five municipal targets, official publisher discovery only.

## Decision: research-only STOP at 5 / 5

No target demonstrated **all** of exact reusable rights, attribution, publisher
smoking-point coordinates, current operation evidence and maintainable raw data.
No `IMPLEMENTATION_CANDIDATE` is declared; no adapter/source is added or approved.
This is a bounded search result, **not** proof that no implementable source exists
nationwide. `BLOCKED` below means the implementation gate is unmet, not that the
missing information is false or that the publisher has refused permission.

Production remains **513 published spots / 6 approved sources / community 0** per
existing release evidence; this task made no production query or mutation.
Registry, fixtures, release metadata, API, Apple code, schema and discovery approval
records are untouched. No geocoding, park-centroid substitution, external map
coordinate extraction, OSM or community ingestion occurred.

## Selection boundary

Used the existing high-value items/reviews under
`docs/research/nationwide-discovery/2026-10-01-high-value-{blockers,reviews}.json`.
The #205 cache-only result (552 advisory rows, all P3; no P0/P1) is unchanged.
This follow-up explicitly permits bounded live discovery beyond that cache result.

Selected `city-shizuoka`, `city-nagoya`, `city-hiroshima`, `ward-bunkyo`,
`ward-meguro`: each had historical explicit municipal smoking-place inventory,
without a confirmed access-blocked URL being the sole lead. These are discovery
target IDs, **not approved source IDs**.

The units reviewed are new/current discovery routes, not reapproval of rejected
raw releases: Nagoya's 2026 map, Hiroshima's current dataset-category index,
Bunkyo's policy/inventory index, Meguro's new designated-place page, and Shizuoka's
updated inventory/link index. Existing inventory HTML was read as navigation and
current publication evidence only. Shizuoka's previously rejected usage-count CSV
was not downloaded again. No exact rejected raw dataset was retried. No sixth target
was inspected. Fuchu, Urayasu, Ebina, Narashino, Tsu, duplicate Osaka, Suginami's
prohibition data, external JT-only resources, OSM and community were excluded.

## Gate matrix

| Target | Smoking evidence / current publication | Exact raw and publisher coordinates | Applicable rights / attribution | Decision |
| --- | --- | --- | --- | --- |
| Shizuoka | Official inventory explicitly identifies three public smoking places; page updated 2026-08-14 | HTML/photos and external Google map links; no new licensed numeric Point resource found in that index | Website policy requires permission beyond statutory exceptions; separate open-data rights cannot be inherited by this page. Commercial redistribution and approved attribution unresolved | RIGHTS_AND_COORDINATES_BLOCKED |
| Nagoya | Official subsidy page lists 28 installed assisted facilities plus three city-managed places | New 2026 downloadable map is expressly described as an image-only PDF; HTML addresses are not numeric smoking-point coordinates | No exact reusable license established for this inventory/PDF. Ordinary website exceptions do not establish a public normalized dataset redistribution grant | RIGHTS_AND_COORDINATES_BLOCKED |
| Hiroshima | Current official inventory states six smoking booths, with addresses/photos | New dataset-category route does not identify smoking-point raw data; general parks/facilities cannot supply a booth's exact Point | Resource-specific rights are required; the category page directs users to individual resource metadata, not a blanket grant for ordinary inventory HTML | RIGHTS_AND_COORDINATES_BLOCKED |
| Bunkyo | Current municipal policy index explicitly lists two designated places and links to assisted-place information | Addresses and external Google map links; no publisher numeric Point/raw inventory located in this bounded route | No exact commercial redistribution license or approved attribution identified for the selected page; site policy/footer is not an open-data license | RIGHTS_AND_COORDINATES_BLOCKED |
| Meguro | Direct official page updated 2026-10-06 lists designated places/hours after the October rule change | HTML inventory plus Google map; no licensed publisher numeric Point/raw file identified | Exact resource reuse/redistribution and attribution remain unconfirmed; website copyright protection is not an open-data grant | RIGHTS_AND_COORDINATES_BLOCKED |

Current publication is not a physical inspection of every site's current operation.
Nagoya's counts describe installed facilities, not a fresh per-site operating audit;
Bunkyo's count covers only the designated subsection, not all assisted places.
Hours and tobacco support must remain unknown unless individually evidenced.

## Official evidence and maintainability

### Shizuoka

- [Current inventory/link index](https://www.city.shizuoka.lg.jp/s9623/s000042.html): station smoking places are explicitly named, not inferred from station existence.
- [Website copyright policy](https://www.city.shizuoka.lg.jp/s009072.html): permission is required outside stated statutory exceptions.
- Maintainability: named HTML sections are trackable but not a coordinate schema. Prior usage-count CSV remains rejected for coordinate inadequacy; its separate rights do not license this HTML.

### Nagoya

- [Subsidy inventory and 2026 map landing page](https://www.city.nagoya.jp/kenkofukushi/kenkoinfo/1009410/1009429/1009433.html).
- [Exact new PDF](https://www.city.nagoya.jp/_res/projects/default_project/_page_/001/009/433/2026map.pdf): accessible, one page; publisher describes it as image-only. No coordinates were derived from its artwork. No claim of a complete visual rights audit of that PDF is made.
- [Reuse policy](https://www.city.nagoya.jp/about/1017973.html): explicitly marked reusable data and limited internal/private-use exceptions are distinguished. Neither attribution alone nor general viewing permission approves normalized public redistribution.
- Maintainability: HTML installation table can be followed, but annually versioned image maps are not a stable numeric Point feed. Convenience-store entries here have explicit smoking-facility evidence; store presence alone remains insufficient.

### Hiroshima

- [Dataset index](https://www.city.hiroshima.lg.jp/shisei/gyosei/1021856/1006054/1027541/index.html) → [environment category](https://www.city.hiroshima.lg.jp/shisei/gyosei/1021856/1006054/1027541/1018976.html): listed resources cover waste/environment facilities; this bounded category check did not locate smoking-point data. It does not prove absence across every city dataset.
- [Smoking-booth inventory](https://www.city.hiroshima.lg.jp/living/gomi-kankyo/1021281/1037470/1024206.html): six booths, address/photo/diagram evidence; page dated 2025-02-16 and still publicly available.
- Maintainability: inventory is trackable, but park coordinates would describe hosts, not the booths. Individual resource licensing must be verified before reuse.

### Bunkyo

- [Current policy/inventory index](https://www.city.bunkyo.lg.jp/b037/p005115/index.html): designated-place subsection provides municipal evidence and external map links; those maps were not ingested.
- [Site policy](https://www.city.bunkyo.lg.jp/b003/p006007/index.html): no exact reusable license established for this inventory.
- Maintainability: HTML/address navigation only in the checked route. Download permission for educational posters does not license the smoking inventory. Old blocked raw resources were not retried.

### Meguro

- [New designated inventory](https://www.city.meguro.tokyo.jp/kankyouhozen/kurashi/kankyou/rojyokitsuentaisaku5.html): direct HTTPS GET succeeded and showed `更新日：2026年10月6日`; smoking-place addresses/hours are explicit.
- [Copyright policy](https://www.city.meguro.tokyo.jp/kouhou/kusei/kouhou/chosakuken.html).
- A search/browser CDN copy showed the older September 9 revision. The direct municipal-host response, not that cached copy, is the current-page evidence. No claim that the CDN proves October operation is made.
- Maintainability: official HTML can be monitored, but Google map links are not an independently licensed publisher raw coordinate release. The page's separate CLUBJT reference was excluded; this target was selected for its own official inventory, not that reference.

## Follow-up boundary and validation

Reopen only on **new** exact licensed publisher coordinate evidence, not repeated
requests to the same blocked raw resource. Any implementation candidate still needs
human source review, fixtures/tests and existing publication gates. No issue is
closed by this record; no legal approval is asserted.

Validation for this docs-only change: `make api-validate`, `make contract`,
`git diff --check`. Fresh pipeline/quality is not applicable: no source was added.
