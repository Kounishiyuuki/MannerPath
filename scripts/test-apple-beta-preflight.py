#!/usr/bin/env python3
import importlib.util
import pathlib
import plistlib
import tempfile
import unittest
from unittest.mock import patch
from contextlib import redirect_stdout
from io import StringIO

SCRIPT = pathlib.Path(__file__).with_name("check-apple-beta-artifact.py")
spec = importlib.util.spec_from_file_location("preflight", SCRIPT)
preflight = importlib.util.module_from_spec(spec)
spec.loader.exec_module(preflight)


class PreflightTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.app = pathlib.Path(self.temp.name) / "MannerPath.app"
        self.paths = [self.app,
                      self.app / "PlugIns/MannerPathWidgets.appex",
                      self.app / "Watch/MannerPathWatch Watch App.app",
                      self.app / "Watch/MannerPathWatch Watch App.app/PlugIns/MannerPathWatchWidgets.appex"]
        for (label, identifier), path in zip(preflight.IDS.items(), self.paths):
            path.mkdir(parents=True)
            info = {"CFBundleIdentifier": identifier, "CFBundleVersion": "42"}
            if label == "iPhone app":
                info["MannerPathAPIBaseURL"] = "https://example.invalid"
            (path / "Info.plist").write_bytes(plistlib.dumps(info))

    def check(self):
        with redirect_stdout(StringIO()) as output:
            preflight.inspect(self.app, True)
        return output.getvalue()

    def test_valid_unsigned_bundle_is_labeled(self):
        self.assertIn("UNSIGNED BUILD", self.check())
        self.assertIn("CFBundleVersion for App Attest server: 42", self.check())

    def test_missing_embedded_watch_widget_fails(self):
        (self.paths[-1] / "Info.plist").unlink()
        self.paths[-1].rmdir()
        with self.assertRaisesRegex(ValueError, "Watch widget: expected exactly one"):
            self.check()

    def test_wrong_identifier_fails(self):
        path = self.paths[1] / "Info.plist"
        info = plistlib.loads(path.read_bytes())
        info["CFBundleIdentifier"] = "wrong"
        path.write_bytes(plistlib.dumps(info))
        with self.assertRaisesRegex(ValueError, "iPhone widget: CFBundleIdentifier"):
            self.check()

    def test_http_origin_fails(self):
        path = self.app / "Info.plist"
        info = plistlib.loads(path.read_bytes())
        info["MannerPathAPIBaseURL"] = "http://example.invalid"
        path.write_bytes(plistlib.dumps(info))
        with self.assertRaisesRegex(ValueError, "HTTPS API origin"):
            self.check()

    def test_app_group_mismatch_fails(self):
        wrong = pathlib.Path(self.temp.name) / "wrong.entitlements"
        wrong.write_bytes(plistlib.dumps({"com.apple.security.application-groups": ["group.wrong"]}))
        with patch.dict(preflight.SOURCE_ENTITLEMENTS, {"Watch widget": wrong}):
            with self.assertRaisesRegex(ValueError, "Watch widget: application-groups"):
                self.check()

    def test_signed_mode_rejects_simulator_platform(self):
        path = self.app / "Info.plist"
        info = plistlib.loads(path.read_bytes())
        info["DTPlatformName"] = "iphonesimulator"
        path.write_bytes(plistlib.dumps(info))
        with self.assertRaisesRegex(ValueError, "expected 'iphoneos' for signed device evidence"):
            preflight.inspect(self.app, False)

    def test_missing_app_attest_fails(self):
        missing = pathlib.Path(self.temp.name) / "missing.entitlements"
        missing.write_bytes(plistlib.dumps({"com.apple.security.application-groups": [preflight.GROUP]}))
        with patch.dict(preflight.SOURCE_ENTITLEMENTS, {"iPhone app": missing}):
            with self.assertRaisesRegex(ValueError, "App Attest environment"):
                self.check()


if __name__ == "__main__":
    unittest.main()
