#!/usr/bin/env python3
"""Offline, value-redacting scan of tracked files, reachable git blobs or a Release app.

Heuristic detection is an additional gate, not proof that every possible secret is absent.
Never print matched bytes; a suspect requires human classification and rotation if real.
"""
import argparse
import math
from pathlib import Path
import plistlib
import re
import subprocess


PATTERNS = {
    "private-key": rb"-----BEGIN (?:RSA |EC |OPENSSH |ENCRYPTED )?PRIVATE KEY-----",
    "aws-access-key": rb"\b(?:AKIA|ASIA)[A-Z0-9]{16}\b",
    "github-token": rb"\b(?:gh[pousr]_[A-Za-z0-9]{36,255}|github_pat_[A-Za-z0-9_]{60,255})\b",
    "provider-api-key": rb"\b(?:AIza[A-Za-z0-9_-]{35}|sk_(?:live|test)_[A-Za-z0-9]{20,}|sk-(?:proj|ant)-[A-Za-z0-9_-]{20,}|xox[bp]-[A-Za-z0-9-]{20,})\b",
    "jwt": rb"\beyJ[A-Za-z0-9_-]{5,}\.eyJ[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{8,}\b",
}
# Quoted JSON/JS keys, YAML/env/shell/Swift assignments, and header literals.
ASSIGNMENT = re.compile(
    rb"(?<![A-Za-z0-9_-])([A-Za-z_][A-Za-z0-9_-]{0,127})[\"']?(?:[ \t]*:[ \t]*(?:String|NSString|string)[ \t]*)?[ \t]*[:=][ \t]*[\"']?([A-Za-z0-9+/=_-]{16,})(?=[\"'\s,;\x00]|$)"
)
QUOTED_ASSIGNMENT = re.compile(
    rb"(?<![A-Za-z0-9_-])([A-Za-z_][A-Za-z0-9_-]{0,127})[\"']?(?:[ \t]*:[ \t]*(?:String|NSString|string)[ \t]*)?[ \t]*[:=][ \t]*([\"'])([^\r\n\x00]{1,4096}?)\2"
)
YAML_BLOCK = re.compile(
    rb"(?m)^[ \t]*([A-Za-z_][A-Za-z0-9_-]{0,127}):[ \t]*[|>][+-]?[ \t]*\r?\n[ \t]+([^\r\n]{1,4096})"
)
LINE_ASSIGNMENT = re.compile(
    rb"(?m)^[ \t]*(?:export[ \t]+)?([A-Za-z_][A-Za-z0-9_-]{0,127})[ \t]*[:=][ \t]*([^\s\"'(){};]{16,})[ \t]*(?:[#].*)?$"
)
SECRET_NAME = re.compile(rb"(?i)secret|pepper|password|credential|api[_-]?key|access[_-]?key|token|authorization|bearer|private[_-]?key")
PUBLIC_NAME = re.compile(rb"(?i)^(?:MANNERPATH_API_BASE_URL|MANNERPATH_PUBLIC_SITE_URL|database_id|bundle_?id|CFBundleIdentifier|sha256|etag|uuid|app_?id|application-identifier)$")
BEARER = re.compile(rb"(?i)authorization[\"']?\s*[:=]\s*[\"']?Bearer\s+([A-Za-z0-9._~+/-]+=*)")


def secretish_name(key):
    raw = key.encode() if isinstance(key, str) else key
    return bool(SECRET_NAME.search(raw) and not PUBLIC_NAME.fullmatch(raw))


def credential_value(value):
    if len(value) < 16:
        return False
    # Explicit examples and variable references are not embedded credentials.
    if value in (b"test-pepper-value-not-a-real-secret", b"change-me-before-production", b"replace-with-your-secret") or value.startswith((b"$", b"<")):
        return False
    if re.fullmatch(rb"[0-9a-fA-F]{16,}", value):
        return True
    entropy = -sum((value.count(c) / len(value)) * math.log2(value.count(c) / len(value)) for c in set(value))
    return entropy >= 3.5


def structured_secret_types(value):
    """Walk decoded plists/JSON without flattening away credential key context."""
    found = set()
    if isinstance(value, dict):
        for key, child in value.items():
            if isinstance(child, (str, bytes)) and secretish_name(str(key)):
                raw = child.encode() if isinstance(child, str) else child
                if credential_value(raw):
                    found.add("credential-assignment")
                if str(key).lower() == "authorization" and re.fullmatch(rb"(?i)Bearer[ \t]+[A-Za-z0-9._~+/-]{6,}=*", raw):
                    found.add("authorization-bearer")
            found.update(structured_secret_types(child))
    elif isinstance(value, (list, tuple)):
        for child in value:
            found.update(structured_secret_types(child))
    elif isinstance(value, (str, bytes)):
        found.update(secret_types(value.encode() if isinstance(value, str) else value, structured=False))
    return sorted(found)


