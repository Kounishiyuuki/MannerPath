# ADR-0010 — OpenStreetMap / ODbL production architecture

Status: Accepted (2026-09, Issue #110, tracker #67). Decision only; nothing is implemented and no
OSM data is imported or published. Answers `docs/NATIONWIDE_DATA_STRATEGY.md` §4 and closes
ADR-0008 decision 11 as an open question by replacing "blocked pending an ADR" with the concrete
outcome below. Amends `docs/DATA_POLICY.md` and `docs/SOURCES.md`; replaces no earlier ADR.

**Outcome: `legal review required before adoption`.** In the meantime OSM is **reference-only**
(architecture C, restricted as in decision 3). If adopted later, the only acceptable production
architecture is **B, an isolated OSM-derived database** (decision 4). Architecture A (OSM rows in the
canonical database) is **rejected**. The nationwide release gate is planned without OSM (D is the
planning baseline). `osm` stays `blocked` in `docs/SOURCES.md`.

This ADR is an engineering decision, not legal advice. Where the licence text does not settle a
question, it says **未確定** and does not guess.

## Primary sources reviewed (2026-09-30)

| Source | URL | Used for |
| --- | --- | --- |
| Open Database License 1.0 (full text) | https://opendatacommons.org/licenses/odbl/1-0/ | Definitions of Database, Derivative Database, Collective Database, Produced Work, Convey, Publicly; §4.2 notices, §4.3 Produced Work notice, §4.4 share-alike, §4.6 access to Derivative Databases, §4.7 technological measures |
| OSM copyright and licence page | https://www.openstreetmap.org/copyright | "credit OpenStreetMap and its contributors"; "If you alter or build upon our data, you may distribute the result only under the same licence"; link to the copyright page |
| OSMF Attribution Guidelines (board-adopted 2021-06-25) | https://osmfoundation.org/wiki/Licence/Attribution_Guidelines | Wording "OpenStreetMap", link to /copyright, placement for interactive maps / mobile / small screens, collapse after 5 s or interaction with (i) still reachable, databases credit in readme/metadata |
| OSMF Collective Database Guideline (endorsed 2016-06-17) | https://osmfoundation.org/wiki/Licence/Community_Guidelines/Collective_Database_Guideline_Guideline | "all OSM or all non-OSM" per data type per regional cut; negative example: complementing a proprietary restaurant list with OSM and removing duplicates is *not* covered, and the proprietary data "may be subject to the ODbL share-alike terms"; guideline, not the only lawful reading |
| OSMF Substantial Guideline (endorsed 2014-06-06) | https://osmfoundation.org/wiki/Licence/Community_Guidelines/Substantial_-_Guideline | < 100 features is insubstantial; repeated small extractions count as one |
| OSMF Produced Work Guideline (endorsed 2014-06-06) | https://osmfoundation.org/wiki/Licence/Community_Guidelines/Produced_Work_-_Guideline | Images/rasters usually Produced Works; output from which the data can be extracted is a database; vector tiles and APIs left as grey area |
| OSMF Geocoding Guideline (endorsed 2017-08-24) | https://osmfoundation.org/wiki/Licence/Community_Guidelines/Geocoding_-_Guideline | Individual results insubstantial; systematic collection becomes a Derivative Database |
| OSM wiki `Tag:amenity=smoking_area` | https://wiki.openstreetmap.org/wiki/Tag:amenity=smoking_area | "a designated smoking area", status *in use*, nodes/areas, implies `smoking=dedicated` |
| OSM wiki `Key:smoking` | https://wiki.openstreetmap.org/wiki/Key:smoking | `no/yes/outside/separated/isolated/dedicated` describe the policy **of the tagged venue**, not a place to smoke |
| Taginfo (global) | https://taginfo.openstreetmap.org/api/4/tag/stats?key=amenity&value=smoking_area | 6,386 objects worldwide (data until 2026-09-29) |
| Taginfo (global) | https://taginfo.openstreetmap.org/api/4/key/values?key=smoking | `smoking=no` 151,662; `outside` 81,869; `yes` 18,508; `separated` 9,570; `isolated` 7,827 |
| Geofabrik Taginfo, Japan extract | https://taginfo.geofabrik.de/asia:japan/api/4/tag/stats?key=amenity&value=smoking_area | 1,027 objects in Japan (910 nodes, 115 ways, 2 relations; data until 2026-09-28) |

Limits of this review: the pages were fetched through a summarising web tool, so the ODbL clauses
above are cited by section rather than quoted verbatim. Before any adoption, the legal review in
decision 1 must work from the licence text itself. No third-party commentary was relied on.

## ODbL reading — established vs 未確定

Established from the licence text and OSMF guidelines:

1. A **Derivative Database** includes any adaptation, arrangement, modification or alteration of
   the Database or of a Substantial part of its contents. Publicly Using one requires it to be
   offered under ODbL (§4.4) and requires offering the whole Derivative Database, or a file of the
   alterations, in machine-readable form (§4.6).
2. A **Collective Database** is OSM *in unmodified form* collected with independent databases; the
   share-alike does not reach the independent databases.
3. A **Produced Work** may be licensed freely but needs a §4.3 notice that the contents come from
   OSM under ODbL, and publishing one still triggers §4.6 for any Derivative Database used.
4. §4.7: technical measures may not restrict ODbL rights unless an unrestricted copy is also
   offered.
5. OSMF community guidance treats **deduplicating/merging** third-party POIs with OSM for the same
   feature type in the same region as outside the Collective Database safe harbour.
6. Japan's OSM has ~1,027 `amenity=smoking_area` objects. Extracting them nationwide is
   **Substantial** under the OSMF guideline (well above 100 features).
7. Internal, non-public use does not trigger §4.4/§4.6 (they attach to Publicly Using/Conveying).

未確定 (not settled by the text; requires qualified legal review, not engineering judgement):

- Whether MannerPath's **vector tiles and JSON API** (which let a client reconstruct the records)
  are Produced Works or Conveyed Derivative Databases. OSMF leaves this as a grey area; this ADR
  therefore **assumes the stricter reading: they are databases** (§4.2/§4.4/§4.6 apply).
- Whether a canonical row that carries **both** municipal CC BY values and OSM values makes the
  whole canonical database (including municipal-only rows) a Derivative Database.
- Whether **OSM-driven attenuation** (an OSM fact weakening an official claim) makes the canonical
  field an adaptation of OSM.
- Whether a cross-source **identity link** (OSM id ↔ spot id) inside MannerPath's database removes
  Collective Database status. The guideline permits keys; whether that holds when the link is used
  to suppress duplicates in a single result list is not settled.
- Compatibility of ODbL share-alike with the CC BY 2.1 JP / CC BY 4.0 municipal terms when both
  apply to one row (CC BY §2(a)(5)/§3 "no additional restrictions" vs an ODbL-licensed combined
  output).
- Japanese database-right / copyright position on a points-of-interest list.

## Architectures compared

| Concern | A. OSM in canonical DB | B. Isolated OSM-derived DB | C. Reference-only | D. No OSM |
| --- | --- | --- | --- | --- |
| Licence | Canonical DB becomes a Derivative Database: share-alike likely reaches municipal rows (merge negative example); CC BY/ODbL mix 未確定 | Separate ODbL Derivative Database; municipal DB kept independent (Collective); only if keys-only identity holds (未確定) | No OSM content published; only internal use | None |
| Attribution | Every surface, every spot | Every surface that shows an OSM-derived spot | None required (nothing published) | None |
| API | Whole API is ODbL output | Separate `osm` layer/endpoints labelled ODbL | Unchanged | Unchanged |
| Tile / cache | Every tile ODbL | Separate OSM tiles, or OSM section in tile with own `sources` entry; strict reading treats them as databases | Unchanged | Unchanged |
| Offline cache | Cached tiles carry ODbL | Cached OSM tiles keep OSM attribution | Unchanged | Unchanged |
| Watch / widgets | ODbL credit everywhere | Credit where an OSM spot is shown | Unchanged | Unchanged |
| Promotion / export | §4.6 offer for the whole DB | §4.6 offer for OSM-derived DB only; separate bundle | Unchanged; OSM never enters bundle | Unchanged |
| Provenance | Mixed in `spot_field_provenance` | Separate tables/store; own release/fingerprint | Reference log only, outside canonical tables | — |
| Merge | Direct merge (the risky case) | Candidate/reference link only; no row merge | Not applicable | — |
| Refresh | Diff/replication into canonical | Own replication cadence, own deletion semantics | Periodic manual review | — |
| Operational cost | Highest (legal + unmerge impossible) | High (second pipeline, second tile layer, §4.6 dump) | Low | Lowest |
| Coverage benefit | ~1,027 JP objects, unknown quality/freshness | Same | Indirect (finding sources/conflicts) | Relies on municipal/operator |
| Verdict | **Reject** | **Only candidate for adoption, after legal review** | **Allowed now** | **Planning baseline** |

A is rejected because it cannot be undone: once municipal and OSM values share a row, the licence
of every published row becomes 未確定, and the promotion/tile outputs cannot be separated later.

## Decisions

### 1. Adoption requires legal review

No OSM-derived value is published until a qualified legal review answers the 未確定 list above
for architecture B specifically. The review result is recorded as an amendment to this ADR; only
that amendment may change `osm` in `docs/SOURCES.md` from `blocked`. Engineering may not infer the
answer from this ADR's comparison.

### 2. Architecture A is rejected for the current architecture

OSM values never enter `spots`, `spot_field_provenance`, `spot_source_entities`,
`spot_field_attenuations` or the promotion bundles. The schema CHECK refusing an approved
`kind = 'osm'` source (0001) stays.

### 3. Reference-only use (C) is allowed now, with limits

Permitted: a maintainer or agent may consult OSM (wiki, map, Taginfo, a local extract) to
- discover municipal/operator sources worth reviewing;
- find locations whose official claim deserves a manual re-check;
- estimate coverage gaps.

Limits:
- No OSM value, coordinate, name, id or hours is stored in any production table, R2 object, tile,
  API response, promotion bundle, fixture used by a published source, or client cache.
- OSM is **never an attenuation input**. An official claim is weakened only by independently
  reviewed evidence (an official page, operator notice, moderated report) under ADR-0006; OSM can
  only prompt a human to look for that evidence.
- Local analysis extracts stay out of git (they are ODbL data) and are not publicly conveyed.

### 4. If adopted: architecture B, fully isolated

Constraints that any future implementation must meet (these answer §4's structure questions):

- **Storage:** separate tables or a separate D1 database for OSM-derived observations/spots; no
  foreign key from canonical tables into it. Own release/fingerprint lineage (Geofabrik/planet
  extract hash + replication sequence).
- **Identity (question 13):** OSM-derived spots get their own opaque ids, never canonical `spot_id`s;
  the OSM element (`type/id`) plus version is the provenance key, not the identity. A cross-source
  identity is at most a reviewed **candidate/reference** record kept in the OSM side, never a
  canonical merge (question 7).
- **Clients merge for display only:** the app may show both layers in one list; when a municipal
  spot and an OSM spot are near-duplicates, the client may de-emphasise one using the reference, but
  the server never produces a merged row. Whether even this is safe is part of decision 1.
- **No source priority (question 15):** neither layer overrides the other. On disagreement the
  official claim is not changed by OSM (decision 3), and the OSM spot is held from publication or
  shown with attenuated fields (question 16) until reviewed.
- **Promotion/export (questions 8, 9):** the OSM layer is never inside `promotion-bundle.v2/v3`. It
  has its own bundle, and whenever it is Publicly Used an ODbL copy of the OSM-derived database (or
  a diff file against the OSM release) is offered free online, with the ODbL URI (§4.2, §4.6).
  Tiles/API are treated as databases (strict reading) and carry the ODbL notice.
- **Raw retention (question 10):** raw extracts retained content-addressed (as ADR-0008
  amendment 2) for as long as any derived row is published, so the §4.6 offer can be reconstructed.
- **Update (questions 11, 12):** refresh from a reviewed replication source (never public
  Overpass per client request). An OSM element deleted or re-tagged away from qualifying evidence is
  unpublished at the next release; OSM is incomplete, so absence in OSM never removes a municipal
  spot.
- **Existence evidence (question 14):** only `amenity=smoking_area`, or an area/node tagged
  `smoking=dedicated` as a smoking place, counts. `smoking=yes/outside/separated/isolated` on a shop,
  restaurant or convenience store describes the venue's policy and is **not** existence evidence.
  `amenity=waste_basket` + `waste=cigarettes` (an ashtray/bin) is not permission to smoke. A
  convenience store is never evidence. Unknown hours/type stay unknown.

### 5. Attribution surfaces (questions 1–5, 17)

Required if B is adopted (none while C/D):

| Surface | Requirement |
| --- | --- |
| iPhone map | "© OpenStreetMap" (linked to https://www.openstreetmap.org/copyright) in a map corner or adjacent whenever an OSM-derived spot is on screen; may collapse after 5 s/interaction with an (i) that stays reachable |
| iPhone detail / list | Existing per-source `attributionText` path (`NearbyAttributionView`, `SpotDetailView`) shows the OSM entry for OSM-derived spots |
| Watch | Existing per-source attribution in the Watch detail (`ContentView`) carries the OSM entry; legibility per the guideline's small-screen rule |
| Widgets | A widget showing an OSM-derived spot shows the short credit or the app gives a reachable credit on tap; exact layout 未確定 until a widget with OSM data is designed |
| API / tiles | `sources[]` entry for `osm` with ODbL licence URL and attribution, plus a notice in API docs; the ODbL offer URL (§4.6) |
| Offline cache | Cached tiles keep their `sources[]`, so attribution works offline (already true for tiles) |
| App Store build | About/licences screen (`AboutPrivacyView`) lists OpenStreetMap, ODbL and the §4.6 offer location |

## Consequences

- `docs/SOURCES.md`: `osm` fields now cite this ADR; status stays `blocked`.
- ADR-0008 decision 11 is answered: no OSM adapter until decision 1's amendment.
- The nationwide release gate (strategy §6) must be met by municipal/operator/community evidence.
  OSM's ~1,027 Japanese smoking areas would not by themselves meet it even if adopted.

## Next actions

1. Maintainer decides whether to commission a legal review of architecture B (要確認).
2. If yes: brief the reviewer with the 未確定 list above; record the result as an amendment.
3. Only after an approving amendment: design B's storage, tile layer, §4.6 offer and attribution
   UI as separate issues under #67.
4. Meanwhile: reference-only use may guide the N1/N2 municipal source survey.
