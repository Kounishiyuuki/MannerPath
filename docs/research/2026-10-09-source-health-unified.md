# Unified source and rights health monitoring (2026-10-09)

Supersedes the unmerged #223 (rights drift monitor) and #225 (reliability phase 2). It keeps #225 as the
base and moves #223's value into it: rights drift, rights baselines, an offline monitor mode and invariance
tests. It does not bring over #223's whole-page hashes, its separate workflow, its Osaka TLS gap or its
exit-code semantics. Read-only: no registry, fixture, canonical spot, promotion or publication change.

## Exit policy

Every source (data resource plus rights pages) is checked before the exit code is decided.
`0` means OK or ADVISORY only, `1` means at least one BLOCKING signal, `2` means a CLI or metadata error.

| Signal | Severity |
| --- | --- |
| `contentChanged` / `packagingChanged` with a compatible parser and schema | advisory (human release review) |
| same-origin `moved` | advisory |
| `humanReviewDue`, `rightsReviewDue` (operational reminders, not legal expiry) | advisory |
| `known:<signal>` while an explicit known advisory is active | advisory |
| `rightsChanged`, `rightsScopeMissing`, rights metadata missing, cross-origin relocation | blocking |
| schema incompatible, parser incompatible, unexpected MIME, 404/410, unexpected 401/403 | blocking |
| `rateLimited` (429, explicitly classified) | blocking |
| any non-200 final HTTP status (raw 3xx after redirect handling, 304, 418, 5xx, other 2xx) | blocking (`http:<status>`) |
| any transport failure: timeout, DNS (`ENOTFOUND`), refused, reset, TLS, size, redirect, unknown | blocking (`transport:<class>(<code>)`) |
| rights page not fetchable (`rightsPage:<reason>`) | blocking, but **not** a rights change |
| a covered signal after its known advisory expired | blocking + `knownAdvisoryExpired` |

#225 treated timeout, network and 5xx as advisory, so a continuous outage of every source still exited 0,
and any unlisted status such as 300 or 304 evaluated as `ok`. Both now fail closed. A 304 has no
conditional-request contract here (no `If-None-Match` is sent), so it is unexpected.

## Known advisories

`review-metadata.json` → `sources[].knownAdvisories[]`: `{signal, reason, recordedAt, expiresAt}`. It covers
exactly one availability signal, `transport:(tls|timeout|network)`, `http:5xx`, `rateLimited` or
`unexpectedAccessBlocked`, optionally with a `(CODE)` suffix and/or a `rightsPage:` prefix. It applies
while `today < expiresAt`, and `expiresAt` must be at most 92 days after `recordedAt`. Validation rejects any
attempt to cover rights, schema, parser, MIME, relocation, `transport:unknown` or a 3xx/304.

The only active entry is Osaka `transport:timeout`, recorded 2026-10-09 and expiring 2026-11-09. In GitHub
run 37889290515 the GitHub-hosted `ubuntu-latest` runner timed out (20 s) only against the mapnavi data host
`www.mapnavi.city.osaka.lg.jp`; from the same runner the rights page on `www.city.osaka.lg.jp` returned
HTTP 200. A local Node 24 run reaches mapnavi over ECDHE+AEAD (DNS ~5 ms, TCP ~28 ms, TLS ~83 ms, headers
~123 ms, 245 KB complete ~391 ms; TLSv1.2 `ECDHE-RSA-AES256-GCM-SHA384`, certificate authorized). The root
cause is not confirmed. The likely explanation is network-path / egress reachability from GitHub-hosted
runners to the mapnavi host; this is not evidence that the publisher rejects GitHub runners as a whole.
A `rightsPage:transport:timeout` advisory was recorded earlier and removed: the rights host is reachable, so
that entry had no basis and could have hidden a real rights-page outage. While the advisory is active, Osaka
data is checked by the manual read-only procedure in `docs/OPERATIONS.md`. The TLS `ERR_SSL_DH_KEY_TOO_SMALL`
entry was removed: the ECDHE+AEAD transport makes it unreachable, so seeing it means the transport was
bypassed, and that must block.

## Scoped rights fingerprints

