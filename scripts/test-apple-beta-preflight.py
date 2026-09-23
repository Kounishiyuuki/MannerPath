#!/usr/bin/env python3
import importlib.util
import pathlib
import plistlib
import shutil
import subprocess
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

    def test_missing_iphone_widget_fails(self):
        (self.paths[1] / "Info.plist").unlink()
        self.paths[1].rmdir()
        with self.assertRaisesRegex(ValueError, "iPhone widget: expected exactly one"):
            self.check()

    def test_missing_watch_app_fails(self):
        shutil.rmtree(self.paths[2])
        with self.assertRaisesRegex(ValueError, "Watch app: expected exactly one"):
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

    def test_empty_origin_fails(self):
        path = self.app / "Info.plist"
        info = plistlib.loads(path.read_bytes())
        info["MannerPathAPIBaseURL"] = ""
        path.write_bytes(plistlib.dumps(info))
        with self.assertRaisesRegex(ValueError, "HTTPS API origin"):
            self.check()

    def test_malformed_https_authority_fails(self):
        path = self.app / "Info.plist"
        for origin in ("https://:443", "https://example.invalid:bad", "https://example.invalid:", "https://[bad",
                       "https://exa mple.invalid", "https://example.invalid ",
                       "https://example\\.invalid", "https://%2F",
                       "https://example.invalid\n"):
            info = plistlib.loads(path.read_bytes())
            info["MannerPathAPIBaseURL"] = origin
            path.write_bytes(plistlib.dumps(info))
            with self.assertRaisesRegex(ValueError, "HTTPS API origin"):
                self.check()

    def test_invalid_origin_does_not_echo_credentials(self):
        path = self.app / "Info.plist"
        info = plistlib.loads(path.read_bytes())
        info["MannerPathAPIBaseURL"] = "https://user:private-value@example.invalid"
        path.write_bytes(plistlib.dumps(info))
        with self.assertRaises(ValueError) as failure:
            self.check()
        self.assertNotIn("private-value", str(failure.exception))

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

    def test_signed_archive_reads_all_four_signed_entitlements(self):
        archive = pathlib.Path(self.temp.name) / "Beta.xcarchive"
        applications = archive / "Products/Applications"
        applications.mkdir(parents=True)
        (applications / "MannerPath.app").symlink_to(self.app, target_is_directory=True)
        for path in self.paths:
            info_path = path / "Info.plist"
            info = plistlib.loads(info_path.read_bytes())
            info["DTPlatformName"] = "iphoneos" if path in self.paths[:2] else "watchos"
            info_path.write_bytes(plistlib.dumps(info))
            (path / "embedded.mobileprovision").write_bytes(b"fixture")

        def codesign(command, **_):
            if "--verify" in command:
                return subprocess.CompletedProcess(command, 0, stdout=b"")
            if command[0] == "security":
                identifier = plistlib.loads((pathlib.Path(command[-1]).parent / "Info.plist").read_bytes())["CFBundleIdentifier"]
                profile = {"TeamIdentifier": ["TEAM123"], "Entitlements": {
                    "application-identifier": "TEAM123." + identifier,
                    "com.apple.security.application-groups": [preflight.GROUP]}}
                return subprocess.CompletedProcess(command, 0, stdout=plistlib.dumps(profile))
            entitlements = {"com.apple.security.application-groups": [preflight.GROUP]}
            identifier = plistlib.loads((pathlib.Path(command[-1]) / "Info.plist").read_bytes())["CFBundleIdentifier"]
            entitlements["application-identifier"] = "TEAM123." + identifier
            entitlements["com.apple.developer.team-identifier"] = "TEAM123"
            if command[-1].endswith("/MannerPath.app"):
                entitlements["com.apple.developer.devicecheck.appattest-environment"] = "development"
            return subprocess.CompletedProcess(command, 0, stdout=plistlib.dumps(entitlements))

        with patch.object(preflight.subprocess, "run", side_effect=codesign) as run:
            with redirect_stdout(StringIO()) as output:
                preflight.inspect(archive, False)
        self.assertEqual(run.call_count, 12)
        self.assertIn("signed artifact entitlements", output.getvalue())

    def test_missing_profile_fails_signed_mode(self):
        for path in self.paths:
            info_path = path / "Info.plist"
            info = plistlib.loads(info_path.read_bytes())
            info["DTPlatformName"] = "iphoneos" if path in self.paths[:2] else "watchos"
            info_path.write_bytes(plistlib.dumps(info))
        entitlements = plistlib.dumps({"com.apple.security.application-groups": [preflight.GROUP],
                                     "com.apple.developer.devicecheck.appattest-environment": "development"})
        with patch.object(preflight.subprocess, "run", return_value=subprocess.CompletedProcess([], 0, stdout=entitlements)):
            with self.assertRaisesRegex(ValueError, "embedded.mobileprovision missing"):
                preflight.inspect(self.app, False)

    def test_profile_mismatch_does_not_echo_team_identifier(self):
        bundle = self.app
        (bundle / "embedded.mobileprovision").write_bytes(b"fixture")
        profile = {"TeamIdentifier": ["PRIVATE_TEAM"], "Entitlements": {
            "application-identifier": "PRIVATE_TEAM." + preflight.IDS["iPhone app"],
            "com.apple.security.application-groups": [preflight.GROUP]}}
        signed = {"com.apple.developer.team-identifier": "WRONG_TEAM",
                  "application-identifier": "WRONG_TEAM." + preflight.IDS["iPhone app"]}
        with patch.object(preflight.subprocess, "run", return_value=subprocess.CompletedProcess([], 0, stdout=plistlib.dumps(profile))):
            with self.assertRaises(ValueError) as failure:
                preflight.check_provisioning(bundle, preflight.IDS["iPhone app"], signed)
        self.assertNotIn("PRIVATE_TEAM", str(failure.exception))
        self.assertNotIn("WRONG_TEAM", str(failure.exception))


if __name__ == "__main__":
    unittest.main()
