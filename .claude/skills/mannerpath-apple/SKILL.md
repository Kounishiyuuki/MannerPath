---
name: mannerpath-apple
description: "MannerPath Apple app workflow (apps/apple/**): SwiftUI/watchOS feature and bug work, location, offline behavior, tile math in the app. Names the authoritative contracts to read and runs make apple-validate. Not for backend, API, or data-pipeline changes."
argument-hint: [issue-number]
disable-model-invocation: true
---

Run the MannerPath Apple workflow for $ARGUMENTS.

Follow `docs/AGENT_WORKFLOWS.md` (session model, common workflow, reporting contract).
It is the source of truth for the steps; this skill only scopes them to the Apple app.

**Authoritative files to inspect — these, not the whole repository:**

- `AGENTS.md` (root contract)
- `apps/apple/AGENTS.md` (Apple area contract: location, offline, architecture, quality gates)
- `apps/apple/README.md` (target/project layout)
- `docs/PRODUCT_REQUIREMENTS.md`, `docs/ARCHITECTURE.md`, `docs/TECH_STACK.md`
- only the ADRs covering the touched paths — commonly ADR-0001 (map platform), ADR-0004 (offline), ADR-0005 (tiles/sync)

**Scope:** `apps/apple/**` only. If the change needs an API or pipeline edit, stop and
say so rather than editing `services/**` in the same pass.

**Validation:** `make apple-validate`, then `make contract` and `git diff --check`.
Quote failures verbatim; never report a check you did not run.
