#!/usr/bin/env python3
"""Exercise runner ownership guards without launching Xcode or a Simulator."""
import os
import json
import pathlib
import re
import shutil
import subprocess
import tempfile
import unittest


RUNNER = pathlib.Path(__file__).with_name("run-iphone-ui-tests.sh")
VALIDATOR = pathlib.Path(__file__).with_name("validate-apple.sh")


class UIRunnerSafetyTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = pathlib.Path(self.temp.name)
        scripts = self.root / "scripts"
        scripts.mkdir()
        self.runner = scripts / RUNNER.name
        shutil.copyfile(RUNNER, self.runner)
        self.bin = self.root / "bin"
        self.bin.mkdir()
        self.log = self.root / "calls"
        self.env = dict(os.environ, PATH=str(self.bin) + os.pathsep + os.environ["PATH"],
                        CALL_LOG=str(self.log), MANNERPATH_UI_RESULTS=str(self.root / "results"),
                        ACTIVE_XCODE="0", OCCUPIED_PORT="0", MANNERPATH_UI_PORT="8787")
        self.stub("pgrep", 'if [ "$ACTIVE_XCODE" = 1 ]; then echo 1234; exit 0; fi\nexit 1')
        self.stub("lsof", 'if [ "$OCCUPIED_PORT" = 1 ]; then exit 0; fi\nexit 1')
        for command in ("xcrun", "xcodebuild", "npm", "pkill", "kill"):
            self.stub(command, "exit 97")
        self.stub("sleep", "exit 0")

    def stub(self, name, body):
        path = self.bin / name
        path.write_text('#!/bin/sh\nprintf "%s\\n" "' + name + ' $*" >> "$CALL_LOG"\n' + body + '\n')
        path.chmod(0o755)

    def run_runner(self, **settings):
        return subprocess.run(["bash", str(self.runner)], env=dict(self.env, **settings),
                              capture_output=True, text=True, timeout=5)

    def calls(self):
        return self.log.read_text().splitlines() if self.log.exists() else []

    def test_invalid_ports_stop_before_process_or_simulator_checks(self):
        for port in ("0", "80", "1023", "65536", "99999", "8787x", "-8787", "1+8787", " 8787", "123456"):
            with self.subTest(port=port):
                result = self.run_runner(MANNERPATH_UI_PORT=port)
                self.assertEqual(result.returncode, 2, result.stderr)
                self.assertIn("MANNERPATH_UI_PORT", result.stderr)
                self.assertEqual(self.calls(), [])

    def test_port_boundaries_reach_simulator_guard(self):
        for port in ("1024", "8787", "65535"):
            with self.subTest(port=port):
                self.log.unlink(missing_ok=True)
                result = self.run_runner(MANNERPATH_UI_PORT=port)
                self.assertEqual(result.returncode, 97, result.stderr)
                self.assertEqual(self.calls(), ["pgrep -x xcodebuild",
                                               f"lsof -nP -iTCP:{port} -sTCP:LISTEN",
                                               "xcrun simctl create mannerpath-ui-tests iPhone 17"])

    def test_active_xcodebuild_is_left_running(self):
        result = self.run_runner(ACTIVE_XCODE="1")
        self.assertEqual(result.returncode, 3, result.stderr)
        self.assertIn("Another xcodebuild", result.stderr)
        self.assertEqual(self.calls(), ["pgrep -x xcodebuild"])

    def test_occupied_port_owner_is_left_running(self):
        result = self.run_runner(OCCUPIED_PORT="1", MANNERPATH_UI_PORT="9123")
        self.assertEqual(result.returncode, 3, result.stderr)
        self.assertIn("port is already in use", result.stderr)
        self.assertEqual(self.calls(), ["pgrep -x xcodebuild", "lsof -nP -iTCP:9123 -sTCP:LISTEN"])

    def test_stop_worker_targets_only_tracked_pid_and_is_idempotent(self):
        match = re.search(r"^stop_worker\(\) \{\n.*?^\}", RUNNER.read_text(), re.M | re.S)
        self.assertIsNotNone(match, "Runner must define stop_worker")
        program = '''set -eu
kill_tree() { printf 'kill_tree %s\\n' "$*" >> "$CALL_LOG"; }
kill() { printf 'unexpected kill %s\\n' "$*" >> "$CALL_LOG"; return 97; }
''' + match.group(0) + '''
worker_pid=4242
stop_worker
test -z "$worker_pid"
stop_worker
test -z "$worker_pid"
'''
        result = subprocess.run(["bash", "-c", program], env=self.env,
                                capture_output=True, text=True, timeout=5)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(self.calls(), ["kill_tree 4242", "sleep 2", "sleep 2"])


class AppleValidationOrchestrationTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = pathlib.Path(self.temp.name)
        scripts = self.root / "scripts"
        scripts.mkdir()
        self.validator = scripts / VALIDATOR.name
        shutil.copyfile(VALIDATOR, self.validator)
        self.log = self.root / "calls.jsonl"
        self.env = dict(os.environ, PATH=str(scripts) + os.pathsep + os.environ["PATH"],
                        CALL_LOG=str(self.log), FAIL_STAGE="",
                        MANNERPATH_IOS_DESTINATION="platform=iOS Simulator,id=ios-fixture-uuid",
                        MANNERPATH_WATCH_DESTINATION="platform=watchOS Simulator,id=watch-fixture-uuid")
        # Record argument arrays so destinations and the Watch scheme retain their spaces.
        for name in ("xcodebuild", "check-iphone-api-base-url.sh"):
            stub = scripts / name
            stub.write_text('''#!/usr/bin/env python3
import json
import os
import pathlib
import sys
name = pathlib.Path(sys.argv[0]).name
args = sys.argv[1:]
if name == "xcodebuild":
    scheme = args[args.index("-scheme") + 1]
    stage = "ios-test" if scheme == "MannerPath" else "watch-" + args[0]
else:
    stage = "plist-check"
with open(os.environ["CALL_LOG"], "a") as log:
    log.write(json.dumps([stage, args]) + "\\n")
sys.exit(42 if os.environ["FAIL_STAGE"] == stage else 0)
''')
            stub.chmod(0o755)

    def run_validator(self, stage=""):
        result = subprocess.run(["bash", str(self.validator)],
                                env=dict(self.env, FAIL_STAGE=stage),
                                capture_output=True, text=True, timeout=30)
        calls = [json.loads(line) for line in self.log.read_text().splitlines()]
        return result, calls

    def test_serial_test_build_and_plist_check_order_and_destinations(self):
        result, calls = self.run_validator()
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual([stage for stage, _ in calls],
                         ["ios-test", "watch-test", "watch-build", "plist-check"])
        for index, destination in ((0, self.env["MANNERPATH_IOS_DESTINATION"]),
                                   (1, self.env["MANNERPATH_WATCH_DESTINATION"]),
                                   (2, self.env["MANNERPATH_WATCH_DESTINATION"])):
            args = calls[index][1]
            self.assertEqual(args[args.index("-destination") + 1], destination)
        for _, args in calls[:2]:
            self.assertEqual(args[args.index("-parallel-testing-enabled") + 1], "NO")
        self.assertIn("-only-testing:MannerPathWatch Watch AppTests", calls[1][1])
        self.assertFalse(any(arg.startswith("-only-testing:") for arg in calls[0][1]))
        self.assertEqual(calls[3][1], [])

    def test_failed_stage_stops_all_later_stages(self):
        stages = ["ios-test", "watch-test", "watch-build", "plist-check"]
        for index, stage in enumerate(stages):
            with self.subTest(stage=stage):
                self.log.unlink(missing_ok=True)
                result, calls = self.run_validator(stage)
                self.assertEqual(result.returncode, 42, result.stderr)
                self.assertEqual([name for name, _ in calls], stages[:index + 1])


if __name__ == "__main__":
    unittest.main()
