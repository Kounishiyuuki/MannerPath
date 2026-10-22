# Private photo storage — P5

The R2 adapter is implemented; production intake is **OFF**. This change creates no bucket,
binding, schedule or deployment and grants no consent. Public API shapes and signing bytes are unchanged.
All photos, including approved attachments, remain private. No public URL, presigned URL, body-read
endpoint, cache, canonical DB field, promotion field or tile field is added.

## Storage and fence

`R2EvidencePhotoStorage` implements `EvidencePhotoStorage`. A future `PRIVATE_PHOTOS` binding must
point at a dedicated private bucket, never `RAW_ARTIFACTS`. The adapter checks the live REPORTS_DB
reservation, parent, lifecycle, upload deadline, deletion queue, derivative hash/size/dimensions and
retention. Only the existing server-sanitized PNG crosses this boundary. Original EXIF/GPS/device/time/
text metadata, filenames and report/submitter IDs are not stored in R2 metadata.

Every image PUT uses `If-None-Match: *` and SHA-256 integrity validation. An existing matching image
is an idempotent success only while its reservation remains live. Different objects and deletion
markers are conflicts. Failed/uncertain PUTs retain their pre-committed D1 reservations.

`delete()` **replaces** the same R2 key with an empty object and fixed `deleted-photo.v1` metadata.
This overwrites the photo body and all its hash/dimensions/expiry metadata. The remaining marker has
only an opaque random key and fixed type. It is the durable fence, survives Worker restarts, and is
never physically deleted. It also works when deletion precedes the original PUT. R2 evaluates the
condition atomically at commit; a delayed create-only PUT cannot replace the marker. No Durable Object
or additional production dependency is needed.

References: [R2 atomic conditional writes](https://developers.cloudflare.com/r2/api/s3/extensions/#conditional-operations-in-putobject),
[Workers conditional API](https://developers.cloudflare.com/r2/api/workers/workers-api-reference/#conditional-operations),
[R2 consistency](https://developers.cloudflare.com/r2/reference/consistency/).

Never remove markers, expire them with lifecycle rules, or restore old objects over them. Plain R2
DELETE, an independent fence key, and check-then-PUT cannot substitute for this protocol. The bucket
must be exclusive to this adapter: no unconditional photo writers, multipart uploads or copying.

## Retention, failures and diagnostics

The immutable `delete_after` remains the parent's `minimize_after` (receipt + 90 days), not upload time.
Erasure starts **24 hours earlier**, including approved photos, to leave a retry/alert window. The
adapter refuses PUT/metadata access in that final day; retries do not extend a deadline. Abandoned
15-minute reservations, rejection, parent redaction/deletion and expiry enter the existing durable
`community_photo_deletions` queue. Parent removal never removes that queue.

Retention dispatch passes the configured adapter to bounded cleanup. With R2 configured a pass handles
at most five photos/jobs to reserve the Free-plan subrequest budget; backlogs require additional passes.
A job is acknowledged only after marker PUT succeeds.
Lost acknowledgements retain the job; another marker overwrite is safe. One failed key does not stop
other selected keys. REPORTS_DB migration `0007_photo_deletion_attempts.sql` records attempt count/time,
with no content or raw errors. Ordering retries by last attempt prevents head-of-line starvation.
Successful acknowledgement removes these transient diagnostics; the R2 fence remains permanently.

`reportRetention` logs contain aggregate counts and fixed outcomes only. `pendingPhotoCleanup` includes
the early erasure window, abandoned uploads and queued failures. Failed/unfinished work fails the Cron.
Monitor non-complete outcomes, queue growth and oldest failed attempt; alert on the first failure.
Pausing intake must never pause deletion. A failed R2 response or missing DB is not successful erasure.
The 24-hour buffer is not an outage-proof physical deletion SLA: validate throughput, schedule, alert
delivery and provider assurances before collecting any photos.

## Backups, versions and recovery

The supported topology is **one live copy, no historical photo copies**. Exclude this bucket from
backup jobs, replication, Sippy/migration copies, exports, version-history tools, retention locks,
public domains/r2.dev, access logs containing object identifiers, and downstream image/CDN services.
Never copy photo bytes into D1, operator exports or monitoring. REPORTS_DB backups contain references,
not images; restoring D1 cannot undo an R2 marker. Keep the photo bucket unchanged through data
blue/green and Worker rollback. Never restore deleted photos or roll the bucket back with D1.

`PHOTO_STORAGE_POLICY=private-no-copies-permanent-fences.v1` is an **operational attestation**, not an
account-settings API check. Code cannot prove an administrator has not enabled public access or an
out-of-band copy. Set it only after recording the above configuration and reviewing Cloudflare's
contractual deletion/durability terms, including internal redundancy/backups and deletion windows.
Active-object overwrite is verified here; physical media/provider-internal erasure within 90 days is
not established by these tests. If a provider or existing copy cannot meet the ceiling, leave intake
disabled. A later backup/version destination requires its own erasure protocol and reviewed change.

Recovery keeps the existing bucket and markers, leaves intake OFF, restores/migrates only the report
store as necessary, then runs cleanup until expired/abandoned/queued work is drained. An uncertain
marker acknowledgement retains its D1 job. An absent object never proves an in-flight PUT failed.
Never purge markers as “empty objects”.

## Remaining activation work — separate maintainer change

1. Approve an exact photo-processing consent version, register it in `REVIEWED_PHOTO_TERMS`, and ship
   matching iPhone terms. The list is empty; environment flags cannot approve draft terms.
2. Provision/review a dedicated private R2 bucket; later add `PRIVATE_PHOTOS` per environment. Verify
   privacy, exclusive writers, no historical copies/locks, permanent markers and provider terms.
   This PR commits no photo R2 binding.
3. Apply REPORTS_DB migrations only, including 0003 and 0007, after resolving existing report-store
   migration readiness requirements. Canonical DB/migrations/promotion remain separate.
4. Configure App Attest app ID/environment/build allowlist and submitter pepper, then test on device.
5. Validate cleanup capacity/alerts. Set `REPORT_RETENTION=cleanup`,
   `REPORT_RETENTION_CRON=*/5 * * * *` and install that real Cron trigger. Intake requires this exact
   frequency but cannot verify trigger installation. No scheduler is activated in this PR.
6. Record the storage-policy attestation before considering `PHOTO_EVIDENCE=on`. Config and route
   share the same derivation: missing storage, policy, covered terms, scheduler configuration or App
   Attest disables intake. Photo publication needs a separate decision and retrieval implementation.