#223 hashed whole rights pages. Two live requests seconds apart (2026-10-09) confirmed why that fails:

- Kyoto resource 21432: only `アクセス数` / `今月のアクセス数` changed (272→273, 50→51).
- Minato `/about` and `/pages/exhibit`: only `<meta name="_csrf_token">` changed.

`src/source-health/rights.ts` adds no dependency. It normalizes HTML deterministically: it removes
comments, `script`, `style` and `noscript`; keeps visible text plus `[link:href]` and `[img:alt]`, because
license badges are often only a link or an image; decodes entities; and collapses whitespace. Each source
declares an explicit scope contract, and only that range is hashed (SHA-256):

| Source | Page | Scope |
| --- | --- | --- |
| Taito | landing page | `ライセンスの取扱い` → `お問い合わせ` |
| Koto | Tokyo catalog `package_show` API | JSON fields `result.license_id/license_title/license_url` |
| Kyoto | resource 21432 | `データリソースID` → `作成日時` (resource ID, copyright holder, registrant, license link). Counters are outside |
| Musashino | item page | item 4(2) heading → its zip link, plus the section-wide `データのご利用に際して…` notice |
| Minato | `/about` terms; `/pages/exhibit` annex | `本サイトの利用について` → footer; `別のルールを適用するコンテンツ` → footer |
| Osaka | page 250227 (via the ECDHE transport) | `オープンデータの提供について` → `地図情報サイト「マップナビおおさか」掲載情報` |

Each range's `start` must occur exactly once. `end` is the first match after it and is excluded, so a clause
appended inside the section is still captured. Every contract also lists `requiredMarkers` (e.g. the CC
link or `CC-BY 4.0`). The outcomes:

- `start` absent, `end` absent, or a JSON field missing → `scopeMissing`.
- duplicate `start` → `scopeAmbiguous`.
- marker absent → `markerMissing`.

All three report `rightsScopeMissing` and blocking, and no fingerprint is produced. A different
fingerprint is `rightsChanged`. Rights pages are fetched without following redirects, only on a 200 with
the expected MIME type, bounded by size and time.

While designing the Musashino scope, the first anchor `データのご利用に際して` came back `scopeAmbiguous`: it
is also a substring of `対象データのご利用に際しては`. The anchor was lengthened rather than relaxed.

## Rights baselines and human review

The 7 `reviewedFingerprint` values are a **reviewed monitoring baseline**: drift-detection reference points
made on 2026-10-09 by checking the scoped text against the rights evidence already recorded. They are not a
license grant, a legal approval or a publication approval, and do not replace the rights review in
`docs/DATA_POLICY.md`.

There is no separate rights baseline file: each `sources[].rights[]` in `review-metadata.json` holds
`{url, scope, reviewedFingerprint, reviewedAt, reviewDueAt}`. The 2026-10-09 fingerprints were computed by
the shipped extractor from the live pages. The scoped text was read and matches the evidence already
recorded in `rightsEvidence` (CC BY 4.0 / CC BY 2.1 JP, Minato terms and exhibit annex listing only GTFS and
baby stations). The tool never writes this file. A changed fingerprint stays `rightsChanged` on every run
until a human reads the scoped notice and a reviewed PR copies the report's `fingerprint` into
`reviewedFingerprint`.

## Live read-only audit (local Node 24, 2026-10-09)

Exit 0, `ADVISORY ONLY`. All 7 rights scopes `unchanged`. Kyoto and Minato no longer raise false alerts.
Osaka is `contentChanged` (advisory) through `node-https-ecdhe-aead`, with 529 raw rows and 344 selected rows.
That release still awaits separate review. Content changed ≠ rights changed: Osaka's rights scope is
unchanged. The other five data resources are healthy.

## Offline mode and invariance

`npm run source:health -- --offline` replays the reviewed fixtures through the same checker and evaluator,
using Musashino's reviewed outer archive. It makes no network request, reports rights as `notChecked`, and
is deterministic. Tests confirm that health and rights checks leave the registry, the 6 sources, 515
canonical spots, 513 published spots and 81 tile bodies byte-identical.
