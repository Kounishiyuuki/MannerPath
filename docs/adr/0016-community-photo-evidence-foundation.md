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

`photoEvidenceEnabled` is false in public config. The exported Worker has no photo storage binding
or reviewed photo-consent version. Test-only constructor injection exercises the actual technical path;
no environment switch grants rights. Current draft terms do not cover photo processing or publication.
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
with no image hash/report metadata. A real fenced adapter is required before intake can be enabled.
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

## Evidence and Apple boundary

Approved attachments are an advisory evidence-strength signal for review. They never accept a report,
increase independent-submitter counts, upgrade existence confidence or bypass reconciliation/publication.
An ashtray or ash-disposal equipment is **not permission to smoke**. Public photo retrieval is absent.

The iPhone foundation uses PhotosPicker and in-memory re-encoded previews behind a default-off injected
policy and uploader. Adding/removing a photo, progress, failure and explicit attachment retry preserve
the existing report draft and accepted report ID. Attachment retries do not create a new report. No
photo is written into the durable draft or copied to Watch; no library EXIF coordinate is used. A real
attested network adapter and approved consent are prerequisites for a future production-enabled flow.

## Consequences

Pinned, pure JavaScript image codecs add bounded decoding/encoding work to Workers. CPU/memory limits
and adversarial corpus testing in the intended Cloudflare plan remain launch prerequisites. This slice
validates local technical behavior; it neither promises face/plate detection nor enables production use.
