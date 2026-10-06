# MannerPath

**MannerPath** is an iPhone + Apple Watch navigation app for finding evidenced, permitted smoking locations and confirmed ashtrays. A convenience store's existence alone is never evidence of a smoking location; its smoking area or ashtray must be independently confirmed. Native iPad support is planned for v1.x or later.

The product goal is not to promote smoking. It is to help adult users quickly locate places where smoking is permitted and reduce smoking in prohibited or inappropriate locations.

## Product principles

1. **Fast first:** the nearest usable place should be reachable from iPhone or Apple Watch in as few interactions as possible.
2. **Usable, not merely nearby:** ranking considers availability, tobacco type, access restrictions, freshness and confidence, not only straight-line distance.
3. **Offline graceful degradation:** cached spot data, distance and bearing must work without network access. Full pedestrian routing may require network access in v1.
4. **Evidence required:** a host facility or third-party map result is not proof that smoking is permitted. MapKit supports presentation, destination search and routing, not canonical spot provenance.
5. **Unknown is not false:** unknown opening hours or tobacco support remain unknown. Evidence confidence and location precision are separate axes; approximate locations are visibly approximate.
6. **Source/license transparency:** every spot retains provenance, license/attribution, freshness and confidence metadata.
7. **Privacy by default:** precise location stays on-device for ranking; raw precise GPS is not sent to the MannerPath backend. Retrieval uses tile IDs computed on-device, including destination-area tiles, not destination search terms or exact destination coordinates. Tile requests still convey area information; see the [privacy policy](https://kounishiyuuki.github.io/MannerPath/privacy/).
8. **Compliance first:** no tobacco sales, tobacco advertising, gamification, or copy that encourages consumption.

## Stack

- Swift 6 / SwiftUI
- iOS 18+ / watchOS 11+
- Core Location
- MapKit
- GRDB (iPhone local database)
- Codable snapshot cache (watchOS)
- WatchConnectivity
- WidgetKit + App Intents
- URLSession + Codable
- Cloudflare Workers + TypeScript + Hono
- Cloudflare D1
- Reviewed official/open municipal data

Reports, photo evidence and community publication are inactive in v1; future community
paths require legal and maintainer approval. OSM is not adopted in the v1 production corpus.

See [`docs/SPECIFICATION.md`](docs/SPECIFICATION.md) (invariants and document map), [`docs/TECH_STACK.md`](docs/TECH_STACK.md) and [`docs/PRODUCT_REQUIREMENTS.md`](docs/PRODUCT_REQUIREMENTS.md).

## Repository layout

```text
apps/apple/               iOS/watchOS application sources
services/api/             public backend API
services/data-pipeline/   importers and normalization jobs
docs/                     product, architecture and decision records
scripts/                  local development helpers
AGENTS.md                  mandatory rules for AI coding agents
```

## Current phase

**v1 release candidate / App Store submission readiness** — the production backend is live at
`https://mannerpath-api-production.happywestyuki.workers.dev`, with iPhone and Apple Watch
release candidates. Production API configuration, App Icon integration for both hosts
(including unsigned archive inclusion), and archive preflight hardening are complete.
Developer Program enrollment, signed archive, TestFlight and physical-device verification
remain incomplete; this is not an App Store submission approval.

See the [release checklist](docs/RELEASE_CHECKLIST.md),
[Apple distribution readiness](docs/APPLE_DISTRIBUTION_READINESS.md) and
[App Store submission guide](docs/APP_STORE_SUBMISSION.md) for remaining gates.

## Current production coverage

513 published spots from 6 approved official municipal sources; community-published
spots: 0. This is not nationwide coverage. Coverage expansion continues through
reviewed sources; see the [production content rights audit](docs/PRODUCTION_CONTENT_RIGHTS_AUDIT.md).

## Next development direction

- Apple UI/UX refinement and API hardening/evolution.
- Official smoking-location source expansion toward nationwide coverage.
- Future reports/community features only after legal and maintainer approval.
