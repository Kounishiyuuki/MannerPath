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
    "provider-api-key": rb"\b(?:AIza[A-Za-z0-9_-]{35}|sk_live_[A-Za-z0-9]{20,})\b",
}
ASSIGNMENT = re.compile(
    rb"\b([A-Za-z_][A-Za-z0-9_]{0,127})[\"']?\s*[:=]\s*[\"']?([A-Za-z0-9+/=_-]{16,})"
)
SECRET_NAME = re.compile(rb"(?i)secret|pepper|password|credential|api_?key|access_?key|token|authorization|bearer|private_?key")


def secret_types(data):
    found = {kind for kind, pattern in PATTERNS.items() if re.search(pattern, data)}
    for key, value in ASSIGNMENT.findall(data):
        if not SECRET_NAME.search(key):
            continue
        entropy = -sum((value.count(c) / len(value)) * math.log2(value.count(c) / len(value)) for c in set(value))
        if entropy >= 3.8:
            found.add("credential-assignment")
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
        # Only actual URL literals; SDK symbol names containing 'localhost' are not credentials.
        if re.search(rb"https?://(?:localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\])(?=[:/\x00\s]|$)", data):
            report(path.relative_to(root), "ARTIFACT", "debug-origin")
            failures += 1
        if path.name == "Info.plist":
            info = plistlib.loads(data)
            if info.get("NSAppTransportSecurity"):
                report(path.relative_to(root), "ARTIFACT", "ATS-exception-review-required")
                failures += 1
            for key in ("MannerPathAPIBaseURL", "MannerPathPublicSiteURL"):
                if key in info:
                    if not safe_origin(info[key]):
                        report(path.relative_to(root), "ARTIFACT", "unsafe-public-origin")
                        failures += 1
    print(f"Release artifact scan: files={len(files)} suspects={failures}")
    return failures


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--history", action="store_true", help="scan every blob reachable from local refs")
    parser.add_argument("--artifact", type=Path, help="scan extracted Release .app including embedded bundles")
    args = parser.parse_args()
    raise SystemExit(bool(scan_artifact(args.artifact) if args.artifact else scan_repository(args.history)))
