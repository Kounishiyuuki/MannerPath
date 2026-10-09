# Source health Phase 2 — reliability — 2026-10-09

Base: `origin/main` `69e85b115a9f6ed9f994a365d7c878d52e1fb5e4` (after #221). Follow-up to
[production source health](2026-10-09-production-source-health.md). No registry, fixture, adapter,
baseline, publication status, D1 or deployment change. Corpus replay is unchanged: 6 sources, 515 spots,
513 in the published tile snapshot, 81 tiles.

## Osaka TLS

| Observation (2026-10-09, macOS, Node 24.21.0 / OpenSSL 3.6.5) | Result |
| --- | --- |
| `openssl s_client` default | `dh key too small` (TLS 1.2; the server picks DHE first) |
| `openssl s_client -tls1_3` | handshake alert 40: no TLS 1.3 |
| `openssl s_client -tls1_2 -cipher ECDHE` | `ECDHE-RSA-AES256-GCM-SHA384`, P-256, verify 0 |
| Diagnostic only, `DHE:@SECLEVEL=0` | `Peer Temp Key: DH, 1024 bits` |
| Node 24 `fetch` | `ERR_SSL_DH_KEY_TOO_SMALL` |
| Node `https` offering only ECDHE+AEAD suites | 200, `ECDHE-RSA-AES256-GCM-SHA384`, `authorized: true` |
| macOS `curl` (LibreSSL/SecureTransport) | 200, verify 0 |

Cause: the publisher prefers finite-field DHE with a 1024-bit group. OpenSSL 3 at its default security level
(Node 24, Ubuntu runners) rejects keys below 2048 bits. macOS curl uses a different TLS stack, so it succeeds.
Ubuntu's OpenSSL-linked curl would hit the same default-security failure, so we expect the same failure on
GitHub's `ubuntu-latest` runners (see the live run below). The server also offers ECDHE. The issue is a
publisher TLS configuration limitation, not a certificate or rights problem.

| Option | Assessment |
| --- | --- |
| A. Keep `fetch`, record `transportUnavailable` | Safe, but Osaka would never be validated live |
| B. curl for the live CLI | Spawns a subprocess and depends on the runner's TLS stack (likely fails on Ubuntu) |
| C. Pluggable transport, probe both | More surface than needed |
| D. Wait for the publisher | Still useful to report, but leaves the monitor blind |
| **Chosen: per-source Node `https` with an ECDHE+AEAD-only cipher list** | Strict subset of the default: DHE is never offered. Certificate and hostname verification (`rejectUnauthorized: true`), the security level, TLS ≥1.2, the redirect policy, the size limit and the timeout are unchanged |

This keeps a small pluggable seam (`transports` in `scripts/source-health.ts`). Only Osaka uses it.
`ERR_SSL_DH_KEY_TOO_SMALL` remains registered as a known advisory with a review date in case the transport is bypassed.
Any other TLS code (certificate, hostname, protocol) is **blocking**.
Prohibited and absent: `rejectUnauthorized=false`, `NODE_TLS_REJECT_UNAUTHORIZED`, a lowered `SECLEVEL`, insecure curl.

## Multi-signal model and exit policy

`HealthResult.status` keeps its #221 meaning and precedence as the backward-compatible primary status.
The new `signals` object keeps independent facts: `moved`, `crossOriginRelocation`, `accessBlocked`,
`resourceMissing`, `serverError`, `transportFailure` (`tls|timeout|network|sizeLimit|redirect|unknown`) with
`transportCode`, `mimeUnexpected`, `contentChanged`, `packagingChanged`, `schemaCompatible`,
`parserCompatible` and `rightsReviewRequired`. A move and a content change are therefore both visible.

`src/source-health/evaluate.ts` assigns each source `blocking[]` / `advisory[]` reasons and a severity.
The JSON report is version 2: `{version, evaluatedOn, exitCode, summary{blocking,advisory,ok}, results[]}`.
Each result also carries `transport` and `review`. A Markdown table of signals goes to stderr and to the
GitHub step summary.

| Blocking (exit 1) | Advisory (exit 0) |
| --- | --- |
| parser/schema incompatible, rights metadata missing, cross-origin relocation, 404/410, unexpected 401/403 or other 4xx, unexpected MIME, TLS/size/redirect/unknown transport failure, unclassified status | content or packaging changed with healthy parser/schema, same-origin move, known TLS limitation, known access restriction, transient timeout/network, 5xx, `humanReviewDue` |

Every source is checked and reported before the exit code is decided. `observationDateUnknown` is listed
but never colours a run. Exit 2 remains for CLI/config errors, including missing or invalid review metadata.

## Human review freshness

`services/data-pipeline/source-health/review-metadata.json` is separate from the production registry. It has
one entry per source: `rightsReviewedAt`, `rightsEvidence`, `sourceObservedAt` (null = unknown),
`editionLabel`, `editionObservedAt`, `reviewDueAt`, `reviewerNote` and `knownAdvisories[]` (each with its own
`reviewDueAt`). `humanReviewDue` is true from the due JST day inclusive. These are operational reminders.
They carry no legal meaning, do not expire rights and never revoke publication.

## Koto and Musashino follow-up (read-only, 2026-10-09)

Koto: the station CSV is healthy (200, 3/3 rows, hash unchanged). Catalog HTML still returns 403; it was not
bypassed. The publisher's unauthenticated package API returns 200 with `CC-BY-4.0`, the same station resource URL
and `last_modified` 2025-03-16 (metadata_modified 2025-12-12). This is the last verified rights evidence, and it
matches the 2026-09-29 review that publication still relies on. The resource-specific HTML notice remains
unverified. Review is due 2027-01-09.

Musashino: the item page 4(2) still carries CC BY 4.0. The newest listed edition is still 令和4年版(2022年版); the
index lists 2009/2014/2018/令和4年 only, so there is no newer edition. The current-operation page (updated
2026-09-30) still lists the three sites; a door repair on 2026-10-02 was temporary. Because the edition is old,
the review interval is shorter (due 2026-12-09). The approved source is unchanged.

## Workflow supply chain

All actions are official `actions/*`, pinned to the commits behind their v4 tags (checkout v4.4.0
`11d5960…`, setup-node v4.4.0 `49933ea…`, upload-artifact v4.6.2 `ea165f8…`). Upgrading to a newer major
is a separate reviewed change. Other hardening: `persist-credentials: false`, the npm cache removed,
`contents: read` only, no `secrets.*`. Artifacts contain only the metadata JSON and the summary; there are
no response bodies.

## Security review of the transport change

TLS is not weakened (strict cipher subset, verification on). No shell is used, so no shell injection. URLs come
only from adapter constants, with HTTPS enforced again in the transport. Node `https` never follows redirects;
the same-origin policy, 5 MB stream/declared-size bounds and 20 s end-to-end deadline in `checkSourceHealth` apply
unchanged. The request body may only be a string. Errors surface only regex-bounded symbolic codes.
