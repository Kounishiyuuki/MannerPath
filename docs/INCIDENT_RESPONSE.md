# Incident response

The maintainer owns every decision and every remote action. An agent may draft, read and run local checks only. It
never runs `wrangler` against staging or production, never rotates or deletes secrets, and never pushes.

Secret names and rotation: [SECRETS_AND_ROTATION.md](SECRETS_AND_ROTATION.md). Release and rollback order:
[RELEASE_CHECKLIST.md](RELEASE_CHECKLIST.md) §Rollback order. Operations: [OPERATIONS.md](OPERATIONS.md).

## Severity

| Level | Definition | Examples | Target to contain |
|---|---|---|---|
| **S1** | Secret or data compromise | A secret in a commit, artifact, log or chat; an unknown token use in the audit log; report data exposure; R2 bucket found public; a canonical publication altered outside promotion | Immediately (same session) |
| **S2** | Abuse, attack or rate exhaustion | Challenge or registration flood; report spam; read scraping causing a cost spike; budget exhaustion locking out real users | Within hours |
| **S3** | Availability or provider issue | A bad Worker deploy; D1 errors (constant 503s); a Cloudflare incident; a source provider outage (source health red) | Within a day; no data at risk |

When unsure, use the higher severity.

## Kill switches that exist today (verified in the repository, main `36b62ba`)

| Switch | Command (maintainer) | Effect | Source |
|---|---|---|---|
| Worker code rollback | `npx wrangler rollback --env <env>` | Previous Worker version. Data and secrets untouched (secrets are not versioned with code) | `RELEASE_CHECKLIST.md` §Rollback order |
| Stop report intake | `npx wrangler secret delete REPORT_APP_ATTEST_APP_ID --env <env>` | `required` without the App ID returns 503 `attestationUnavailable`; `/v1/config` `available:false`. **Never** set `REPORT_ATTESTATION=disabled` | `OPERATIONS.md` §7 Rollback / disable, §Community rollback |
| Reports fail closed by default | Remote `REPORT_ATTESTATION=required` with App Attest values unset, or `REPORT_SUBMITTER_PEPPER` missing or under 32 UTF-8 bytes | Intake is off in staging and production today. Any incomplete attestation configuration answers 503 | `wrangler.jsonc`, `reports/attestation.ts` |
| Canonical publication rollback | Revert `DB` `database_id` to the kept blue database (reviewed PR, deploy) | Official data exactly as before cutover; REPORTS_DB untouched | `RELEASE_CHECKLIST.md` §Rollback order |
| Hold the community source | `COMMUNITY_PUBLICATION.state = "suspended"` PR → pipeline → blue/green | Community spots leave tiles; evidence kept | `OPERATIONS.md` §Community rollback |
| Hold one official source's evidence | `npm run source:hold -- hold …` (local canonical) → promotion | Its spots leave tiles until cleared. Tiles can stay cached up to the ADR-0019 window (60 s, plus `stale-while-revalidate` downstream); spot detail answers at once | ADR-0018 §5, ADR-0019 |
| Photo intake | Disabled in the exported Worker (code): 503 `photoEvidenceDisabled` | Not reachable | `app.ts` (`photoEvidence`) |
| Cron | No committed schedule in any environment | No scheduled job runs | `wrangler.jsonc` |

**Code exists but is not activated** (usable only after a reviewed activation, never in an incident on its own):
- the per-client challenge limiter (`CHALLENGE_RATE_LIMITER` + `RATE_LIMIT_KEY_PEPPER`, ADR-0019). No binding or
  secret is set in any environment. Activating it mid-incident is a deploy plus a secret change; do it in staging
  first. Once active, a limiter failure fails challenge issuance closed (503).

**Not available. Do not use or cite them as existing:**
- a registration pause switch (e.g. `REPORT_REGISTRATION=paused`); no code reads such a value;
- single App Attest key revocation and bulk reject by key (later lane);
- the successful key-registration budget (later lane);
- a Worker-side read rate limit (reads rely on the edge cache and the edge rule, ADR-0019);
- WAF rate-limiting rules (account; availability unverified, `SECRETS_AND_ROTATION.md` C4).