def secret_types(data, structured=True):
    found = {kind for kind, pattern in PATTERNS.items() if re.search(pattern, data)}
    for key, value in ASSIGNMENT.findall(data):
        if secretish_name(key) and not re.fullmatch(rb"[A-Za-z_]+", value) and credential_value(value):
            found.add("credential-assignment")
    for key, _, value in QUOTED_ASSIGNMENT.findall(data):
        if secretish_name(key) and not re.search(rb"[\"'][ \t]*\+[ \t]*b?[\"']", value) and credential_value(value):
            found.add("credential-assignment")
    for key, value in LINE_ASSIGNMENT.findall(data):
        if secretish_name(key) and credential_value(value):
            found.add("credential-assignment")
    for key, value in YAML_BLOCK.findall(data):
        if secretish_name(key) and credential_value(value.strip()):
            found.add("credential-assignment")
    if any(len(value) >= 6 and value.lower() not in (b"placeholder", b"example", b"your-token", b"token") and not value.startswith(b"$") for value in BEARER.findall(data)):
        found.add("authorization-bearer")
    if structured:
        # Binary and XML plists contain non-adjacent keys and values.
        if data.startswith(b"bplist") or b"<plist" in data[:512]:
            try:
                found.update(structured_secret_types(plistlib.loads(data)))
            except (ValueError, plistlib.InvalidFileException, OverflowError):
                pass
        elif data.lstrip().startswith((b"{", b"[")):
            import json
            try:
                found.update(structured_secret_types(json.loads(data)))
            except (ValueError, UnicodeDecodeError):
                pass
    return sorted(found)


def git(*args):
    return subprocess.check_output(["git", *args])


def report(path, revision, kind):
    print(f"SECRET_LEAK_SUSPECTED path={path} commit={revision} secret_type={kind}")


def credential_path(path):
    return (bool(re.search(r"(^|/)(\.env(?:\..*)?|\.dev\.vars(?:\..*)?|[^/]+\.(?:p8|p12|pfx|key))$", str(path)))
            and not str(path).endswith((".example", ".sample")))


def safe_origin(value):
    from urllib.parse import urlsplit
    try:
        url = urlsplit(value)
        return bool(url.scheme == "https" and url.hostname
                    and url.hostname not in ("localhost", "127.0.0.1", "::1", "0.0.0.0")
                    and not (url.username or url.password or url.query or url.fragment))
    except (ValueError, TypeError, AttributeError):
        # URL parser exceptions can include credential-bearing netloc text. Never print them.
        return False


def scan_repository(history=False):
    failures = 0
    paths = git("ls-files", "-z").split(b"\0")
    for raw in filter(None, paths):
        path = Path(raw.decode())
        if path.is_file():
            for kind in secret_types(path.read_bytes()):
                report(path, "WORKTREE", kind)
                failures += 1
        # Example env files are still scanned above, but may carry placeholders.
        if credential_path(path):
            report(path, "WORKTREE", "credential-file")
            failures += 1
    blobs = 0
    if history:
        objects = git("rev-list", "--objects", "--all").decode().splitlines()
        proc = subprocess.Popen(["git", "cat-file", "--batch"], stdin=subprocess.PIPE, stdout=subprocess.PIPE)
        for item in objects:
            oid, _, path = item.partition(" ")
            proc.stdin.write((oid + "\n").encode())
            proc.stdin.flush()
            header = proc.stdout.readline().decode().split()
            data = proc.stdout.read(int(header[2]))
            proc.stdout.read(1)
            if header[1] != "blob":
                continue
            blobs += 1
            for kind in secret_types(data) + (["credential-file"] if credential_path(path) else []):
                commit = git("log", "--all", "-1", "--format=%H", f"--find-object={oid}").decode().strip()
                report(path, commit, kind)
                failures += 1
        proc.stdin.close()
        proc.wait()
        proc.stdout.close()
    if history and blobs == 0:
        print("Secret history scan: no reachable blobs; BLOCK")
        failures += 1
    print(f"Secret scan: tracked_files={len(list(filter(None, paths)))} reachable_blobs={blobs} suspects={failures}")
    return failures


def scan_artifact(root):
    failures = 0
    try:
        info = plistlib.loads((root / "Info.plist").read_bytes())
        executable = info.get("CFBundleExecutable") if isinstance(info, dict) else None
        if not isinstance(executable, str) or not executable or Path(executable).name != executable or not (root / executable).is_file():
            raise ValueError("missing executable")
    except (OSError, ValueError, plistlib.InvalidFileException):
        print("Release artifact scan: invalid app root, Info.plist or executable; BLOCK")
        return 1
    files = [p for p in root.rglob("*") if p.is_file() and not p.is_symlink()]
    for path in files:
        data = path.read_bytes()
        for kind in secret_types(data):
            report(path.relative_to(root), "ARTIFACT", kind)
            failures += 1
    print(f"Release artifact scan: files={len(files)} suspects={failures}")
    return failures


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--history", action="store_true", help="scan every blob reachable from local refs")
    parser.add_argument("--artifact", type=Path, help="scan extracted Release .app including embedded bundles")
    args = parser.parse_args()
    raise SystemExit(bool(scan_artifact(args.artifact) if args.artifact else scan_repository(args.history)))
