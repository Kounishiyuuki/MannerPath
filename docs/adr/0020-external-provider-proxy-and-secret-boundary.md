# ADR-0020 — External provider proxy and secret boundary

Status: **Proposed (draft, 2026-10-12).** Not accepted. Nothing is implemented, and no provider is chosen.

Relates to ADR-0003 (backend), ADR-0007 (report privacy, App Attest) and ADR-0014 (report store), and to
`docs/SECURITY_RELEASE_GATE.md` ("Future providers needing a secret must use iPhone → MannerPath Worker → external
provider").

## Context

MannerPath ships no client API key today (`SECURITY_RELEASE_GATE.md`). A future feature may need a paid or
credentialed external API: a geocoder, routing, translation, moderation or image analysis. A key in any Apple bundle
is extractable, and an extractable key is not an authentication boundary.

## Decision

1. **Topology.** App (iPhone only) → MannerPath Worker → provider.
   - Watch and widgets never call a provider route. They use the iPhone or public reads.
   - No provider is called directly from any client.
2. **Secrets.** Each provider credential is a Cloudflare Worker secret binding (`<PROVIDER>_API_KEY`), set per
   environment by the maintainer.
   - **Never in:** Swift, plist, xcconfig, Watch, widgets, D1 (`DB`, `REPORTS_DB`), R2, `vars`, `/v1/config` or
     any response, error bodies, logs or CI.
   - The deploy-config vars allowlist and the secret scanners stay authoritative.
3. **No arbitrary proxy.**
   - Routes are fixed: `/v1/providers/<provider>/<operation>`. Each operation is an explicit, reviewed allowlist
     entry in code, with a fixed upstream origin and path.
   - The client never supplies a URL, host, path, method or header for the upstream.
   - Redirects are not followed off the allowlisted origin.
4. **Bounded requests.**
   - Every operation has a schema (zod) with byte, field and count limits, checked before any upstream call.
   - The upstream response is size-capped and parsed into a minimal DTO. The raw upstream body is never relayed.
5. **Timeouts.**
   - Each upstream call has an explicit timeout and at most one retry, only for idempotent operations.
   - On failure, the Worker returns a constant 503 with `no-store` and no upstream error text.
6. **Auth and budgets.**
   - An operation that spends quota or money requires App Attest (an assertion per request, or a short-lived
     Worker-issued session derived from one) and per-key and per-network budgets.
   - Budgets use the Lane 1 design, with the `RATE_LIMIT_KEY_PEPPER` HMAC and no stored IP.
   - Public, free, non-personal operations may be unauthenticated but stay edge-limited.
   - A missing secret or attestation config fails closed.
7. **Privacy.**
   - The Worker forwards only the fields the operation needs. It sends no installation ID, App Attest key ID or IP
     upstream unless the operation requires it, and that requirement is documented.
   - The provider's own logging and retention are reviewed and added to the privacy policy and App Privacy before
     launch.
   - No new explicit log line carries request content.
8. **Attribution and licensing.**
   - Provider terms are reviewed like a data source (`docs/DATA_POLICY.md`). Output may be shown only where the
     terms allow, with the required attribution in the app.
   - Provider output is **never** canonical spot evidence (AGENTS.md: third-party discovery is not canonical
     provenance), unless a separate ADR approves that provider as a source.
9. **Cache and storage.**
   - Queries containing a user's position, text or identity are not cached or persisted.
   - Non-personal responses may be cached at the edge only if the provider's terms allow it, for the shortest
     useful TTL.
   - Nothing from a provider is written to D1 or R2 without a separate reviewed decision.

## Acceptance tests required before the first provider ships

- An unknown operation, or a client-supplied URL or host, returns 404 or 400 with no upstream call.
- An oversized request is refused before the upstream call. An oversized response is refused.
- A timeout returns a constant 503 and the upstream error text is not echoed.
- A missing secret makes the route unavailable, not unauthenticated.
- The secret name is absent from `vars` and `/v1/config`, and the artifact scan passes.
- Budget refusal writes no IP or prefix to D1.
- No provider route is called from the Watch or widget targets.

## Consequences

- Every provider adds a Worker route, a schema, tests and a privacy review. That cost is intended.
- Worker CPU and subrequest limits apply to the proxy path and must be measured per operation.
