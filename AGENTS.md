# AGENTS.md — MannerPath engineering contract

This file is authoritative for AI coding agents working in this repository.

## Before changing code

1. Read `docs/PRODUCT_REQUIREMENTS.md`.
2. Read `docs/ARCHITECTURE.md`.
3. Read `docs/TECH_STACK.md`.
4. Read every ADR related to the files being changed.
5. If a requested change conflicts with these documents, do not silently work around them. Update the relevant ADR/requirement in the same change or surface the conflict.

## Non-negotiable product rules

- The app locates **permitted smoking locations / ashtrays**; it must not market or celebrate tobacco use.
- No tobacco sales, purchase links, brand promotion, consumption streaks, rewards, or gamification.
- A convenience store is a valid result **only when an ashtray/smoking location is independently confirmed**. Being a convenience store is not evidence that smoking is allowed.
- Never infer `openNow=true` when opening hours are unknown.
- Never infer tobacco type support when unknown.
- Never hide data freshness or confidence when the information is uncertain.

## Mapping and data rules

- **MapKit is presentation/search/routing infrastructure, not the canonical smoking-spot database.**
- Do not persist Apple Maps search/POI data into the canonical spot database except where Apple terms expressly permit temporary caching.
- Canonical spot data comes from approved sources defined in `docs/DATA_POLICY.md`.
- Preserve source provenance and license attribution for every imported spot.
- Do not call public Overpass endpoints from every client request. OSM ingestion is a backend/data-pipeline concern.

## Location/privacy rules

- Prefer `When In Use` location authorization.
- Do not add `Always` authorization without a new ADR and explicit product requirement.
- Keep precise current location on-device for nearby ranking whenever practical.
- Never add location history collection by default.

## Offline contract

When network access is unavailable, the app must still be able to:

- read cached nearby spots;
- calculate straight-line distance;
- calculate bearing/direction;
- show data freshness/confidence;
- hand off to any locally available system mapping behavior when possible.

Do not claim offline turn-by-turn routing in v1.

## Architecture rules

- Feature-first folders; avoid global `Views/`, `Models/`, `ViewModels/` dumping grounds.
- Domain types must not import SwiftUI.
- UI must not call URLSession or SQL directly.
- External services sit behind protocols where they materially improve testability.
- Prefer Swift Concurrency (`async/await`, actors) over new Combine pipelines.
- Use dependency injection through initializers/environment rather than singletons, except Apple framework coordinators where justified.
- API models and persistence models must be mapped through domain types instead of leaking across layers.

## Quality gates

For meaningful changes:

- add/update tests for domain behavior;
- preserve Swift 6 concurrency correctness;
- update documentation when contracts change;
- do not commit credentials, Apple private keys, Cloudflare tokens, `.env`, generated secrets, or production datasets with restricted licenses.

## Scope discipline

Implement the smallest complete vertical slice that satisfies the requirement. Do not opportunistically rewrite unrelated architecture.
