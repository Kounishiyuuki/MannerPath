# Secrets inventory and rotation runbook

Names only. **No secret value is ever written into this repository, a commit, an issue, a log, a terminal transcript
shared with an agent, or this document.** An agent never runs `wrangler secret put`, `wrangler secret delete` or any
token operation; every step below is a maintainer action. Related documents:
- [INCIDENT_RESPONSE.md](INCIDENT_RESPONSE.md)
- [SECURITY_RELEASE_GATE.md](SECURITY_RELEASE_GATE.md)
- [ADR-0019 (draft)](adr/0019-external-provider-proxy-and-secret-boundary.md)

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
  - the committed vars allowlist is exactly `["REPORT_ATTESTATION"]` (`services/api/test/deploy-config.test.ts:84`);
  - the tracked, history and Release-artifact secret scanners (`make security-validate`,
    `make apple-beta-preflight`);
  - `/v1/config` reveals only whether reports are available, never a configured value.

## Inventory (repository evidence, 2026-10-12, main `ae63660`)

| Name | Kind | Status | Read by | Missing value → behaviour |
|---|---|---|---|---|
| `REPORT_SUBMITTER_PEPPER` | Secret | **In use** when report intake is on | `app.ts:394,443,488` → `submitterHash` (`reports/create.ts:24`) | **Not fail-closed:** hashes with an empty pepper (`pepper ?? ""`). See P1-S1 below |
| `REPORT_APP_ATTEST_APP_ID` | Secret (deployment identifier, kept out of the repo) | In use; **unset in staging and production** by design (intake inactive) | `attestationConfig` | Fails closed: 503 `attestationUnavailable`; `/v1/config` `available:false` |
| `REPORT_APP_ATTEST_ENVIRONMENT` | Secret binding (`development`/`production`) | Same as above | `attestationConfig` | Fails closed |
| `REPORT_APP_ATTEST_BUNDLE_VERSIONS` | Secret binding (comma list) | Same as above | `attestationConfig` | Fails closed |
| `REPORT_ATTESTATION` | **Committed var**, not a secret | `disabled` local, `required` remote | `attestationConfig` | Unknown value fails closed |
| `RATE_LIMIT_KEY_PEPPER` | Secret | **Planned, not implemented.** No code reads it (`git grep` finds none). The Lane 1 network budget (B2) will key a Workers Rate Limiting bucket on an HMAC of the network prefix | — | Lane 1 must fail closed to "no B2 bucket", never to an unkeyed prefix |
| `<PROVIDER>_API_KEY` (per provider) | Secret | **Future.** No provider chosen. Governed by ADR-0019 | — | ADR-0019: missing returns a constant 503 and no unauthenticated upstream call |
| Cloudflare API token | Account credential (maintainer terminal / OAuth) | Used by manual `wrangler` deploys only. **No CI deploy exists** | `wrangler` CLI | — |
| GitHub deployment credential | None stored. `pages.yml` uses the job's OIDC `id-token` for GitHub Pages; `source-health.yml` reads no `secrets.*` | — | — | — |

Bindings that are **not secrets**: `DB`, `REPORTS_DB` (D1 IDs; production IDs are pinned in `wrangler.jsonc` for
review), `RAW_ARTIFACTS` (R2 bucket name).

## Rotation runbooks

General rules:
- Rotate in **staging first**, smoke, then production.
- Generate values locally with a CSPRNG (e.g. `openssl rand -base64 48`) and paste them straight into the
  interactive `wrangler secret put` prompt. Never put them in shell history, files or chat.
- Record only the date, environment, name and reason in the maintainer's private log, never the value.
- A secret put creates a new Worker version. `npx wrangler rollback` returns the code, but secrets are not versioned
  with it: **rolling back code does not restore an old secret value.**

### REPORT_SUBMITTER_PEPPER

- **Rotate:** `npx wrangler secret put REPORT_SUBMITTER_PEPPER --env <env>` with a new value of 32+ random bytes.
- **Impact (window reset):**
  - every `submitter_hash` changes;
  - open `report_rate_windows` no longer match, so each submitter gets a fresh 10/h and 50/day budget once;
  - stored reports can no longer be linked to future reports from the same key by hash.
  - This is a one-window abuse gap of at most 1 h / 24 h. Rotate while intake is stopped (delete
    `REPORT_APP_ATTEST_APP_ID`, see Emergency revoke) when abuse is active.
