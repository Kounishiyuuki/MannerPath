# Secrets inventory and rotation runbook

Names only. **No secret value is ever written into this repository, a commit, an issue, a log, a terminal transcript
shared with an agent, or this document.** An agent never runs `wrangler secret put`, `wrangler secret delete` or any
token operation; every step below is a maintainer action. Related documents:
- [INCIDENT_RESPONSE.md](INCIDENT_RESPONSE.md)
- [SECURITY_RELEASE_GATE.md](SECURITY_RELEASE_GATE.md)
- [ADR-0020 (Proposed)](adr/0020-external-provider-proxy-and-secret-boundary.md)
- [ADR-0019](adr/0019-read-api-edge-cache-bounded-staleness.md) and `OPERATIONS.md` §Read API and challenge abuse budget
- [CI_SUPPLY_CHAIN_SECURITY.md](CI_SUPPLY_CHAIN_SECURITY.md) (GitHub and CI controls)

## Secret boundary

App / Watch / Widget → MannerPath Cloudflare Worker → external provider.

- A credential lives **only** in a Cloudflare Worker secret binding (`npx wrangler secret put <NAME> --env <env>`),
  separately per environment.
- **Forbidden locations:**
  - Swift source, any `Info.plist`, any `.xcconfig` or build setting;
  - the Watch app, iPhone widgets, Watch widgets;
  - canonical `DB` (D1), `REPORTS_DB` (D1), R2 (`RAW_ARTIFACTS`);
  - `vars` in `wrangler.jsonc`;
  - `/v1/config` or any other response body;
  - error bodies, explicit logs, CI artifacts.
- **Enforced today:**
  - the committed vars allowlist is exactly `["REPORT_ATTESTATION"]` (`services/api/test/deploy-config.test.ts`);
  - the tracked, history and Release-artifact secret scanners (`make security-validate`,
    `make apple-beta-preflight`);
  - `/v1/config` reveals only whether reports are available, never a configured value.

## Inventory (repository evidence, 2026-10-13, main `36b62ba`)

Status words: **In use** = read by deployed-path code; **Implemented, not activated** = code exists and is tested,
but no binding or secret is set in any committed environment; **Future** = no code.

| Name | Kind | Status | Read by | Missing or invalid value → behaviour |
|---|---|---|---|---|
| `REPORT_SUBMITTER_PEPPER` | Secret | **Required** wherever `REPORT_ATTESTATION=required` (staging, production). Report intake is not enabled in production yet | `attestationConfig` (`reports/attestation.ts`, `usableSubmitterPepper`) → `submitterHash` | **Fails closed:** missing, empty, whitespace-only or under 32 UTF-8 bytes after trimming makes attestation `unsupported`: every report and App Attest route answers 503 `attestationUnavailable`, and `/v1/config` `available:false`. Only local `disabled` mode (unattested schema 1) may run without it |
| `RATE_LIMIT_KEY_PEPPER` | Secret, separate from the report pepper | **Implemented, not activated.** Read by `attest/challenge-budget.ts` (Lane 1, ADR-0019). No `CHALLENGE_RATE_LIMITER` binding in `wrangler.jsonc`, no secret set; a real Rate Limiting binding has not been verified in staging | `challengeBudget` → HMAC bucket key | Neither it nor the binding set: unchanged behaviour (no bucket). Only one set, under 32 UTF-8 bytes after trimming, or equal to `REPORT_SUBMITTER_PEPPER` after trimming: challenge issuance 503 `challengeBudgetMisconfigured`. Configured limiter fails: 503 `serviceUnavailable` (fail closed) |
| `REPORT_APP_ATTEST_APP_ID` | Secret binding (deployment identifier, kept out of the repo) | In use; **unset in staging and production** by design (intake inactive) | `attestationConfig` | Fails closed: 503 `attestationUnavailable`; `/v1/config` `available:false` |
| `REPORT_APP_ATTEST_ENVIRONMENT` | Secret binding (`development`/`production`) | Same as above | `attestationConfig` | Fails closed |
| `REPORT_APP_ATTEST_BUNDLE_VERSIONS` | Secret binding (comma list) | Same as above | `attestationConfig` | Fails closed |
| `<PROVIDER>_API_KEY` (per provider) | Secret | **Future.** No provider chosen. Governed by ADR-0020 (Proposed) | — | ADR-0020: missing returns a constant 503 and no unauthenticated upstream call |
| Cloudflare API token | **Account credential**, not a Worker binding (maintainer terminal / OAuth) | Used by manual `wrangler` deploys only. **No CI deploy exists** | `wrangler` CLI | — |
| GitHub deployment credential | None stored. `pages.yml` uses the job's OIDC `id-token` for GitHub Pages; no workflow reads `secrets.*` | — | — | — |

