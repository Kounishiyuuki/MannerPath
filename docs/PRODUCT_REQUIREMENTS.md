# Product Requirements — MannerPath

Status: **Product completion baseline v2 — nationwide**

## 1. Product statement

MannerPath helps adult users find a nearby place where smoking is permitted, with emphasis on speed, current usability and reliable navigation. Valid locations include official/designated smoking areas, facility smoking rooms and independently confirmed ashtray locations such as convenience-store exterior ashtrays.

The product is positioned as a compliance/navigation utility, not a tobacco-consumption product.

## 2. Primary jobs to be done

### J1 — Find somewhere usable now

> I am outside and need to quickly find the nearest location where smoking is permitted under my conditions.

Success: the user can reach a valid top result with minimal interaction from iPhone or Apple Watch.

### J2 — Find somewhere along my route

> I am walking to a destination and want a permitted smoking location that requires little detour.

Success: online route mode ranks by incremental detour, not only radius distance.

### J3 — Search with constraints

Users can filter by known attributes such as:

- paper cigarette support;
- heated-tobacco support;
- spot type;
- public access vs customer/facility-only access;
- indoor/outdoor/covered;
- open now, only when opening-hours data is known;
- maximum distance / maximum detour;
- verified recently / confidence threshold.

Unknown values remain unknown and are not silently treated as allowed.

## 3. Supported spot types

