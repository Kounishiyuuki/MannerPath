# Agent workflows

Single source of truth for the repeatable MannerPath coding workflows.
Claude Code skills (`.claude/skills/`) and Codex skills (`.agents/skills/`) point here
instead of restating these steps, so the workflow text exists once.

Contracts stay where they already are: root `AGENTS.md`, the nested area `AGENTS.md`
files, `docs/`, and `docs/adr/`. This file describes *process*, not architecture.

## Session model

One Issue, one branch, one worktree, one fresh session. Branch name `claude/<topic>` or
`codex/<topic>` in kebab-case. Do not merge; open the PR and stop.

## Common workflow

1. Confirm the Issue number and the scope it implies. Ask before widening it.
2. Read root `AGENTS.md`, then the area `AGENTS.md` for every path you will touch.
   Read the area file explicitly — a nested `AGENTS.md` is not injected automatically
   when you open a file beneath it, and a session started at the repository root has
   only loaded the root one.
3. Read only the docs/ADRs that the area file's "What to read for this task" table maps
   to your concern. Do not read the repository broadly, and do not load a document
   because it is nearby.
4. If the change conflicts with an accepted ADR, stop and surface it, or update/add the
   ADR in the same change. Never work around an ADR silently.
5. Implement the smallest complete vertical slice.
6. Run the validation commands for the area (below). Failures are reported verbatim.
7. `git status`, `git diff`, `git diff --check`. Confirm the diff matches the intent.
8. Commit on the branch, push, open a PR to `main`. Do not merge.

## Validation commands

| Area | Command |
| --- | --- |
| Repository contract (always) | `make contract` |
| Apple app | `make apple-validate` |
| Backend / data pipeline | `make api-validate` |
| Everything | `make validate` |

If a command cannot run in this environment, say so and give the exact command the
user should run; never substitute a different command.

## PR review workflow

1. Get the diff (`gh pr diff <n>`, or `git diff main...HEAD` for a local branch).
2. Check the diff against the root `AGENTS.md` invariants and the area `AGENTS.md` for
   each touched path. Name the specific invariant when something violates it.
3. Check for: ADR drift, provenance/license loss, privacy regressions, secrets,
   unrelated opportunistic edits, missing tests for changed behavior, docs not updated
   alongside a changed contract.
4. Run the validation commands for the touched areas.
5. Report findings only — file:line, the invariant at stake, and a verdict. Do not fix
   unless asked.

## Reporting contract

Keep output short and decision-shaped:

- what contract/decision changed (or "none");
- validation result, with failures quoted verbatim;
- commit SHA;
- PR URL;
- blockers and anything deliberately deferred or left unverified.

Do not paste full logs, full diffs, or file contents. Never report a check as passing
without having run it.
