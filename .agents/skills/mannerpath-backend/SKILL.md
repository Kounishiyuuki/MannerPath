---
name: mannerpath-backend
description: "MannerPath backend workflow (services/**, contracts/**): Cloudflare Workers API, D1 migrations, tile publication, and data-pipeline ingest/provenance work. Names the authoritative contracts to read and runs make api-validate. Not for Apple app changes."
---

Run the MannerPath backend workflow for the Issue given in the prompt.

Follow `docs/AGENT_WORKFLOWS.md` (session model, common workflow, reporting contract).
It is the source of truth for the steps; this skill only scopes them to the backend.

**Read, in this order — and nothing else by default:**

1. `AGENTS.md` (root contract), if it is not already in context.
2. `services/AGENTS.md` — always, before the first edit. It is not auto-loaded by
   opening a file under `services/`; read it explicitly.
3. Only the docs/ADRs that the "What to read for this task" table in
   `services/AGENTS.md` maps to your concern. An endpoint change does not pull in the
   data-pipeline README unless it touches ingest or reconciliation.

**Scope:** `services/**` and `contracts/**` only. If the change needs an Apple app edit,
stop and say so rather than editing `apps/apple/**` in the same pass.

**Validation:** `make api-validate`, then `make contract` and `git diff --check`.
Quote failures verbatim; never report a check you did not run.
