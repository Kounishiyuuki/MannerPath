# ADR-0001 — Use MapKit for v1 mapping and online routing

Status: Accepted

## Context

MannerPath is iOS/watchOS-first, needs maps, destination search and pedestrian routing, should minimize recurring API cost, and only requires offline spot discovery in v1.

## Decision

Use MapKit + Core Location for Apple clients.

Use MapKit for:

- map rendering;
- destination/place search in the active UI;
- online pedestrian directions;
- Apple Maps navigation handoff.

Do not use Apple Maps as the canonical source of smoking/ashtray records.

## Consequences

Positive:

- native SwiftUI integration;
- no extra map vendor SDK in v1;
- strong Apple-platform integration;
- less credential/billing surface.

Negative:

- no guaranteed full offline basemap/routing in v1;
- Apple map/search data usage is subject to Apple service terms;
- if advanced embedded navigation/custom maps become core, another map stack may need evaluation.

## Revisit when

- offline basemap is a release-blocking requirement;
- embedded turn-by-turn guidance must exceed Apple Maps handoff/MapKit capabilities;
- cross-platform Android/web becomes a committed product requirement.
