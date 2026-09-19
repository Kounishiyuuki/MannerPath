# MannerPath

**MannerPath** is an iOS + Apple Watch navigation app for finding nearby permitted smoking locations and confirmed ashtrays, including designated smoking areas, smoking rooms, and convenience-store exterior ashtrays.

The product goal is not to promote smoking. It is to help adult users quickly locate places where smoking is permitted and reduce smoking in prohibited or inappropriate locations.

## Product principles

1. **Fast first:** the nearest usable place should be reachable from iPhone or Apple Watch in as few interactions as possible.
2. **Usable, not merely nearby:** ranking considers availability, tobacco type, access restrictions, freshness and confidence, not only straight-line distance.
3. **Offline graceful degradation:** cached spot data, distance and bearing must work without network access. Full pedestrian routing may require network access in v1.
4. **Source transparency:** every spot must retain source, license/attribution, last verification and confidence metadata.
5. **Privacy by default:** precise location stays on-device for spot ranking whenever possible. Backend requests use coarse tile identifiers rather than raw location where practical.
6. **Compliance first:** no tobacco sales, tobacco advertising, gamification, or copy that encourages consumption.

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
- Open municipal data + OpenStreetMap + user verification

See [`docs/TECH_STACK.md`](docs/TECH_STACK.md) and [`docs/PRODUCT_REQUIREMENTS.md`](docs/PRODUCT_REQUIREMENTS.md).

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

**Foundation / v0.0.x** — architecture and product contracts are being fixed before feature implementation.
