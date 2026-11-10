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
| Apple app | `make apple-validate` — iOS tests, watchOS unit tests (`MannerPathWatch Watch AppTests`), watchOS app build, iPhone API-origin check (macOS + Xcode only) |
| Backend / data pipeline | `make api-validate` |
| Everything | `make validate` |

If a command cannot run in this environment, say so and give the exact command the
user should run; never substitute a different command.

## Commit-bound validation evidence

For local validation, commit the intended changes first and use a clean isolated worktree/clone. Record the
full reviewed SHA, not just a branch name or a previous run's test count. From the repository root:

```sh
reviewed_commit=$(git rev-parse HEAD)
python3 scripts/check-validation-checkout.py --commit "$reviewed_commit"
make contract
# Run the other required validation commands for the changed area here.
python3 scripts/check-validation-checkout.py --commit "$reviewed_commit"
```

Both identity checks must pass on the same SHA, and each validation command must independently succeed.
The helper reports checkout identity/cleanliness, **not** test success. Unstaged, staged and untracked files,
or a moved HEAD, invalidate the receipt. Ignored build output and the process environment are outside this
Git cleanliness check; prefer a fresh clone and record runtime/tool versions. Do not reset away a dirty result
and claim that its earlier test run validated the commit. Recommit and repeat the relevant checks instead.

GitHub PR validation keeps the default event checkout: for `pull_request`, `GITHUB_SHA` is the synthetic merge
commit, while the PR head is a separate SHA. The workflow checks/prints the actual checkout SHA, tree and PR
head before and after validation and requires the PR head to be included. It does not substitute a developer's
local files or silently switch to the head branch. On main push it checks that event `after` matches the checkout.
The final check runs after failures too; a clean final tree does not make skipped/failed tests successful.
Read the job conclusion, command results and both identity records together. Canceled, missing, billing-blocked
or skipped jobs are UNVERIFIED. See [CI coverage and administrator gates](CI_SUPPLY_CHAIN_SECURITY.md#quality-gate-audit-2026-11-11).

## Local Apple workload admission (all lanes on one Mac)

Execute the runner scripts; do not source them. `run-iphone-ui-tests.sh`, `validate-apple.sh`,
`check-iphone-api-base-url.sh` and the unsigned archive path of `apple-beta-preflight.sh` use
`scripts/apple-workload-lock.py`. It acquires one non-waiting, per-user kernel lock at
`/tmp/mannerpath-apple-workload-<uid>.lock`, shared across worktrees, before preparing data,
creating a Simulator or invoking Xcode. It retains the lock through all phases and cleanup.
Nested validation reuses an inherited descriptor, rather than releasing/reacquiring between builds.
Read-only inspection of an existing signed artifact does not require the Xcode slot.

For a standalone test/build command, join the same gate:

```sh
python3 scripts/apple-workload-lock.py -- xcodebuild <reviewed arguments>
```

Exit3 means another cooperating workload holds the lock, an xcodebuild already exists (including another
project), or the process/lock state cannot be verified. Leave other lanes/PulseCue running and retry later;
do not use kill/pkill or delete their Simulators. After acquiring the lock, the gate checks `pgrep -x xcodebuild`;
it never signals those results. Cancellation is forwarded only to the new command's own session.

The lock file persists after success/failure and may contain old supervisor metadata. File existence, PID
absence or age is **not** a held-lock test. Never unlink it to recover a slot: a live child may still own the
inode, and replacement would create two independent locks. Normal exits release the kernel lock; after
SIGKILL, surviving children retain the lock while they keep the inherited descriptor open. A future acquisition can
reuse the same old file when the kernel permits it. If busy persists, ask the workload owner to inspect
their own run; do not automatically clear it or stop another process.

This is cooperative admission, not a machine-wide Xcode scheduler or a CPU/load cap. All lanes must use the
updated scripts/helper, including manual commands. An old checkout or an unrelated project can still start
direct xcodebuild after the snapshot check; the helper cannot prevent that race. A descendant that explicitly
closes inherited descriptors is outside the supervisor-crash retention guarantee. `-parallel-testing-enabled NO`
prevents test clones in these runners, while compiler/build parallelism remains unchanged. No extra heavy
run should be launched merely to measure contention. `test-apple-workload-lock.py` and the existing runner
stand-ins cover concurrency/lifecycle without launching Xcode, simctl or accessing the live lock.

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
