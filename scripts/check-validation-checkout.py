#!/usr/bin/env python3
"""Check checkout identity/cleanliness; this is not a test-success attestation.

CI uses GitHub's event SHA (the PR merge SHA, not the PR head SHA). Local
validation must explicitly name its reviewed commit. Never print file contents,
dirty paths, event bodies or credential-bearing environment variables.
"""
import argparse
import json
import os
from pathlib import Path
import re
import subprocess
import sys


SHA = re.compile(r"[0-9a-f]{40}")


def git(*args):
    return subprocess.run(["git", *args], check=True, capture_output=True).stdout.decode().strip()


def verify(expected, pr_head=None):
    if not isinstance(expected, str) or not SHA.fullmatch(expected):
        raise ValueError("expected commit required")
    if pr_head is not None and (not isinstance(pr_head, str) or not SHA.fullmatch(pr_head)):
        raise ValueError("invalid PR head")
    # Always examine the whole checkout, even if a local caller is in a subdirectory.
    root = git("rev-parse", "--show-toplevel")
    actual = git("rev-parse", "HEAD")
    tree = git("rev-parse", "HEAD^{tree}")
    dirty = bool(git("-C", root, "status", "--porcelain=v1", "--untracked-files=all"))
    includes_pr = pr_head is None or subprocess.run(
        ["git", "merge-base", "--is-ancestor", pr_head, actual],
        stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL).returncode == 0
    return {"checkoutVerified": actual == expected and not dirty and includes_pr,
            "expectedCommit": expected, "checkoutCommit": actual, "tree": tree,
            "prHeadCommit": pr_head, "clean": not dirty, "includesPrHead": includes_pr}


def main(args):
    parser = argparse.ArgumentParser(description=__doc__)
    mode = parser.add_mutually_exclusive_group(required=True)
    mode.add_argument("--ci", action="store_true")
    mode.add_argument("--commit")
    options = parser.parse_args(args)
    try:
        expected, pr_head = options.commit, None
        if options.ci:
            expected = os.environ.get("GITHUB_SHA")
            event = os.environ.get("GITHUB_EVENT_NAME")
            payload = json.loads(Path(os.environ["GITHUB_EVENT_PATH"]).read_text())
            if not isinstance(payload, dict):
                raise ValueError("invalid event object")
            if event == "pull_request":
                pr_head = payload["pull_request"]["head"]["sha"]
                if not isinstance(pr_head, str) or not SHA.fullmatch(pr_head):
                    raise ValueError("missing PR head")
            elif event != "push" or payload.get("after") != expected:
                raise ValueError("unsupported or inconsistent event")
        report = verify(expected, pr_head)
        print(json.dumps(report, sort_keys=True))
        return 0 if report["checkoutVerified"] else 1
    except (OSError, ValueError, KeyError, TypeError, subprocess.SubprocessError):
        print("Checkout identity could not be verified; no validation success implied.", file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
