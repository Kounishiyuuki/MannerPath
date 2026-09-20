# AGENTS.md — MannerPath engineering contract

Authoritative, always-on contract for AI coding agents in this repository.
Only rules that every task needs live here. Area rules live in nested `AGENTS.md`;
reusable workflows live in `docs/AGENT_WORKFLOWS.md` and the repository skills.

| Scope | File |
| --- | --- |
| Apple app (`apps/apple/**`) | `apps/apple/AGENTS.md` |
| Backend & data pipeline (`services/**`) | `services/AGENTS.md` |
| Task workflows and validation | `docs/AGENT_WORKFLOWS.md` |

## Before changing code

1. Read `docs/PRODUCT_REQUIREMENTS.md`.
2. Read `docs/ARCHITECTURE.md`.
3. Read `docs/TECH_STACK.md`.
4. Read every ADR related to the files being changed.
5. If a requested change conflicts with these documents, do not silently work around them. Update the relevant ADR/requirement in the same change or surface the conflict. Never change an accepted architectural decision without updating or adding an ADR.

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

## Privacy rules

- Never add location history collection by default.
- Client location authorization rules are in `apps/apple/AGENTS.md`.

## Quality gates

For meaningful changes:

- add/update tests for the behavior being changed;
- update documentation when contracts change;
- do not bypass data provenance, privacy, offline, or App Store compliance requirements;
- do not commit credentials, Apple private keys, Cloudflare tokens, `.env`, generated secrets, or production datasets with restricted licenses.

## Scope discipline

Implement the smallest complete vertical slice that satisfies the requirement. Do not opportunistically rewrite unrelated architecture.
