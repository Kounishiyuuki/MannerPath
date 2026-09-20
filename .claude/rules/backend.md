---
paths:
  - "services/**"
  - "contracts/**"
---

# Backend and data-pipeline rules

You are touching `services/**` or `contracts/**`. Read `services/AGENTS.md` before
editing — it is the authoritative area contract (pinned dependencies, migration rules,
source-registry publication gating, API surface). The root `AGENTS.md` still applies.

Validate with `make api-validate`. Full workflow: `docs/AGENT_WORKFLOWS.md`.
