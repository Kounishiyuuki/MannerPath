---
name: mannerpath-backend
description: "MannerPath backend workflow (services/**, contracts/**): Cloudflare Workers API, D1 migrations, tile publication, and data-pipeline ingest/provenance work. Names the authoritative contracts to read and runs make api-validate. Not for Apple app changes."
---

Run the MannerPath backend workflow for the Issue given in the prompt.

Follow `docs/AGENT_WORKFLOWS.md` (session model, common workflow, reporting contract).
It is the source of truth for the steps; this skill only scopes them to the backend.

**Authoritative files to inspect — these, not the whole repository:**

- `AGENTS.md` (root contract)
- `services/AGENTS.md` (backend area contract: deps, migrations, publication, API surface)
- `services/api/README.md`, `services/data-pipeline/README.md`
- `docs/API.md`, `docs/DATA_POLICY.md`, `docs/SOURCES.md`
- only the ADRs covering the touched paths — commonly ADR-0002 (canonical spot data), ADR-0003 (backend), ADR-0005 (tiles/sync), ADR-0006 (evidence and publication)

**Scope:** `services/**` and `contracts/**` only. If the change needs an Apple app edit,
stop and say so rather than editing `apps/apple/**` in the same pass.

**Validation:** `make api-validate`, then `make contract` and `git diff --check`.
Quote failures verbatim; never report a check you did not run.
