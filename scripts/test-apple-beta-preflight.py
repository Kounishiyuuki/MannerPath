#!/usr/bin/env python3
import importlib.util
import json
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
            info = {"CFBundleIdentifier": identifier, "CFBundleVersion": "42",
                    "CFBundleShortVersionString": "1.0", "CFBundleExecutable": "Binary"}
            (path / "Binary").write_bytes(b"release binary")
            if label == "iPhone app":
                info["MannerPathAPIBaseURL"] = preflight.PRODUCTION_API
                info["MannerPathPublicSiteURL"] = preflight.PUBLIC_SITE
                info["UIDeviceFamily"] = [1]
            if label == "Watch app":
                info["WKCompanionAppBundleIdentifier"] = preflight.IDS["iPhone app"]
            if label in ("iPhone app", "Watch app"):
                info["NSLocationWhenInUseUsageDescription"] = "fixture"
                info["CFBundleIcons"] = {"CFBundlePrimaryIcon": {"CFBundleIconName": "AppIcon"}}
                (path / "Assets.car").write_bytes(b"fixture")
            (path / "PrivacyInfo.xcprivacy").write_bytes(plistlib.dumps({}))
            (path / "Info.plist").write_bytes(plistlib.dumps(info))

    def check(self):
        with patch.object(preflight.subprocess, "run", return_value=self.asset_result()), redirect_stdout(StringIO()) as output:
            preflight.inspect(self.app, True)
        return output.getvalue()

    def asset_result(self):
        return subprocess.CompletedProcess([], 0, stdout=json.dumps([
            {"Name": "AppIcon", "PixelWidth": 1024, "PixelHeight": 1024}
        ]).encode())

    def test_icon_metadata_missing_or_wrong_fails_for_both_hosts(self):
        for path, label in ((self.app, "iPhone app"), (self.paths[2], "Watch app")):
            info_path = path / "Info.plist"
            original = plistlib.loads(info_path.read_bytes())
            for icons in (None, {}, {"CFBundlePrimaryIcon": {}},
                          {"CFBundlePrimaryIcon": {"CFBundleIconName": "Wrong"}}):
                with self.subTest(label=label, icons=icons):
                    info = dict(original)
                    if icons is None:
                        info.pop("CFBundleIcons")
                    else:
                        info["CFBundleIcons"] = icons
                    info_path.write_bytes(plistlib.dumps(info))
                    with self.assertRaisesRegex(ValueError, label + ": CFBundleIcons"):
                        self.check()
            info_path.write_bytes(plistlib.dumps(original))

    def test_missing_assets_fails_for_both_hosts(self):
        for path in (self.app, self.paths[2]):
            assets = path / "Assets.car"
            assets.unlink()
            with self.assertRaisesRegex(ValueError, "Assets.car missing"):
                self.check()
            assets.write_bytes(b"fixture")

    def test_cli_missing_icon_exits_with_clear_failure(self):
        info_path = self.app / "Info.plist"
        info = plistlib.loads(info_path.read_bytes())
        info.pop("CFBundleIcons")
        info_path.write_bytes(plistlib.dumps(info))
        result = subprocess.run(["python3", str(SCRIPT), str(self.app), "--unsigned-build"],
                                capture_output=True, text=True)
        self.assertEqual(result.returncode, 1)
        self.assertIn("FAIL: iPhone app: CFBundleIcons", result.stderr)

    def test_missing_or_invalid_rendition_fails(self):
        for output in (b"[]", b"{}", b"invalid", b'[{"Name":"AppIcon","PixelWidth":60,"PixelHeight":60}]'):
            with self.subTest(output=output), patch.object(preflight.subprocess, "run", return_value=subprocess.CompletedProcess([], 0, stdout=output)):
                with self.assertRaisesRegex(ValueError, "rendition missing|invalid assetutil output"):
                    preflight.check_icon(self.app, plistlib.loads((self.app / "Info.plist").read_bytes()), "iPhone app")

    def test_assetutil_failure_is_not_skipped(self):
        for result in (subprocess.CompletedProcess([], 1, stdout=b""), OSError("missing")):
            with patch.object(preflight.subprocess, "run", **({"side_effect": result} if isinstance(result, OSError) else {"return_value": result})):
                with self.assertRaisesRegex(ValueError, "assetutil"):
                    preflight.check_icon(self.app, plistlib.loads((self.app / "Info.plist").read_bytes()), "iPhone app")

    def test_release_metadata_failures(self):
        for key, value, message in (("UIDeviceFamily", [1, 2], "iPhone-only"),
                                    ("MannerPathAPIBaseURL", "https://example.invalid", "production Release origin"),
                                    ("MannerPathPublicSiteURL", "https://example.invalid/", "production public site"),
                                    ("CFBundleShortVersionString", "", "version/build missing")):
            info_path = self.app / "Info.plist"
            original = plistlib.loads(info_path.read_bytes())
            info = dict(original)
            info[key] = value
            info_path.write_bytes(plistlib.dumps(info))
            with self.assertRaisesRegex(ValueError, message):
                self.check()
            info_path.write_bytes(plistlib.dumps(original))

    def test_missing_privacy_and_mismatched_embedded_version_fail(self):
        privacy = self.paths[2] / "PrivacyInfo.xcprivacy"
        privacy.unlink()
        with self.assertRaisesRegex(ValueError, "PrivacyInfo.xcprivacy"):
            self.check()
        privacy.write_bytes(plistlib.dumps({}))
        info_path = self.paths[3] / "Info.plist"
        info = plistlib.loads(info_path.read_bytes())
        info["CFBundleVersion"] = "43"
        info_path.write_bytes(plistlib.dumps(info))
        with self.assertRaisesRegex(ValueError, "CFBundleVersion does not match"):
            self.check()

    def edit_info(self, path, **changes):
        info_path = path / "Info.plist"
        info = plistlib.loads(info_path.read_bytes())
        info.update(changes)
        info_path.write_bytes(plistlib.dumps(info))

    def test_watch_companion_mismatch_fails(self):
        self.edit_info(self.paths[2], WKCompanionAppBundleIdentifier="com.example.other")
        with self.assertRaisesRegex(ValueError, "WKCompanionAppBundleIdentifier"):
            self.check()

    def test_location_usage_rules(self):
        for path, changes, message in (
                (self.paths[2], {"NSLocationWhenInUseUsageDescription": ""}, "NSLocationWhenInUseUsageDescription missing"),
                (self.app, {"NSLocationAlwaysAndWhenInUseUsageDescription": "x"}, "Always location")):
            with self.subTest(message=message):
                original = (path / "Info.plist").read_bytes()
                self.edit_info(path, **changes)
                with self.assertRaisesRegex(ValueError, message):
                    self.check()
                (path / "Info.plist").write_bytes(original)

    def test_loopback_or_plain_http_plist_value_fails_in_any_bundle(self):
        for value in ("http://127.0.0.1:8787", "https://localhost/x", "http://example.invalid"):
            for path in (self.paths[1], self.paths[3]):
                with self.subTest(value=value, path=path.name):
                    original = (path / "Info.plist").read_bytes()
                    self.edit_info(path, NSExtensionNote={"url": [value]})
                    with self.assertRaisesRegex(ValueError, "loopback or plain-HTTP"):
                        self.check()
                    (path / "Info.plist").write_bytes(original)

    def test_secret_looking_key_fails_without_echoing_value(self):
        self.edit_info(self.app, MannerPathAPIToken="private-value")
        with self.assertRaises(ValueError) as failure:
            self.check()
        self.assertIn("looks like a secret", str(failure.exception))
        self.assertNotIn("private-value", str(failure.exception))

    def test_debug_ui_test_hook_in_executable_fails(self):
        (self.paths[2] / "Binary").write_bytes(b"x--mannerpath-watch-ui-test\0")
        with self.assertRaisesRegex(ValueError, "Debug-only UI-test hook"):
            self.check()

    def test_debug_dylib_fails(self):
        for name in ("Binary.debug.dylib", "__preview.dylib"):
            with self.subTest(name=name):
                dylib = self.paths[2] / name
                dylib.write_bytes(b"debug")
                with self.assertRaisesRegex(ValueError, "Debug/preview dylib"):
                    self.check()
                dylib.unlink()

    def test_missing_executable_fails(self):
        (self.paths[1] / "Binary").unlink()
        with self.assertRaisesRegex(ValueError, "CFBundleExecutable missing"):
            self.check()

    def test_valid_unsigned_bundle_is_labeled(self):
        self.assertIn("UNSIGNED BUILD", self.check())
        self.assertIn("CFBundleVersion for App Attest server: 42", self.check())

    def test_missing_embedded_watch_widget_fails(self):
        shutil.rmtree(self.paths[-1])
        with self.assertRaisesRegex(ValueError, "Watch widget: expected exactly one"):
            self.check()

    def test_missing_iphone_widget_fails(self):
        shutil.rmtree(self.paths[1])
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

    def test_signed_mode_does_not_bypass_signature_failure(self):
        info_path = self.app / "Info.plist"
        info = plistlib.loads(info_path.read_bytes())
        info["DTPlatformName"] = "iphoneos"
        info_path.write_bytes(plistlib.dumps(info))
        with patch.object(preflight.subprocess, "run", return_value=subprocess.CompletedProcess([], 1, stdout=b"")):
            with self.assertRaisesRegex(ValueError, "code signature verification failed"):
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
            if command[0] == "xcrun":
                return self.asset_result()
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
        self.assertEqual(run.call_count, 14)
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
