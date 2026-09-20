---
name: mannerpath-pr-review
description: "MannerPath PR/branch review: audit a diff against the repository contracts and ADRs, run the area validation commands, and report findings only. Use when reviewing a PR or checking a branch before opening one, not when implementing a change."
argument-hint: [pr-number]
disable-model-invocation: true
---

Review MannerPath changes in $ARGUMENTS (a PR number, or the current branch against `main`).

Follow the **PR review workflow** and **reporting contract** in `docs/AGENT_WORKFLOWS.md`.
It is the source of truth for the steps; this skill only names the inputs.

**Get the diff first**, then read only what the diff touches:

- `gh pr diff <n>` for a PR, or `git diff main...HEAD` for the current branch
- `AGENTS.md` for every diff
- `apps/apple/AGENTS.md` if the diff touches `apps/apple/**` (read it explicitly; it is
  not auto-loaded)
- `services/AGENTS.md` if the diff touches `services/**` or `contracts/**` (same)
- only the docs/ADRs those area tables map to what the diff actually changes, plus the
  ADR for any accepted decision the diff appears to change

**Validation:** run `make contract`, plus `make apple-validate` / `make api-validate` for
the areas the diff touches, and `git diff --check`.

**Output:** findings only — `file:line`, the specific invariant at stake, and a verdict.
Do not fix anything unless explicitly asked, and do not merge.
