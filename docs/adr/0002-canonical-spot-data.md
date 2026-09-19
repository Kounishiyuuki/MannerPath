# ADR-0002 — Own the canonical smoking-spot dataset

Status: Accepted

## Decision

MannerPath maintains a canonical normalized spot database assembled from licensed public/official sources, OpenStreetMap and moderated user verification.

Map vendors are not treated as the smoking-spot source of truth.

## Rationale

The core product attribute — whether a location currently has a usable smoking area or confirmed ashtray under specific conditions — is not reliably provided by a general map API.

Owning normalization/provenance also enables offline sync, confidence scoring and source transparency.
