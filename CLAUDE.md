# CLAUDE.md — MannerPath

@AGENTS.md

`AGENTS.md` above is the authoritative engineering contract. Area rules load on demand
from `.claude/rules/` when you touch `apps/apple/**` or `services/**`.

Task workflows are skills, not always-loaded prose — invoke `/mannerpath-apple`,
`/mannerpath-backend`, or `/mannerpath-pr-review`. They share one source of truth with
the Codex skills: `docs/AGENT_WORKFLOWS.md`.
