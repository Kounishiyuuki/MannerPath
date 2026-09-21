# Independent generator (Python stdlib) for the App Attest client-data vectors (docs/API.md
# "App Attest client data", ADR-0007 §6). Output is committed and frozen;
# run `python3 contracts/app-attest/generate_vectors.py > contracts/app-attest/client-data-vectors.v1.json` only to add cases.
import base64, hashlib, json, struct

REGISTRATION = b"mannerpath.app-attest.registration.v1"
REPORT = b"mannerpath.app-attest.report.v1"

def frame(parts):
    return b"".join(struct.pack(">I", len(p)) + p for p in parts)

challenge = bytes(range(32))
key_id = base64.b64decode("zgSY9YSD+7TaDXssY6WlOPVS1K3Lmk+pFhlcSWE+ZV0=")  # Apple's documentation sample key ID
cases = []

def add(name, domain, payload=None, note=None):
    parts = [domain, challenge, key_id] + ([payload] if payload is not None else [])
    client_data = frame(parts)
    c = {
        "name": name,
        "domain": domain.decode(),
        "challengeBase64": base64.b64encode(challenge).decode(),
        "keyIdBase64": base64.b64encode(key_id).decode(),
    }
    if payload is not None:
        c["payloadUtf8"] = payload.decode("utf-8")
        c["payloadBase64"] = base64.b64encode(payload).decode()
    c["clientDataHex"] = client_data.hex()
    c["clientDataHashHex"] = hashlib.sha256(client_data).hexdigest()
    c["clientDataHashBase64"] = base64.b64encode(hashlib.sha256(client_data).digest()).decode()
    if note:
        c["note"] = note
    cases.append(c)

EXISTS = '{"schemaVersion":2,"type":"exists","spotId":"sp_01V64NN31G72E5KJJ5W22W1A1J","installId":"8f1c4d2e-0a3b-4c5d-8e9f-0a1b2c3d4e5f"}'
add("registration", REGISTRATION, note="attestKey clientDataHash for POST /v1/app-attest/keys")
add("report exists", REPORT, EXISTS.encode())
add("report moved with a non-ASCII note", REPORT,
    '{"schemaVersion":2,"type":"moved","spotId":"sp_01V64NN31G72E5KJJ5W22W1A1J","proposedLocation":{"latitude":35.7112,"longitude":139.77377},"observedOn":"2026-09-19","note":"10mほど北に移設されていました","installId":"8f1c4d2e-0a3b-4c5d-8e9f-0a1b2c3d4e5f"}'.encode(),
    note="the payload is framed as its UTF-8 bytes, not as characters or UTF-16 units")
add("report exists, keys reordered", REPORT,
    '{"type":"exists","schemaVersion":2,"spotId":"sp_01V64NN31G72E5KJJ5W22W1A1J","installId":"8f1c4d2e-0a3b-4c5d-8e9f-0a1b2c3d4e5f"}'.encode(),
    note="the same report with a different key order is different bytes and a different hash: bytes, not meaning, are bound")
add("report exists, trailing newline", REPORT, (EXISTS + "\n").encode(),
    note="one extra byte is a different hash; the server hashes exactly the bytes it receives")

print(json.dumps({
    "contract": "mannerpath-app-attest-client-data-vectors",
    "version": 1,
    "rules": [
        "frame(x) = uint32 big-endian byte length of x, followed by x.",
        "clientData = frame(domain UTF-8) || frame(challenge, 32 raw bytes) || frame(keyId, 32 raw bytes) [|| frame(payload bytes)].",
        "Registration: domain mannerpath.app-attest.registration.v1, no payload. Report: domain mannerpath.app-attest.report.v1, payload = the exact bytes sent base64-encoded in the submission's payload field.",
        "clientDataHash = SHA-256(clientData); pass it to DCAppAttestService attestKey / generateAssertion.",
        "challenge and keyId travel as standard padded base64 and are framed as their decoded 32 bytes, never as text.",
    ],
    "cases": cases,
}, ensure_ascii=False, indent=2))
