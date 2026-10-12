# Sendai 海岸公園（井土地区）: publication-gate review

Follow-up to the research candidate in #137 / #113, reviewed 2026-10-11. Applies only to the pinned source `sendai-kaigan-park-smoking-areas`, CSV row `000000001388`. This is repository source onboarding and local validation, not a production rollout or an onsite current-operation inspection.

| Gate | Evidence / implementation | Verdict |
| --- | --- | --- |
| Explicit smoking existence | [Municipal CSV](https://www.city.sendai.jp/joho-kikaku/shise/security/kokai/documents/041009_public_facility.csv) description explicitly names smoking amenity; exact row/name/description scope is pinned. Other facilities never qualify | PASS |
| Current operation | Same publisher row links [designated operator](https://bouken-asobiba-net.com/bouhiro/). Current homepage explicitly identifies smoking areas and has an October 8, 2026 notice; no closure/prohibition found in inspected homepage body. Observation remains dated/uncertain, not live field verification | PASS for primary-source current-operation review |
| Applicable original license | Exact CSV catalog result identifies CC BY 4.0 International; [city original license guidance](https://www.city.sendai.jp/joho-kikaku/shise/security/kokai/opendata.html) and [CC legal code](https://creativecommons.org/licenses/by/4.0/legalcode.ja) reviewed. Catalog/result fingerprints recorded in fixture rights review | PASS |
| Source approval | Scope/rights/attribution entered in `docs/SOURCES.md` and reviewed adapter registry under explicit user authorization. No discovery signal auto-approves a source | PASS for repository onboarding; production not executed |
| Immutable provenance | Full original CSV preserved unchanged; exact SHA-256, URL, bytes, HTTP metadata, header and row ID pinned. Changed release requires review. Baseline, publication, fetch and observation are separate; smoking `observedOn=null` | PASS |
| CC BY 4.0 attribution | City, dataset, raw source URL, CC license URL and extraction/normalization/approximate treatment emitted as source attribution. Source disclaimers retained in provenance. Linked operator content/images not redistributed | PASS |
| Anchor review | Same licensed row names park and states latitude/longitude. Reviewed area-column mapping; digest/row-bound anchor re-read and verified before resolution. No geocoding, map-image coordinates or external POI value | PASS as representative park anchor; accuracy/datum semantics undeclared |
| Approximate location | `anchoredObservation` and existing ADR-0017 database authority enforce `areaApproximate` plus named park `locationArea`. No smoking exact point or separate two-place pins are invented | PASS |
| Smoking hours / uncertainty | Park calendar/hours do not enter observation hours; `openingHours=none`, open-now unknown, tobacco/environment/access unknown. Operator park hours not imported. Fetch date not verification date | PASS |
| Parser / fixture / tests | Strict UTF-8/header/width/count, exactly one reviewed target, first-release fingerprint, partial scope, no automatic refresh or cross-release approval. Tests cover invalid scope, missing anchor and local precision/attribution serialization | Validation results recorded by task final report |

No unresolved primary-evidence blocker remains for this limited approximate onboarding. Exact smoking-point coordinates and smoking hours remain unknown intentionally; the accepted policies permit honest approximate location and unknown hours. New information contradicting existence/permission requires the existing conservative conflict/hold workflow, not continued publication by assumption.

The advisory generic candidate evaluator still blocks an unimplemented `areaApproximate` packet. The concrete reviewed adapter is inspected separately; this change does not convert a caller-supplied approximate flag into approval. Local integration records the reviewed anchor after ingest and before resolve.

This review covers only the exact pinned Sendai onboarding; no other municipality or resource is approved here. Production remains the existing corpus. Production rollout requires separate authorization.

## Final validation

Node 24 `make api-validate`: TypeScript PASS, API 980 tests PASS, discovery 101 tests PASS. Dedicated Sendai tests (6) verify exact-release scope, immutable bytes, unknown hours, missing-anchor/blocked-source refusal, and approximate detail/tile output. The seven-source local promotion v4 test retains the Sendai area anchor and mapping and re-exports deterministically. The explicit six-source production-health and historical campaign artifact tests remain unchanged in their baseline counts/content. `make contract`, metadata JSON/SHA checks and `git diff --check` PASS. Independent review found no remaining P0/P1/P2 after the production-health inventory regression was corrected.