- **Rollback:** only by re-putting the old value, which requires having kept it. **Default: do not keep it.**
  Treat rotation as one-way and accept the reset.
- **Emergency revoke** (suspected leak): stop intake first (`secret delete REPORT_APP_ATTEST_APP_ID`), rotate the
  pepper, run retention (`reports:moderate -- --remote … retain`), then resume. A leaked pepper lets an attacker
  test guesses of the hashed key IDs. It does not expose report content.

### RATE_LIMIT_KEY_PEPPER (after Lane 1 lands)

- **Rotate:** `secret put` with a new random value. It must be **distinct from** `REPORT_SUBMITTER_PEPPER`, so each
  can rotate independently.
- **Impact:** all in-memory network buckets reset at once (counters are not persisted). This is a short window where
  only the edge rule (B1) and the deployment ceiling (B4) apply.
- **Rollback:** not needed. It holds no persisted state.
- **Emergency revoke:** rotate immediately. While rotating, tighten the WAF rate rule (account) to cover the gap.

### App Attest values (`REPORT_APP_ATTEST_APP_ID`, `_ENVIRONMENT`, `_BUNDLE_VERSIONS`)

These identify the app; they are not confidential keys. Changing them is a configuration change:

- `_BUNDLE_VERSIONS`: on each release, put the new list that includes the shipping build. To retire a compromised
  or buggy build, put a list without it, so its assertions fail.
- `_ENVIRONMENT`: `development` → `production` only at TestFlight or App Store cutover. Keys registered under the
  other aaguid stop verifying, so clients re-register.
- `_APP_ID`: changes only with a Team or bundle change. All registered keys become invalid.
- **Rollback:** put the previous value. These values are not secret, so the maintainer can keep them.
- **Emergency revoke / stop intake:** `npx wrangler secret delete REPORT_APP_ATTEST_APP_ID --env <env>`. `required`
  without it fails closed, and `/v1/config` `available:false`. **Never** switch `REPORT_ATTESTATION` to `disabled`.
- Revoking a single App Attest key is **not implemented** (planned, Lane 4).

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
| C1 | Secret inventory per environment | `npx wrangler secret list --env staging` / `--env production` (lists names only) | Names match the table above; nothing unexpected |
| C2 | API token scopes | Dashboard → API Tokens | Each token: permissions, account/zone scope, expiry, IP filter, last used |
| C3 | Account members and MFA | Manage Account → Members | Member count, roles, MFA enforced |
| C4 | WAF / rate-limiting availability | Zone → Security → WAF (rate limiting rules); plan name | Plan; whether rate-limiting rules are available and how many; whether the Worker is on a zone route or `workers.dev` only |
| C5 | Workers Rate Limiting binding | Workers docs and plan | Available on the plan (yes/no) |
| C6 | R2 public access | R2 → each `mannerpath-raw-artifacts*` bucket → Settings | Public access off; `r2.dev` subdomain disabled; no custom domain |
| C7 | Logpush | Analytics & Logs → Logpush | Jobs (yes/no), datasets, field list, destination retention (currently 403 per `PRODUCTION_PRIVACY_AUDIT.md`) |
| C8 | Workers Logs retention | Worker → Logs | Plan retention, invocation logs off (matches `wrangler.jsonc`) |
| C9 | Analytics | Web Analytics / Analytics Engine | Enabled products; no raw per-request export |
| C10 | Audit log | Manage Account → Audit Log | Reviewed for unexpected token or secret changes |
| G1 | `main` branch protection | GitHub → Settings → Branches / Rulesets | Required PR review, force-push blocked, deletion blocked, required checks (after Lane 2) |
| G2 | `github-pages` environment | Settings → Environments | Deployment branches limited to `main` |
| G3 | Actions secrets | Settings → Secrets and variables | Expected: none |

## Findings recorded by this review

- **P1-S1 (before report intake):** `submitterHash` accepts a missing `REPORT_SUBMITTER_PEPPER` and hashes with an
  empty pepper (`reports/create.ts:25`). The rest of attestation fails closed, but this one does not.
  - Fix in a runtime lane: treat a missing pepper (or one shorter than 32 bytes) as `attestationUnavailable` in
    remote modes, with a test.
  - No code change is made here.
- **P2-S2:** `RATE_LIMIT_KEY_PEPPER` must be a separate secret (decided here) and must fail closed when missing.
  This goes into Lane 1's acceptance tests.
