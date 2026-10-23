# ADR-0016 — Private community photo evidence foundation

Status: Accepted for the technical foundation requested in Issue #147 (2026-10-02).
Production collection and publication are **not approved**. Issue #124 remains open.
Amends ADR-0007's text-only intake and ADR-0013 decision 14 for an isolated, disabled foundation.

## Decision

Photos are private attachments to an existing report, never canonical data. Report creation and its
existing schema remain unchanged. The attachment uses the existing schema-2 App Attest envelope,
report-purpose challenge and exact-byte signing domain; its strict payload binds report ID, request
UUID, accepted terms version, declared type and image bytes. Different strict payload schemas prevent
an attachment from being interpreted as a report. Only a verified key whose peppered submitter hash
matches the unexpired, unredacted parent may attach. No client hash, dimensions or EXIF coordinate
is trusted. A fresh challenge and assertion authorize every retry; replay protection remains intact.

`photoEvidenceEnabled` is false in public config. No photo storage binding or reviewed photo-consent
version is committed. P5 adds an R2 adapter and fail-closed configuration path, still disabled in every
environment. Test-only constructor injection exercises the technical path; no environment switch
grants rights. Current draft terms do not cover photo processing or publication.
A later maintainer/legal decision must explicitly cover private photo processing under the exact
accepted terms version before production intake. Publication still independently requires #124,
approved source rights and ordinary reconciliation. This ADR grants no legal permission.

## Privacy and validation boundary

Original bytes exist in request memory only. Bounded stream reading precedes JSON/base64 decoding.
Allowlisted JPEG/PNG signatures must match the declared MIME type. The server bounds compressed bytes,
dimensions and decoded pixel count before decoding. Unsupported profiles, malformed/truncated images
and excessive decoded output are refused. JPEG orientation is normalized from transient EXIF orientation;
PNG ancillary metadata never enters persistent storage; PNG with eXIf orientation or tRNS transparency
fails closed rather than silently changing its appearance. Fresh encoding of decoded pixels creates a
deterministic PNG derivative, dropping EXIF, GPS, timestamp, device, text and other original metadata.
Server SHA-256, media type, byte length, width and height describe this derivative only.

Metadata removal does not remove visible faces, number plates or unintended surroundings. Photos stay
private and pending moderation; reviewers must reject sensitive/irrelevant images. The picker reminds
contributors to avoid identifiable people/plates. No automatic redaction claim is made. Photos never
provide spot coordinates or location history. Payloads, decoder errors and image metadata are not logged.

## Storage and lifecycle

Binary data belongs in private object storage, behind `EvidencePhotoStorage` (`put`, metadata lookup,
`delete`), not a D1 BLOB. Tests use an in-memory implementation. No R2 bucket is created, configured,
bound or deployed by this change. Business logic does not call the R2 API. A future adapter must enforce
private access and expiry at the report deadline, including backups and object versions.

The durable `REPORTS_DB` migration stream owns photo references and deletion work; canonical `DB`,
promotion bundles, community artifacts and public tiles carry no photo data. A reservation is committed
before object upload so a crash cannot lose its key. Only sanitized bytes are uploaded. The reservation
has a short upload deadline, then transitions to pending moderation. Explicit approved/rejected states
record a human decision; rejected, abandoned, expired and parent-deleted images enter retryable deletion.
Deleting an attachment enqueues an independent tracking row. Fenced object deletion precedes deleting
that tracking row. The storage delete contract must durably prevent in-flight or future writes from
recreating its key; a plain R2 delete cannot meet it. The memory double retains opaque random-key fences,
with no image hash/report metadata. P5 implements the R2 adapter described below; verified deployment
configuration is still required before intake can be enabled.
Report deletion/redaction preserves deletion work.

At most three attachments per report are allowed. A report-scoped request UUID binds one sanitized
hash; reusing it with different content conflicts. The same sanitized image on one report deterministically
returns the existing attachment. A fresh verified retry may reconcile an uncertain response without
creating a second image. Object-storage failure leaves durable cleanup work; cleanup is bounded and
resumable. A competing request cannot overwrite a different image's object.

The parent's `minimize_after` (received time + 90 days, ADR-0007) is the maximum retention deadline,
irrespective of moderation. Uploading late does not restart that clock. Cleanup also handles orphan
reservations after 15 minutes. Failed deletions stay tracked for retry and must alert operators before
the deadline; enabling intake requires a working deletion scheduler/storage expiry, never backlog-based
permanent retention. The current disabled deployment requires no remote scheduler changes.

## P5 — R2 implementation (2026-10-22; intake remains disabled)

The production adapter uses a dedicated private `PRIVATE_PHOTOS` bucket and live REPORTS_DB
reservations. Sanitized image writes are create-only (`If-None-Match: *`), with R2 checksum validation;
matching retries cannot overwrite content. Deletion overwrites the same key with a permanent empty
marker containing no image/hash/report metadata. Atomic conditional writes cannot overwrite this
marker, even after an uncertain response or process restart. Physical marker deletion, lifecycle rules
that remove markers, other writers and historical-object restoration are incompatible with the fence.

Erasure starts 24 hours before `minimize_after` to allow retries within the 90-day ceiling; the adapter
also refuses access/writes in this early-erasure window. All approval states use the same deadline.
The existing deletion queue is acknowledged only after the marker write succeeds. Separate attempt
count/time diagnostics (REPORTS_DB migration 0007) preserve the existing queue shape and keep failed
keys retryable without starving other selected jobs. Retention dispatch uses that adapter when configured
and reports aggregate failures; no cron is activated here.

