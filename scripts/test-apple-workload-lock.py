#!/usr/bin/env python3
"""Exercise Apple admission with private locks and lightweight owned subprocesses only."""
import json
import os
from pathlib import Path
import signal
import subprocess
import sys
import tempfile
import time
import unittest


HELPER = Path(__file__).with_name("apple-workload-lock.py")


class AppleWorkloadLockTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="apple lock test ")
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.lock_root = self.root / "private locks"
        self.lock_root.mkdir()
        self.lock = self.lock_root / f"mannerpath-apple-workload-{os.getuid()}.lock"
        self.bin = self.root / "bin"
        self.bin.mkdir()
        self.probe_log = self.root / "probes"
        pgrep = self.bin / "pgrep"
        pgrep.write_text(f"#!{sys.executable}\n" + '''import os, pathlib, sys
with open(os.environ["PROBE_LOG"], "a") as log:
    log.write(" ".join(sys.argv[1:]) + "\\n")
sys.exit(int(os.environ.get("PROBE_EXIT", "1")))
''')
        pgrep.chmod(0o755)
        self.env = dict(os.environ, PATH=str(self.bin) + os.pathsep + os.environ["PATH"],
                        PROBE_LOG=str(self.probe_log), PROBE_EXIT="1")
        self.env.pop("MANNERPATH_APPLE_WORKLOAD_FD", None)
        self.helpers = []
        self.children = []
        self.releases = []
        self.addCleanup(self.stop_owned_children)
        for lane in ("lane one", "lane two"):
            folder = self.root / lane
            folder.mkdir()
            helper = folder / HELPER.name
            source = HELPER.read_text()
            self.assertEqual(source.count('LOCK_ROOT = Path("/tmp")'), 1)
            helper.write_text(source.replace('LOCK_ROOT = Path("/tmp")',
                                             f"LOCK_ROOT = Path({str(self.lock_root)!r})"))
            self.helpers.append(helper)

    def stop_owned_children(self):
        # Release our file-waiting payloads first, including a child orphaned by the crash test.
        for release in self.releases:
            release.touch()
        for child in self.children:
            try:
                child.communicate(timeout=5)
            except subprocess.TimeoutExpired:
                child.terminate()  # Popen owned by this test; never a discovered system PID.
                try:
                    child.communicate(timeout=5)
                except subprocess.TimeoutExpired:
                    child.kill()
                    child.communicate(timeout=5)

    def wait_for(self, condition, message):
        deadline = time.monotonic() + 5
        while time.monotonic() < deadline:
            if condition():
                return
            time.sleep(0.01)
        self.fail(message)

    def args(self, code, lane=0):
        return [sys.executable, str(self.helpers[lane]), "--", sys.executable, "-c", code]

    def invoke(self, code="pass", lane=0, **env):
        return subprocess.run(self.args(code, lane), env=dict(self.env, **env),
                              capture_output=True, text=True, timeout=5)

    def spawn_waiter(self, label, lane=0):
        started, release = self.root / f"{label}.started", self.root / f"{label}.release"
        self.releases.append(release)
        code = f'''import os, pathlib, time
os.fstat(int(os.environ["MANNERPATH_APPLE_WORKLOAD_FD"]))
pathlib.Path({str(started)!r}).touch()
while not pathlib.Path({str(release)!r}).exists(): time.sleep(0.01)
'''
        child = subprocess.Popen(self.args(code, lane), env=self.env,
                                 stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
        self.children.append(child)
        return child, started, release

    def assert_reacquired(self):
        deadline = time.monotonic() + 5
        while True:
            result = self.invoke()
            if result.returncode == 0:
                return
            if time.monotonic() >= deadline:
                self.fail(f"Private lock was not released: {result.stderr}")
            self.assertEqual(result.returncode, 3, result.stderr)
            time.sleep(0.01)

    def test_two_worktree_requests_admit_exactly_one_before_any_xcode_exists(self):
        first, a, release_a = self.spawn_waiter("first", 0)
        second, b, release_b = self.spawn_waiter("second", 1)
        self.wait_for(lambda: a.exists() or b.exists(), "No contender was admitted")
        self.wait_for(lambda: first.poll() == 3 or second.poll() == 3,
                      "The second lane did not reject the held lock")
        self.assertEqual(sum(path.exists() for path in (a, b)), 1)
        winner = first if a.exists() else second
        loser = second if a.exists() else first
        self.assertIsNone(winner.poll())
        self.assertEqual(loser.wait(timeout=5), 3)
        # There is no xcodebuild in this payload, just as between real runner phases.
        self.assertEqual(self.invoke(lane=1).returncode, 3)
        self.assertEqual(self.probe_log.read_text().splitlines(), ["-x xcodebuild"])
        release_a.touch()
        release_b.touch()
        self.assertEqual(winner.wait(timeout=5), 0)
        self.assert_reacquired()

    def test_existing_build_or_unknown_probe_never_starts_the_payload(self):
        marker = self.root / "must-not-start"
        for status in ("0", "2", "3"):
            with self.subTest(probe_status=status):
                result = self.invoke(f"from pathlib import Path; Path({str(marker)!r}).touch()",
                                     PROBE_EXIT=status)
                self.assertEqual(result.returncode, 3, result.stderr)
                self.assertFalse(marker.exists())
        self.assert_reacquired()

    def test_stale_metadata_is_reused_without_unlink_or_age_based_unlock(self):
        self.lock.write_text(json.dumps({"pid": 99999999, "startedAt": 0}))
        os.utime(self.lock, (1, 1))
        inode = self.lock.stat().st_ino
        self.assertEqual(self.invoke().returncode, 0)
        self.assertEqual(self.lock.stat().st_ino, inode)
        self.assertNotEqual(json.loads(self.lock.read_text())["pid"], 99999999)
        owner, started, release = self.spawn_waiter("old-but-live")
        self.wait_for(started.exists, "Owned payload did not start")
        os.utime(self.lock, (1, 1))
        self.assertEqual(self.invoke(lane=1).returncode, 3)
        self.assertIsNone(owner.poll())
        release.touch()
        self.assertEqual(owner.wait(timeout=5), 0)

    def test_failed_command_releases_lock_and_preserves_its_inode(self):
        result = self.invoke("raise SystemExit(42)")
        self.assertEqual(result.returncode, 42, result.stderr)
        inode = self.lock.stat().st_ino
        self.assert_reacquired()
        self.assertEqual(self.lock.stat().st_ino, inode)

    def test_nested_helper_reuses_inherited_descriptor(self):
        marker = self.root / "nested started"
        nested = [sys.executable, str(self.helpers[1]), "--", sys.executable, "-c",
                  f"from pathlib import Path; Path({str(marker)!r}).touch()"]
        code = f'''import os, subprocess
result = subprocess.run({nested!r}, pass_fds=(int(os.environ["MANNERPATH_APPLE_WORKLOAD_FD"]),))
raise SystemExit(result.returncode)
'''
        result = self.invoke(code)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertTrue(marker.exists())
        self.assertEqual(self.probe_log.read_text().splitlines(), ["-x xcodebuild", "-x xcodebuild"])
        self.assert_reacquired()

    def test_killed_supervisor_does_not_unlock_a_surviving_owned_child(self):
        owner, started, release = self.spawn_waiter("orphan")
        self.wait_for(started.exists, "Owned child did not start")
        owner.kill()  # SIGKILL only the supervisor Popen created by this test.
        self.assertEqual(owner.wait(timeout=5), -signal.SIGKILL)
        self.assertEqual(self.invoke(lane=1).returncode, 3)
        release.touch()
        self.assert_reacquired()
        owner.communicate(timeout=5)

    def test_term_stops_only_its_owned_session_and_releases_lock(self):
        unrelated_release = self.root / "unrelated.release"
        self.releases.append(unrelated_release)
        unrelated = subprocess.Popen([sys.executable, "-c", f'''import pathlib, time
while not pathlib.Path({str(unrelated_release)!r}).exists(): time.sleep(0.01)
'''], env=self.env)
        self.children.append(unrelated)
        owner, started, _ = self.spawn_waiter("terminated")
        self.wait_for(started.exists, "Owned payload did not start")
        owner.terminate()
        self.assertEqual(owner.wait(timeout=5), 128 + signal.SIGTERM)
        self.assertIsNone(unrelated.poll(), "An unrelated mock process was stopped")
        self.assert_reacquired()

    def test_invalid_inherited_descriptor_fails_closed(self):
        for descriptor in ("not-a-number", "0", "99999"):
            with self.subTest(descriptor=descriptor):
                result = self.invoke(MANNERPATH_APPLE_WORKLOAD_FD=descriptor)
                self.assertEqual(result.returncode, 3, result.stderr)
        self.assertFalse(self.probe_log.exists())

    def test_symlink_lock_is_neither_followed_nor_deleted(self):
        target = self.root / "untouched"
        target.write_text("keep")
        self.lock.symlink_to(target)
        result = self.invoke()
        self.assertEqual(result.returncode, 3, result.stderr)
        self.assertTrue(self.lock.is_symlink())
        self.assertEqual(target.read_text(), "keep")
        self.assertFalse(self.probe_log.exists())

    def test_shared_writable_or_hardlinked_lock_fails_closed(self):
        self.lock.write_text("keep")
        self.lock.chmod(0o666)
        self.assertEqual(self.invoke().returncode, 3)
        self.lock.chmod(0o600)
        alias = self.root / "second-name"
        os.link(self.lock, alias)
        self.assertEqual(self.invoke().returncode, 3)
        self.assertEqual(self.lock.read_text(), "keep")
        self.assertEqual(alias.read_text(), "keep")
        self.assertFalse(self.probe_log.exists())


if __name__ == "__main__":
    unittest.main()
