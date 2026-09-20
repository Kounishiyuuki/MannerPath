# AGENTS.md — Apple app (`apps/apple/**`)

Area contract. The root `AGENTS.md` still applies in full; nothing here repeats it.
Project layout and target setup: `apps/apple/README.md`. Validation: `make apple-validate`.

## Location authorization

- Prefer `When In Use` location authorization.
- Do not add `Always` authorization without a new ADR and explicit product requirement.
- Keep precise current location on-device for nearby ranking whenever practical.

## Offline contract (ADR-0004)

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

- Preserve Swift 6 concurrency correctness.
- Keep the Xcode project under version control; prefer synchronized source folders to limit `project.pbxproj` churn.
- Tile math must stay consistent with `contracts/tiles/slippy-xyz-vectors.v1.json` (ADR-0005).