- `designatedOutdoorArea`
- `publicSmokingRoom`
- `facilitySmokingRoom`
- `ashtray`
- `smokingPermittedVenue` (post-v1 unless data quality is adequate)
- `unknown` — the source does not state the physical type (for example the Taito ward list); never guessed from a name (ADR-0006, Issue #12 amendment)

Spot type describes the physical location only. Whether it is confirmed is a separate verification/evidence axis (ADR-0006).

Host context is separate from spot type:

- `municipality`
- `station`
- `commercialBuilding`
- `convenienceStore`
- `restaurantOrCafe`
- `other`

A convenience store becomes a result only when the ashtray/smoking permission is confirmed from an approved source or verification workflow. A host never creates a published spot by itself (publication gate, ADR-0006).

Tobacco support and similar attributes are tri-state: `yes | no | unknown`. Access type includes `unknown`.

## 4. iPhone v1 requirements

### Must

- request current location using Core Location;
- display nearby spots on a MapKit map;
- display a ranked nearby list;
- show distance and data confidence/freshness;
- filters for spot type and tobacco type;
- spot detail with access notes, hours when known, source attribution and last verification;
- online pedestrian route preview to selected spot;
- open system Maps navigation as fallback/hand-off;
- local caching of spot data;
- offline nearest search using cached data;
- submit “exists / missing / changed” reports;
- no account required to browse/search.

### Should

- destination search and route-detour ranking;
- favorites/recent spots stored locally;
- cached region management;
- explicit offline state UI.

### Not v1

- full offline pedestrian routing engine;
- social feed;
- tobacco product/brand information;
- purchases;
- background continuous location tracking;
- ads from tobacco/nicotine companies.

## 5. Apple Watch v1 requirements

### Must

- open directly to nearby usable spots;
- show top 3 results with distance and spot type;
- show freshness/confidence indicator;
- quick filters based on saved iPhone preferences;
- start navigation/handoff with as few taps as practical;
- use cached spot snapshot when network/iPhone is unavailable;
- offline distance + bearing to selected spot.

### Should

- complication/widget entry point via WidgetKit/App Intents;
- haptic feedback for high-level navigation state where technically appropriate;
- independent current-location lookup.

### Not v1

- Watch as a full map-browsing replacement for iPhone;
- custom offline turn-by-turn routing.

## 6. Ranking contract

Ranking must first remove hard-invalid results, then score remaining candidates.

Hard filters may include:

- explicitly unsupported tobacco type;
- explicitly closed at the current time;
- inaccessible spot type under the selected access preference;
- lifecycle `removed` or `temporarilyClosed`.

Staleness is not a status. It is freshness computed on device from `lastVerifiedAt` and affects score and display; a user may choose a "verified recently" filter. `unknown` values are never hard-filtered as incompatible unless the user explicitly requires `yes`.

Base score inputs:

1. walking ETA/detour when an online route is available;
2. otherwise straight-line distance;
3. evidence quality (stable, from the server);
4. verification freshness (computed on device from `lastVerifiedAt`);
5. access convenience;
6. user preferences.

Distance must never override an explicit incompatibility.

Ranking and confidence algorithms are versioned (ADR-0006).

## 7. Offline behavior

v1 guarantees **offline spot discovery**, not full offline routing.

With cached data and a usable device location, users can see:

- nearby spots;
- straight-line distance;
- bearing;
- spot metadata cached previously;
- last-known verification information.

The app must visibly distinguish route unavailable from spot unavailable.

## 8. Privacy

- default location permission: `When In Use`;
- precise location is requested because short-distance spot discovery requires it;
- backend should receive tile/cell IDs rather than raw precise coordinates for routine sync where possible;
- no server-side location history in v1;
- browse/search requires no account.

## 9. Release/compliance constraints

- Japanese users must receive an age/eligibility notice appropriate to local tobacco law before normal use.
- Product copy should use “喫煙可能場所”, “指定喫煙所”, “灰皿設置場所”, “案内” and similar neutral terms.
- Avoid celebratory language such as rewards, streaks, “一服しよう”, or consumption encouragement.
- App Review notes must clearly describe the compliance/navigation purpose and absence of tobacco sales/promotion.

## 10. Geography and nationwide completion requirement

A bounded, reviewable geography may be used during development and source onboarding, but **MannerPath is not product-complete while its real-data coverage is limited to one municipality or one launch region**.

The product-completion target is practical nationwide discovery in Japan:

- the client and backend search/sync path must function anywhere in Japan;
- published spots must come only from approved evidence; lack of data never authorizes invention or host-based inference;
- all 47 prefectures must be represented by reviewed coverage before the nationwide release gate can pass;
- prefectural capitals, Tokyo 23 wards, ordinance-designated cities and major station areas must be covered to the quantitative gate defined in `NATIONWIDE_DATA_STRATEGY.md`;
- freshness, unresolved-conflict and evidence-quality gates apply nationwide, not only to the original Taito fixture;
- a location with no approved nearby spot must show an honest empty/coverage state rather than a fabricated result.

Nationwide rollout is a data-quality milestone, not an import-volume milestone. Development may proceed in stages (N1 → N2 → N3), but the app is not considered finished merely because a single-region beta works.

## 11. Product UI and Apple-platform quality requirement

The finished product must use a coherent, current Apple-platform UI across iPhone, Apple Watch and widgets.

Requirements:

- prefer standard SwiftUI navigation, toolbar, search, sheet, button, list, scroll and widget components;
- adopt the current system Liquid Glass appearance through standard controls where the SDK provides it;
- use custom glass effects only when a standard component cannot express the required control; decorative glass must not reduce map/data readability;
- preserve clear separation between content and navigation/control chrome;
- support light/dark appearance, Dynamic Type, VoiceOver, Reduce Motion and Reduce Transparency;
- keep Japanese copy readable at accessibility sizes and keep user-facing terminology neutral and compliance-oriented;
- Watch and Widget surfaces follow their platform interaction model rather than duplicating the iPhone layout.

Visual completion means the primary flows are coherent and usable in loaded, empty, error, offline, stale and approximate-location states, not merely that a Liquid Glass effect is present.

## 12. Product completion and release sequencing

The implementation order is intentional:

1. complete nationwide-capable data architecture and source onboarding;
2. reach the nationwide quality/coverage gate;
3. finish functional product behavior across iPhone, Watch and widgets;
4. finish the Apple-platform UI/accessibility pass;
5. only then perform the paid Apple Developer Program signing/provisioning gate, App Groups/App Attest device verification, physical-device E2E, TestFlight and App Store release work.

Apple Developer Program membership is therefore a **final release dependency**, not a prerequisite for continuing product/data/UI implementation. Capabilities or security requirements must never be removed merely to make a Personal Team build succeed.
