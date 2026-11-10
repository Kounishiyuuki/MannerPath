#!/usr/bin/env python3
"""Cooperative, non-waiting Xcode admission gate shared by this user's worktrees.

Never unlink the lock file: its persistent inode is not evidence of a running owner.
The kernel releases flock only after the last inherited descriptor closes. No PID/age
heuristic may unlock a live workload, including after this supervisor is SIGKILLed.
"""
import fcntl
import json
import os
from pathlib import Path
import signal
import stat
import subprocess
import sys
import time


LOCK_ROOT = Path("/tmp")
LOCK_PATH = LOCK_ROOT / f"mannerpath-apple-workload-{os.getuid()}.lock"
INHERITED_FD = "MANNERPATH_APPLE_WORKLOAD_FD"


def checked_descriptor(fd, path):
    held, named = os.fstat(fd), path.lstat()
    if (not stat.S_ISREG(held.st_mode) or held.st_uid != os.getuid() or held.st_mode & 0o022
            or held.st_nlink != 1 or stat.S_ISLNK(named.st_mode)
            or (held.st_dev, held.st_ino) != (named.st_dev, named.st_ino)):
        raise ValueError("unsafe lock identity")


def run(command):
    fd = None
    child = None
    interrupted = 0
    previous = {}

    def forward(signum, _frame):
        nonlocal interrupted
        interrupted = signum
        if child is not None and child.poll() is None:
            # Only the new session we created, never pgrep results or another lane.
            try:
                os.killpg(child.pid, signum)
            except ProcessLookupError:
                pass

    try:
        inherited = os.environ.get(INHERITED_FD)
        if inherited is not None:
            fd = int(inherited)
            if fd < 3:
                raise ValueError("invalid inherited descriptor")
        else:
            fd = os.open(LOCK_PATH, os.O_CREAT | os.O_RDWR | os.O_NOFOLLOW | os.O_NONBLOCK, 0o600)
        if fd < 3:
            raise ValueError("lock descriptor overlaps standard streams")
        checked_descriptor(fd, LOCK_PATH)
        try:
            fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            print("Another MannerPath Apple workload holds the shared lock; retry after it finishes.", file=sys.stderr)
            return 3
        checked_descriptor(fd, LOCK_PATH)
        # Also reject non-cooperating Xcode/PulseCue builds. Unknown probe state is not idle.
        probe = subprocess.run(["pgrep", "-x", "xcodebuild"], capture_output=True, text=True, timeout=5)
        if probe.returncode == 0:
            print("Another xcodebuild is active; leave it running and retry later.", file=sys.stderr)
            return 3
        if probe.returncode != 1:
            print("Cannot determine whether xcodebuild is active; no workload started.", file=sys.stderr)
            return 3
        if inherited is None:
            metadata = json.dumps({"pid": os.getpid(), "startedAt": time.time()}).encode()
            os.ftruncate(fd, 0)
            os.write(fd, metadata)
        for sig in (signal.SIGINT, signal.SIGTERM, signal.SIGHUP):
            previous[sig] = signal.signal(sig, forward)
        env = dict(os.environ, **{INHERITED_FD: str(fd)})
        if interrupted:
            return 128 + interrupted
        child = subprocess.Popen(command, env=env, pass_fds=(fd,), start_new_session=True)
        if interrupted:
            forward(interrupted, None)
        result = child.wait()
        if interrupted:
            return 128 + interrupted
        return 128 - result if result < 0 else result
    except (OSError, ValueError, subprocess.SubprocessError):
        print("Apple workload admission failed; no lock was removed and no other workload was stopped.", file=sys.stderr)
        return 3
    finally:
        for sig, handler in previous.items():
            signal.signal(sig, handler)
        if fd is not None:
            # Do NOT LOCK_UN: a surviving child may still own this open file description.
            try:
                os.close(fd)
            except OSError:
                pass


def main(args):
    if len(args) >= 2 and args[0] == "--script":
        script = Path(args[1]).resolve(strict=True)
        # Sourcing in a fresh shell avoids a re-entry environment flag. The scripts
        # still run their normal bodies and EXIT cleanup in that child shell.
        command = ["bash", "-c", 'script=$1; shift; source "$script" "$@"',
                   "mannerpath-apple-workload", str(script), *args[2:]]
    elif len(args) >= 2 and args[0] == "--":
        command = args[1:]
    else:
        print("usage: apple-workload-lock.py -- <command> [args...]", file=sys.stderr)
        return 2
    return run(command)


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
