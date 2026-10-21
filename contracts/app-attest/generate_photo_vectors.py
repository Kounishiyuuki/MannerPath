# Independent generator (Python stdlib) for the attested evidence-photo upload payload (docs/API.md
# "Private photo attachment foundation"). The iPhone uploader and the Worker tests both pin these bytes.
# Output is committed and frozen; run
# `python3 contracts/app-attest/generate_photo_vectors.py > contracts/app-attest/photo-upload-vectors.v1.json` only to add cases.
import base64, json

# An 8x8 baseline JPEG carrying an EXIF segment (sips output): the server, not the client, is the metadata gate.
JPEG = base64.b64decode("/9j/4AAQSkZJRgABAQAASABIAAD/4QBMRXhpZgAATU0AKgAAAAgAAYdpAAQAAAABAAAAGgAAAAAAA6ABAAMAAAABAAEAAKACAAQAAAABAAAACKADAAQAAAABAAAACAAAAAD/7QA4UGhvdG9zaG9wIDMuMAA4QklNBAQAAAAAAAA4QklNBCUAAAAAABDUHYzZjwCyBOmACZjs+EJ+/8AAEQgACAAIAwEiAAIRAQMRAf/EAB8AAAEFAQEBAQEBAAAAAAAAAAABAgMEBQYHCAkKC//EALUQAAIBAwMCBAMFBQQEAAABfQECAwAEEQUSITFBBhNRYQcicRQygZGhCCNCscEVUtHwJDNicoIJChYXGBkaJSYnKCkqNDU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6g4SFhoeIiYqSk5SVlpeYmZqio6Slpqeoqaqys7S1tre4ubrCw8TFxsfIycrS09TV1tfY2drh4uPk5ebn6Onq8fLz9PX29/j5+v/EAB8BAAMBAQEBAQEBAQEAAAAAAAABAgMEBQYHCAkKC//EALURAAIBAgQEAwQHBQQEAAECdwABAgMRBAUhMQYSQVEHYXETIjKBCBRCkaGxwQkjM1LwFWJy0QoWJDThJfEXGBkaJicoKSo1Njc4OTpDREVGR0hJSlNUVVZXWFlaY2RlZmdoaWpzdHV2d3h5eoKDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uLj5OXm5+jp6vLz9PX29/j5+v/bAEMAAgICAgICAwICAwUDAwMFBgUFBQUGCAYGBgYGCAoICAgICAgKCgoKCgoKCgwMDAwMDA4ODg4ODw8PDw8PDw8PD//bAEMBAgICBAQEBwQEBxALCQsQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEP/dAAQAAf/aAAwDAQACEQMRAD8A3KKKK/is/rw//9k=")

def payload(report_id, key, terms):
    value = {"schemaVersion": 2, "reportId": report_id, "idempotencyKey": key, "acceptedTermsVersion": terms,
             "mediaType": "image/jpeg", "image": base64.b64encode(JPEG).decode()}
    # Sorted keys, no whitespace, slashes unescaped: the client's exact encoding of the signed bytes.
    return json.dumps(value, sort_keys=True, separators=(",", ":")).encode()

cases = []
for name, report_id, key, terms in [
    ("photo-payload-basic", "rp_01V64NN31G72E5KJJ5W22W1A1J", "3f2b8c1e-4d5a-4b6c-8d7e-9f0a1b2c3d4e", "report-terms.2026-09-30.draft"),
]:
    p = payload(report_id, key, terms)
    cases.append({"name": name, "reportId": report_id, "idempotencyKey": key, "acceptedTermsVersion": terms,
                  "jpegBase64": base64.b64encode(JPEG).decode(), "payloadUtf8": p.decode(), "payloadBase64": base64.b64encode(p).decode()})
print(json.dumps({"contract": "mannerpath-photo-upload-vectors", "version": 1, "cases": cases}, indent=2))