The supported storage topology has no photo backups, replication, versions, public delivery or retained
historical copies. `PHOTO_STORAGE_POLICY` attests the reviewed account configuration; it cannot inspect
or guarantee provider-internal media erasure. Those deletion terms, schedule installation, alerts and
capacity remain prerequisites. No current photo consent is approved; the reviewed terms allowlist is
empty. Config and API use the same guard requiring covered terms, storage/policy, cleanup configuration
and App Attest. All photos remain private, even approved ones. See
[PHOTO_STORAGE_OPERATIONS](../PHOTO_STORAGE_OPERATIONS.md) for fence proof, recovery and activation conditions.

## New-spot photo gate (2026-10-22, v1.0)

A new-spot (`missing`) report is received first and its photos follow (`POST /v1/reports/:id/photos`), so an
accepted report can exist without photos: the app closed, an upload failed or was rejected. Intake order is
unchanged. Publication is gated instead: a new-spot review is neither proposed nor exported unless every `missing`
report it rests on has at least one photo that is `ready`, moderator-`approved` and still viewable: at least 24 h (`PHOTO_ERASURE_LEAD_MS`, when R2 erasure may begin) before its `delete_after` and not queued in `community_photo_deletions`
(`newSpotPhotoGate`, `src/reports/photos.ts`). Without an exported review there is no evidence artifact, so no
canonical application, release, tile or promotion bundle can carry the place.

| Photo state of the report | Gate | Effect |
| --- | --- | --- |
| none ever attached | `none` | held: may be accepted and queued, never reviewed |
| reservation inside its upload window | `uploading` | held |
| ready, awaiting the photo moderator | `pending` | held |
| every remaining photo rejected (deleting) | `rejected` | held; the app may attach another photo until the deadline |
| abandoned reservation, cleaned-up attempt, or inside the 24 h erasure lead, or queued for deletion | `expired` | held |
| at least one ready, approved, viewable photo | `approved` | the other review premises decide |

The gate is necessary, never sufficient. It adds no permission to smoke, independence, consent or publication
right; independence, terms, claims, pin, moderation and #124 still apply, and an approved photo of an ashtray is
not permission. Existing-spot reports (`exists`, corrections, findings) never need a photo. A held report is
minimized on its ordinary 90-day clock (ADR-0007) with its photos; nothing is published meanwhile. The check runs
at proposal and again at export; REPORTS_DB migrations 0009 and 0010 (erasure lead + deletion queue, compared with `julianday`) re-check it inside the export batch, so a direct SQL
export is refused too. Photo retries keep their idempotency; the gate reads only stored state. The artifact, DATA_DB,
tiles and promotion bundles carry no photo ID, key, hash or count.

## Evidence and Apple boundary

Approved attachments are an advisory evidence-strength signal for review. They never accept a report,
increase independent-submitter counts, upgrade existence confidence or bypass reconciliation/publication.
An ashtray or ash-disposal equipment is **not permission to smoke**. Public photo retrieval is absent.

The iPhone foundation uses PhotosPicker and in-memory re-encoded previews behind a default-off injected
policy and uploader. Adding/removing a photo, progress, failure and explicit attachment retry preserve
the existing report draft and accepted report ID. Attachment retries do not create a new report. No
photo is written into the durable draft or copied to Watch; no library EXIF coordinate is used. A real
attested network adapter and approved consent are prerequisites for a future production-enabled flow.

Interrupted uploads: once a report with photos is accepted, the app writes one protected file
(`Reports/photo-follow-up.json`: report ID, consent version, estimated upload deadline = `receivedAt` + 89
days, count of photos the server confirmed). It holds no photo bytes, key, challenge or assertion. After a
restart the user may choose photos again for that same report, signed by the same App Attest key; the
report is never resent and no new report can start until the follow-up ends (all sent, server refusal such
as 410/404/403, the user stops, or the deadline passes). Re-chosen photos get new idempotency keys, so a
photo whose earlier upload succeeded without an answer may be stored twice, bounded by the attachment limit.
A saved new-place submission whose answer was lost is retried (same payload and key) only after photos are
chosen again. If the app ends between the report's acceptance and that file being written, the report
reference is lost and photos cannot be re-attached from the app.

## Amendment: private operator viewing

The optional loopback-only MannerPath Admin supplies P6 viewing without temporary photo files or
public/signed URLs. `PrivatePhotoReader` is a read-only adapter, separate from the upload storage
interface: bounded R2 streams are checked against metadata/digest and live retention/deletion fences
before and after retrieval. Bytes exist only in process/browser memory, with authenticated no-store
responses. Only live pending/approved ready photos can be previewed. Explicit per-photo review does
not publish a photo. Admin previews and photo/report approval use the P5 access cutoff at exactly
`delete_after - 24 hours`, not the 90-day ceiling; private reads recheck this cutoff after fetching.
Existing 90-day deadlines, minimization and deletion work remain unchanged.
Local synthetic tests do not establish real R2/staging readiness or production approval. Operator
authentication, startup acknowledgements and limitations are in [local admin operations](../LOCAL_MODERATION_ADMIN.md).

Integration finding closed by PR #323: proposal/export and additive migration 0010 enforce
P5's `delete_after - 24 hours` access cutoff and deletion queue fence. Migration 0009 remains
unchanged. This closes the source-level integration hold; real R2/staging readiness and
production approval remain unverified. Admin approval never bypasses publication gates.

## Consequences

Pinned, pure JavaScript image codecs add bounded decoding/encoding work to Workers. CPU/memory limits
and adversarial corpus testing in the intended Cloudflare plan remain launch prerequisites. This slice
validates local technical behavior; it neither promises face/plate detection nor enables production use.