Not secrets, and kept apart from the table above:
- **Committed var:** `REPORT_ATTESTATION` (`disabled` local, `required` remote; any other value fails closed). It is the
  only entry the vars allowlist permits.
- **Bindings:** `DB`, `REPORTS_DB` (D1 IDs; production IDs pinned in `wrangler.jsonc` for review), `RAW_ARTIFACTS`
  (R2 bucket name), and the optional `CHALLENGE_RATE_LIMITER` (Workers Rate Limiting; not configured anywhere yet).

## Rotation runbooks

General rules:
- Rotate in **staging first**, smoke, then production.
- Generate values locally with a CSPRNG (e.g. `openssl rand -base64 48`) and paste them straight into the
  interactive `wrangler secret put` prompt. Never put them in shell history, files or chat.
- Record only the date, environment, name and reason in the maintainer's private log, never the value.
- `wrangler secret put` and `wrangler secret delete` each create **and deploy** a new Worker version. A rollback
  deploys an older version, and **may bring back that version's secret state** (see "Worker rollback and secrets").
  Rotation and rollback are therefore never independent: rotate, then never roll back across the rotation without
  re-applying it.

## Worker rollback and secrets

**Model.** Secrets are Worker bindings, and each Worker version carries its own set: `secret put` / `secret delete`
create a new version, and a bulk secret upload preserves "secrets not included in the file … from the previous
version" ([Secrets](https://developers.cloudflare.com/workers/configuration/secrets/)). Cloudflare blocks a
deployment such as "rolling back to an older version when a secret has changed" unless it is forced
(`force=true` on the
[deployments API](https://developers.cloudflare.com/api/resources/workers/subresources/scripts/subresources/deployments/methods/create/));
Wrangler surfaces this as an extra confirmation. Plan every rollback on the assumption that it **can restore the
older version's secret values or absence** — including a leaked secret, a deleted `REPORT_APP_ATTEST_APP_ID`, or a
missing `RATE_LIMIT_KEY_PEPPER`. Never treat "rolled back" as "secrets are safe". (Resources such as D1 databases
are not changed by a rollback,
[Rollbacks](https://developers.cloudflare.com/workers/configuration/versions-and-deployments/rollbacks/); that
statement is about resources, not secret values.)

**Rules.**
1. **After rotating a leaked secret**, do not approve a rollback to a version that predates the rotation. If
   Wrangler or the dashboard asks to confirm a secret change, **stop**: answer no, and find out which secrets differ.
   During an incident, never accept a confirmation that could reinstate a leaked value.
2. **After the intake kill switch** (`secret delete REPORT_APP_ATTEST_APP_ID`), a rollback to an older version can
   bring the App ID back and re-open report intake. After any rollback, re-check: `wrangler secret list` (names),
   `/v1/config` `reports.available`, and that `POST /v1/app-attest/challenges`, `/v1/app-attest/keys` and
   `/v1/reports` answer `503 attestationUnavailable` while intake is meant to be off.
3. **Prefer a forward recovery.** If a code rollback is needed: abort a secret-changing rollback, and instead deploy
   the known-good commit as a **new** deployment (`git checkout <good>` → `npx wrangler deploy --env <env>`). That
   this keeps the current secret state is an **operational assumption until the staging forward-deploy test below
   has passed**: the pinned Wrangler 4.149 deploy path sends `keepSecrets: true` ("Inherit unchanged secrets from
   the previous Worker Version"), but no deployment from this repository has confirmed it. After a forward
   redeploy, run the rule-2 checks anyway. If a rollback is unavoidable, immediately re-apply every required
   `secret put` / `secret delete` after it, then run the rule-2 checks before declaring recovery.
4. **Run `wrangler rollback` only by hand, from an interactive TTY.** Never from CI, GitHub Actions, a pipe, a
   script, an unattended agent, or any shell whose stdin is not an interactive terminal. In the pinned Wrangler
   4.149, a rollback across a changed secret is refused by the API and Wrangler then asks
   "The following secrets have changed … Please confirm you wish to continue"; in a non-interactive or CI context
   every confirmation returns its fallback value, which is **yes**, so the rollback is re-sent with `force` and the
   older secret state is restored without anyone seeing the warning. Before a rollback, check that stdin is an
   interactive terminal (e.g. `[ -t 0 ] && echo interactive`) and that `CI` is not set.
5. **No `--message`, no `force`, during an incident.** In Wrangler 4.149 `--message` only pre-fills the rollback
   **message** prompt; it does not skip the secret-change confirmation, and nothing here relies on it doing so.
   The ban is a conservative rule: an incident rollback is typed by a person, answers every prompt itself, and
   never uses an option or API flag (`force=true`) that could bypass a prompt.
6. **Audit rotation and rollback separately.** The incident log records, without values: the rollback target
   version ID; whether a secret-change warning appeared; whether it was accepted; which secret **names** were
   re-applied afterwards; and the verification results (rule 2). Never record a secret value.

**Staging verification (maintainer; staging only, never production; not yet performed).** Every rollback step
runs by hand in an interactive TTY; never from CI, a script or an agent, and never non-interactively.

*Rollback drill*
1. In staging, `secret put` a throwaway name (e.g. `ROLLBACK_PROBE`) with value A; note the version ID (V1).
2. `secret put ROLLBACK_PROBE` with value B; note the new version ID (V2).
3. `npx wrangler rollback <V1> --env staging` in an interactive TTY, without `--message`; record whether the
   secret-change confirmation appears and which secret **names** it lists (no values).
4. Accept it in staging only; then determine which value is active without printing it (e.g. a temporary
   staging-only build that returns a `sha256(ROLLBACK_PROBE)` prefix for A/B comparison).
5. Clean up (see below).

*Forward deploy test*
1. In staging, `secret put ROLLBACK_PROBE` with value A, then with value B (rotation); note the version IDs.
2. `git checkout <known-good commit>` and run a plain `npx wrangler deploy --env staging`.
3. Determine without printing values whether A or B is active (same method as above). Expected: B.
4. Record the new version and deployment IDs.
5. Clean up (see below).

*Clean up and record*
- `secret delete ROLLBACK_PROBE`, redeploy the current commit, and confirm `wrangler secret list` matches the
  inventory; remove any temporary probe build.
- Record as evidence only: date, version/deployment IDs, "secret-change confirmation shown: yes/no",
  "active value after rollback: A/B", "active value after forward deploy: A/B". Update rule 3 (drop "assumption"
  only if forward deploy kept B) and this section with the result.

### REPORT_SUBMITTER_PEPPER

- **Rotate:** `npx wrangler secret put REPORT_SUBMITTER_PEPPER --env <env>` with a new value of 32+ random bytes
  (at least 32 UTF-8 bytes after trimming, or intake fails closed). Paste it without surrounding whitespace: see P2-S3.
- **Impact (window reset):**
  - every `submitter_hash` changes;
  - open `report_rate_windows` no longer match, so each submitter gets a fresh 10/h and 50/day budget once;
  - stored reports can no longer be linked to future reports from the same key by hash.
  - This is a one-window abuse gap of at most 1 h / 24 h. Rotate while intake is stopped (delete
    `REPORT_APP_ATTEST_APP_ID`, see Emergency revoke) when abuse is active.
- **Rollback:** only by re-putting the old value, which requires having kept it. **Default: do not keep it.**
  Treat rotation as one-way and accept the reset. A Worker rollback to a version before the rotation may restore
  the old pepper; see "Worker rollback and secrets" and re-apply the current value.
- **Emergency revoke** (suspected leak): stop intake first (`secret delete REPORT_APP_ATTEST_APP_ID`), rotate the
  pepper, run retention (`reports:moderate -- --remote … retain`), then resume. A leaked pepper lets an attacker
  test guesses of the hashed key IDs. It does not expose report content.

### RATE_LIMIT_KEY_PEPPER (implemented, not activated)

- **Activate (maintainer, per environment):** a reviewed PR adds the `CHALLENGE_RATE_LIMITER` `ratelimits` binding
  to `wrangler.jsonc`; then `npx wrangler secret put RATE_LIMIT_KEY_PEPPER --env <env>`. Set both or neither: one
  alone makes challenge issuance fail closed. Verify in staging first, because the real binding is unverified.
- **Rotate:** `secret put` with a new random value of at least 32 UTF-8 bytes after trimming. It must be **distinct
  from** `REPORT_SUBMITTER_PEPPER` after trimming (checked in code), so each rotates independently.
- **Impact:** all buckets reset at once. Their counters live in the Rate Limiting service, keyed by the HMAC, and are
  never persisted by MannerPath. That is a short window where only the edge rule and the deployment-wide challenge
  ceiling apply.
- **Rollback:** not needed for its state (none is persisted). A Worker rollback can still restore an older pepper,
  or a version without it (half configuration, so issuance fails closed); re-apply after any rollback.
- **Emergency revoke:** rotate immediately. While rotating, tighten the WAF rate rule (account) to cover the gap.
- **Deactivate:** remove the binding (reviewed PR) **and** `secret delete RATE_LIMIT_KEY_PEPPER`. Removing only one
  leaves a half configuration, which fails challenge issuance closed.

### App Attest values (`REPORT_APP_ATTEST_APP_ID`, `_ENVIRONMENT`, `_BUNDLE_VERSIONS`)

These identify the app; they are not confidential keys. Changing them is a configuration change:

- `_BUNDLE_VERSIONS`: on each release, put the new list that includes the shipping build. To retire a compromised
  or buggy build, put a list without it, so its assertions fail.
- `_ENVIRONMENT`: `development` → `production` only at TestFlight or App Store cutover. Keys registered under the
  other aaguid stop verifying, so clients re-register.
- `_APP_ID`: changes only with a Team or bundle change. All registered keys become invalid.
- **Rollback:** put the previous value. These values are not secret, so the maintainer can keep them. A Worker
  rollback can also restore older values, or re-add a deleted App ID (re-opening intake); verify after any rollback.
- **Emergency revoke / stop intake:** `npx wrangler secret delete REPORT_APP_ATTEST_APP_ID --env <env>`. `required`
  without it fails closed, and `/v1/config` `available:false`. **Never** switch `REPORT_ATTESTATION` to `disabled`.
- Revoking a single App Attest key is **not implemented** (later lane).

### Cloudflare API token

- **Rotate:** Dashboard → My Profile → API Tokens → Roll, or create a new token and delete the old one. Use the
  narrowest scope: Workers Scripts Edit, D1 Edit and R2 Edit only on this account; no Zone or DNS unless needed; set
  an expiry and a client IP filter if possible. Re-authenticate `wrangler` locally (`wrangler login` or the env var
  in the maintainer's own shell only).
- **Impact:** none at runtime. The Worker never uses this token.
- **Rollback:** not applicable. Create a new one.
- **Emergency revoke:** delete the token in the dashboard first, then review audit logs for its use (S1).

### GitHub deployment credential

- None is stored today. Pages uses short-lived OIDC.
- **If one is ever added** (e.g. a CI deploy): use an environment secret with required reviewers, never a
  repository-wide secret, and give the job minimal `permissions:`.
- **Emergency revoke:** for a leaked PAT or deploy key, revoke it in GitHub settings, then check the audit log and
  recent workflow runs.

## Cloudflare and GitHub account evidence checklist (maintainer, dashboard)

Record only yes/no, names, scopes and dates. Never record values, IP addresses, raw log rows or user data.

| # | Item | Where | Record |
|---|---|---|---|
| C1 | Secret inventory per environment | `npx wrangler secret list --env staging` / `--env production` (lists names only) | Names match the table above; nothing unexpected. `RATE_LIMIT_KEY_PEPPER` is expected only where the limiter is activated |
| C2 | API token scopes | Dashboard → API Tokens | Each token: permissions, account/zone scope, expiry, IP filter, last used |
| C3 | Account members and MFA | Manage Account → Members | Member count, roles, MFA enforced |
| C4 | WAF / rate-limiting availability | Zone → Security → WAF (rate limiting rules); plan name | Plan; whether rate-limiting rules are available and how many; whether the Worker is on a zone route or `workers.dev` only |
| C5 | Workers Rate Limiting binding | Workers docs and plan; staging after activation | Available on the plan (yes/no); after activation, a staging check that a limited caller gets 429 and a limiter outage 503 |
| C6 | R2 public access | R2 → each `mannerpath-raw-artifacts*` bucket → Settings | Public access off; `r2.dev` subdomain disabled; no custom domain |
| C7 | Logpush | Analytics & Logs → Logpush | Jobs (yes/no), datasets, field list, destination retention (currently 403 per `PRODUCTION_PRIVACY_AUDIT.md`) |
| C8 | Workers Logs retention | Worker → Logs | Plan retention, invocation logs off (matches `wrangler.jsonc`) |
| C9 | Analytics | Web Analytics / Analytics Engine | Enabled products; no raw per-request export |
| C10 | Audit log | Manage Account → Audit Log | Reviewed for unexpected token or secret changes |
| G1 | `main` branch protection | GitHub → Settings → Branches / Rulesets | Required PR review; force-push and deletion blocked; required check = the `PR validation` job (`pr-validation.yml`: contract, API validation, security validation steps); bypass actors reviewed (CI_SUPPLY_CHAIN_SECURITY.md §Maintainer account actions) |
| G2 | `github-pages` environment | Settings → Environments | Deployment branches limited to `main`; protection rules as in CI_SUPPLY_CHAIN_SECURITY.md |
| G3 | Actions secrets | Settings → Secrets and variables | Expected: none |
| G4 | Actions defaults and account security | Settings → Actions / Code security | Default `GITHUB_TOKEN` permission read-only; allowed actions restricted; secret scanning, push protection and Dependabot alerts on |

## Repository-side vs account-side status

- **Repository-side, implemented on main** (Lane 2, `CI_SUPPLY_CHAIN_SECURITY.md`): PR validation workflow running
  `make contract`, `make api-validate` and `make security-validate`; actions pinned to full SHAs with an allowlist;
  container and service images pinned by digest; Dependabot configuration; hardened Pages artifact packaging;
  `scripts/check-ci-security.py` enforcing these in CI.
- **Account-side, not verified:** required checks on `main`, force-push and deletion blocking, bypass actors,
  Actions default permissions, `github-pages` environment protection, secret scanning and Dependabot account
  settings (G1–G4), and every Cloudflare item (C1–C10). Repository files cannot prove any of them.

## Findings

- **Resolved — P1-S1 (submitter pepper fail-open):** an empty pepper (`pepper ?? ""`) was accepted. Main now fails
  closed in every remote mode (`usableSubmitterPepper`, `test/report-submitter-pepper.test.ts`): missing, empty,
  whitespace-only or under 32 UTF-8 bytes after trimming → 503. Only local `disabled` mode runs without it.
- **Resolved — P2-S2 (separate rate-limit pepper):** `RATE_LIMIT_KEY_PEPPER` is a separate secret, checked in code to
  differ from the report pepper after trimming, and every half or invalid configuration fails closed.
- **Open — P2-S3 (submitter pepper normalization):** `usableSubmitterPepper` checks the length of the trimmed value
  but returns the untrimmed value, so `submitterHash` uses it untrimmed. A pepper set with surrounding whitespace
  therefore hashes differently from the trimmed one (`RATE_LIMIT_KEY_PEPPER` uses the trimmed value). Changing that
  changes every stored `submitter_hash`, which is the same window reset as a rotation. Follow-up: decide with a
  rotation, in a runtime lane. Until then, paste the pepper without surrounding whitespace.
