---
name: mannerpath-apple
description: "MannerPath Apple app workflow (apps/apple/**): SwiftUI/watchOS feature and bug work, location, offline behavior, tile math in the app. Names the authoritative contracts to read and runs make apple-validate. Not for backend, API, or data-pipeline changes."
argument-hint: [issue-number]
disable-model-invocation: true
---

Run the MannerPath Apple workflow for $ARGUMENTS.

Follow `docs/AGENT_WORKFLOWS.md` (session model, common workflow, reporting contract).
It is the source of truth for the steps; this skill only scopes them to the Apple app.

**Read, in this order — and nothing else by default:**

1. `AGENTS.md` (root contract), if it is not already in context.
2. `apps/apple/AGENTS.md` — always, before the first edit. It is not auto-loaded by
   opening a file under `apps/apple/`; read it explicitly.
3. Only the docs/ADRs that the "What to read for this task" table in
   `apps/apple/AGENTS.md` maps to your concern. A pure UI/layout change needs none.

Do not read backend, API, or source documents for an Apple task unless that table
names one.

**Scope:** `apps/apple/**` only. If the change needs an API or pipeline edit, stop and
say so rather than editing `services/**` in the same pass.

**Validation:** `make apple-validate`, then `make contract` and `git diff --check`.
Quote failures verbatim; never report a check you did not run.