## Phases

### 1. Detect

- **Signals:**
  - the source-health workflow goes red (S3);
  - app or user reports of errors;
  - Cloudflare dashboard metrics (requests, errors, CPU, D1 rows read);
  - the account audit log;
  - a scanner suspect in `make security-validate` / `apple-beta-preflight`;
  - a GitHub secret-scanning alert.
- **Not available:** a per-request log. Invocation logs are off by design, so diagnosis is from aggregates.
  - Do **not** turn invocation logs on to investigate: tile paths are location history.
  - If a time-boxed diagnostic is unavoidable, it is an S1-level privacy decision for the maintainer. Record the
    window and delete the logs afterwards.
- **Open an incident note** (private) with the time, severity, signal, and who is acting. It contains no secret
  values, IPs or user content.

### 2. Contain

| Severity | First action |
|---|---|
| S1 secret | Revoke or rotate the exposed credential first (see Rotate). If it is a report-path secret, stop intake |
| S1 data | Stop intake if REPORTS_DB is involved. Make R2 private if it is public. For an altered publication, revert `DB` to blue |
| S2 flood (writes) | Stop intake (`secret delete REPORT_APP_ATTEST_APP_ID`). Add or tighten a WAF rule if available (C4). The challenge limiter helps only if already activated |
| S2 scraping (reads) | WAF or rate rule if available. Tile reads are already edge-cached (ADR-0019; custom domain only). Reads stay unauthenticated (product rule): do not add client keys |
| S3 bad deploy | `wrangler rollback`. For bad data, revert the `DB` binding |
| S3 provider | Nothing to switch off. Source health is advisory. If a source's facts are in doubt, use `source:hold` |

### 3. Rotate / Revoke

Follow [SECRETS_AND_ROTATION.md](SECRETS_AND_ROTATION.md) for the exact credential. For a secret found in git:
1. Treat it as compromised whether or not it was pushed.
2. Rotate it at the provider.
3. Do **not** rewrite history automatically. History rewriting is a separate maintainer decision.
4. Re-run `python3 scripts/security-secret-scan.py --history` to confirm it is classified.

### 4. Recover

- Redeploy the fixed code, re-put the rotated secrets, and resume intake by re-putting `REPORT_APP_ATTEST_APP_ID`
  only after the cause is fixed.
- Restore a canonical DB only through the documented blue/green path. REPORTS_DB is never rolled back (ADR-0014);
  recover it with `services/api/REPORTS_MIGRATION_RECOVERY.md`.

### 5. Verify

- Remote smoke against the environment (`npm run local:smoke` equivalent per `OPERATIONS.md`).
- `/v1/config` shows the intended `reports.available`.
- `/v1/readiness` returns 200.
- `make security-validate` passes on the fix commit.
- `wrangler secret list` shows the expected names.
- The audit log shows no further unexpected use.

### 6. Postmortem (within 7 days)

Template:
- timeline (UTC);
- severity;
- detection signal and delay;
- root cause;
- contained by which switch;
- what was rotated;
- user impact;
- data exposure (yes/no/unknown, with evidence);
- whether a user or App Store notice is needed;
- follow-ups as issues with an owner.

Do not paste secret values, IPs, tile paths or report content. Unknown stays "unknown", never "none".

## User and store notice

If personal data in REPORTS_DB, logs or support mail may have been exposed, the maintainer decides on notice under
the privacy policy (`site/`) and applicable law. Use `PRODUCTION_PRIVACY_AUDIT.md` as the data inventory. This
document makes no legal determination.

## Drills

- Rehearse in **staging** at least before App Store submission and before enabling report intake:
  - `wrangler rollback`;
  - a `DB` binding revert;
  - the intake stop / resume.
- Record the date and the result in `RELEASE_CHECKLIST.md`. No drill has been recorded yet.
