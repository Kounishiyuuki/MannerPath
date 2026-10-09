#!/usr/bin/env python3
import importlib.util
import json
import os
import pathlib
import plistlib
import shutil
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch
from contextlib import redirect_stdout
from io import StringIO

SCRIPT = pathlib.Path(__file__).with_name("check-apple-beta-artifact.py")
spec = importlib.util.spec_from_file_location("preflight", SCRIPT)
preflight = importlib.util.module_from_spec(spec)
spec.loader.exec_module(preflight)


ORIGIN_FAILURE = "HTTPS API origin|Release must use production HTTPS only|canonical production Release origin"


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

    def assert_info_fails(self, path, message, **changes):
        original = (path / "Info.plist").read_bytes()
        self.edit_info(path, **changes)
        try:
            with self.assertRaisesRegex(ValueError, message):
                self.check()
        finally:
            (path / "Info.plist").write_bytes(original)

    def add_extension(self, **info):
        extension = self.app / "PlugIns/Extra.appex"
        extension.mkdir()
        (extension / "Binary").write_bytes(b"release binary")
        (extension / "Info.plist").write_bytes(plistlib.dumps({"CFBundleExecutable": "Binary", **info}))
        self.addCleanup(shutil.rmtree, extension)
        return extension

    def test_canonical_production_https_origin_passes(self):
        self.edit_info(self.paths[1], MannerPathAPIBaseURL=preflight.PRODUCTION_API)
        self.assertIn("UNSIGNED BUILD", self.check())

    def test_unsafe_url_fails_in_every_bundle_nested(self):
        cases = (("http://127.0.0.1:8787", "not HTTPS"), ("https://127.0.0.2/x", "loopback"),
                 ("https://[::1]/x", "loopback"), ("https://[::ffff:127.0.0.1]/x", "loopback"),
                 ("https://localhost/x", "localhost"), ("https://api.localhost/x", "localhost"),
                 ("https://2130706433/x", "numeric IP host"), ("https://169.254.1.1/x", "IP literal"),
                 ("https://10.0.0.1/x", "IP literal"), ("https://[fe80::1]/x", "IP literal"),
                 ("http://example.invalid", "not HTTPS"))
        for value, message in cases:
            for path in self.paths:
                with self.subTest(value=value, path=path.name):
                    self.assert_info_fails(path, f"{path.name}: Info.plist 'Config.urls\\[0\\]' .*{message}",
                                           Config={"urls": [value]})
                    self.assert_info_fails(path, f"Info.plist 'Note' .*{message}", Note=f"see {value} for details")

    def test_api_origin_key_in_widgets_must_be_canonical(self):
        for path in (self.paths[1], self.paths[3]):
            for value, message in (("http://127.0.0.1:8787", "not HTTPS"), ("https://127.0.0.2/x", "loopback"),
                                   ("https://[::1]/x", "loopback"),
                                   ("https://example.invalid", "canonical production Release origin")):
                with self.subTest(path=path.name, value=value):
                    self.assert_info_fails(path, message, MannerPathAPIBaseURL=value)

    def test_unsafe_url_in_any_extension_fails(self):
        self.add_extension(CFBundleIdentifier="x", Endpoint="https://127.0.0.1/x")
        with self.assertRaisesRegex(ValueError, "Extra.appex: Info.plist 'Endpoint' is loopback"):
            self.check()

    def test_nested_secret_key_fails_without_echoing_value(self):
        for changes in ({"Config": {"APIToken": "private-value"}}, {"Config": {"Headers": [{"Authorization": "private-value"}]}},
                        {"client_secret": "private-value"}, {"Nested": {"private-key": "private-value"}},
                        {"x": {"Bearer": "private-value"}}, {"REPORT_PEPPER": "private-value"}, {"apiKey": "private-value"}):
            for path in (self.app, self.paths[3]):
                with self.subTest(changes=changes, path=path.name):
                    original = (path / "Info.plist").read_bytes()
                    self.edit_info(path, **changes)
                    try:
                        with self.assertRaises(ValueError) as failure:
                            self.check()
                    finally:
                        (path / "Info.plist").write_bytes(original)
                    self.assertIn("looks like a secret", str(failure.exception))
                    self.assertNotIn("private-value", str(failure.exception))

    def test_public_names_are_not_secrets(self):
        for name in ("MannerPathAPIBaseURL", "MannerPathPublicSiteURL", "CFBundleIdentifier",
                     "INFOPLIST_KEY_NSLocationWhenInUseUsageDescription", "NSLocationWhenInUseUsageDescription"):
            self.assertFalse(preflight.secretish(name), name)
        for name in ("API_KEY", "apiKey", "ClientSecret", "AUTH_TOKEN", "Authorization", "PrivateKey", "db-password"):
            self.assertTrue(preflight.secretish(name), name)

    def project(self, settings):
        project = pathlib.Path(self.temp.name) / "project.json"
        project.write_text(json.dumps({"objects": {
            f"C{index}": {"isa": "XCBuildConfiguration", "name": name, "buildSettings": values}
            for index, (name, values) in enumerate(settings)}}))
        return project

    def test_build_settings_all_configurations(self):
        release = {"MANNERPATH_API_BASE_URL": preflight.PRODUCTION_API, "MANNERPATH_PUBLIC_SITE_URL": preflight.PUBLIC_SITE}
        preflight.check_build_settings(self.project([("Release", release), ("Debug", {})]))
        preflight.check_build_settings()  # the committed project
        for settings, message in (([("Release", release), ("Debug", {"API_KEY": "x"})], "Debug.*looks like a secret"),
                                  ([("Release", {**release, "WidgetClientSecret": "x"})], "looks like a secret"),
                                  ([("Release", {**release, "MANNERPATH_API_BASE_URL": "http://127.0.0.1:8787"})], "canonical"),
                                  ([("Release", {**release, "SWIFT_ACTIVE_COMPILATION_CONDITIONS": "DEBUG"})], "DEBUG"),
                                  ([("Release", {**release, "SWIFT_ACTIVE_COMPILATION_CONDITIONS": ["$(inherited)", "DEBUG"]})], "DEBUG"),
                                  ([("Release", release), ("Release", release)], "exactly one")):
            with self.subTest(message=message), self.assertRaisesRegex(ValueError, message):
                preflight.check_build_settings(self.project(settings))

    def test_secret_literals_in_innocent_build_settings_are_redacted(self):
        release = {"MANNERPATH_API_BASE_URL": preflight.PRODUCTION_API, "MANNERPATH_PUBLIC_SITE_URL": preflight.PUBLIC_SITE}
        value = "ghp_" + "a" * 36
        for configuration in ("Debug", "Release", "Custom"):
            with self.subTest(configuration=configuration), self.assertRaises(ValueError) as failure:
                preflight.check_build_settings(self.project([("Release", release), (configuration, {"OTHER_SETTING": ["$(inherited)", value]})]))
            self.assertNotIn(value, str(failure.exception))
            self.assertIn("secret-looking literal", str(failure.exception))

    def test_always_location_fails_in_every_bundle_and_extension(self):
        for key in preflight.LOCATION_ALWAYS:
            for path in self.paths:
                with self.subTest(key=key, path=path.name):
                    self.assert_info_fails(path, "Always location", **{key: "x"})
        self.add_extension(CFBundleIdentifier="x", NSLocationAlwaysAndWhenInUseUsageDescription="x")
        with self.assertRaisesRegex(ValueError, "Extra.appex.*Always location"):
            self.check()

    def test_widgets_carry_no_location_permission(self):
        for path in (self.paths[1], self.paths[3]):
            for key in ("NSLocationWhenInUseUsageDescription", "NSWidgetWantsLocation"):
                with self.subTest(path=path.name, key=key):
                    self.assert_info_fails(path, "location permission key", **{key: "x"})

    def test_nested_debug_dylib_anywhere_fails(self):
        nested = self.app / "Frameworks/Inner.framework"
        nested.mkdir(parents=True)
        for name in ("Inner.debug.dylib", "__preview.dylib"):
            with self.subTest(name=name):
                (nested / name).write_bytes(b"debug")
                with self.assertRaisesRegex(ValueError, "Debug/preview dylib"):
                    self.check()
                (nested / name).unlink()

    def test_release_evidence_is_not_overclaimed(self):
        self.assertIn("Release configuration: NOT PROVEN", self.check())
        with patch.object(preflight.subprocess, "run", return_value=self.asset_result()), redirect_stdout(StringIO()) as output:
            preflight.inspect(self.app, True, wrapper_release=True)
        self.assertIn("archived by apple-beta-preflight.sh with -configuration Release", output.getvalue())

    def test_wrapper_contract_archives_release_and_refuses_overrides(self):
        wrapper = SCRIPT.with_name("apple-beta-preflight.sh")
        source = wrapper.read_text()
        for fragment in ("xcodebuild archive", "-configuration Release", "-destination 'generic/platform=iOS'",
                         "--unsigned-build --wrapper-release-archive"):
            self.assertIn(fragment, source)
        self.assertNotRegex(source, r"-configuration (?!Release)")
        for env, args in (({"MANNERPATH_API_BASE_URL": "http://127.0.0.1:8787"}, []), ({}, ["a", "b"])):
            result = subprocess.run(["bash", str(wrapper), *args], capture_output=True, text=True,
                                    env={"PATH": "/usr/bin:/bin", **env})
            self.assertEqual(result.returncode, 2, result.stderr)

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
        with self.assertRaisesRegex(ValueError, ORIGIN_FAILURE):
            self.check()

    def test_empty_origin_fails(self):
        path = self.app / "Info.plist"
        info = plistlib.loads(path.read_bytes())
        info["MannerPathAPIBaseURL"] = ""
        path.write_bytes(plistlib.dumps(info))
        with self.assertRaisesRegex(ValueError, ORIGIN_FAILURE):
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
            with self.assertRaisesRegex(ValueError, ORIGIN_FAILURE):
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


class PreflightOrchestrationTests(unittest.TestCase):
    """Run the real wrapper with isolated checker/scanner/build stand-ins."""

    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="preflight integration ")
        self.addCleanup(self.temp.cleanup)
        self.root = pathlib.Path(self.temp.name)
        scripts = self.root / "scripts"
        scripts.mkdir()
        self.wrapper = scripts / "apple-beta-preflight.sh"
        shutil.copyfile(SCRIPT.with_name("apple-beta-preflight.sh"), self.wrapper)
        self.log = self.root / "calls.jsonl"
        self.bin = self.root / "bin"
        self.bin.mkdir()
        self.write_stub(self.bin / "xcodebuild", """
args = sys.argv[1:]
artifact = args[args.index('-archivePath') + 1]
(pathlib.Path(artifact) / 'Products/Applications/MannerPath.app').mkdir(parents=True)
record('build', args)
""")
        self.write_stub(scripts / "check-apple-beta-artifact.py", """
record('checker', sys.argv[1:])
assert pathlib.Path(sys.argv[1]).is_dir()
""")
        self.scanner = scripts / "security-secret-scan.py"
        self.write_stub(self.scanner, """
record('scanner', sys.argv[1:])
assert len(sys.argv) == 3 and sys.argv[1] == '--artifact'
assert pathlib.Path(sys.argv[2]).is_dir()
sys.exit(int(os.environ.get('SCANNER_EXIT', '0')))
""")
        self.signed = self.root / "signed Release artifact.xcarchive"
        (self.signed / "Products/Applications/MannerPath.app").mkdir(parents=True)
        self.signed_app = self.root / "signed Release app.app"
        self.signed_app.mkdir()

    def write_stub(self, path, body):
        path.write_text(f"#!{sys.executable}\n" + """
import json, os, pathlib, sys

def record(kind, args):
    with open(os.environ['PREFLIGHT_CALL_LOG'], 'a') as log:
        log.write(json.dumps([kind, args]) + '\\n')
""" + body)
        path.chmod(0o755)

    def run_wrapper(self, signed=False, scanner_exit=0):
        env = {**os.environ, "PATH": str(self.bin) + os.pathsep + os.environ["PATH"],
               "PREFLIGHT_CALL_LOG": str(self.log), "SCANNER_EXIT": str(scanner_exit)}
        env.pop("MANNERPATH_API_BASE_URL", None)
        env.pop("MANNERPATH_PUBLIC_SITE_URL", None)
        return subprocess.run(["bash", str(self.wrapper), *([str(self.signed_app if signed == "app" else self.signed)] if signed else [])],
                              env=env, capture_output=True, text=True)

    def calls(self):
        return [json.loads(line) for line in self.log.read_text().splitlines()]

    def assert_scanned_correct_artifact(self, signed):
        calls = self.calls()
        self.assertEqual([kind for kind, _ in calls],
                         ['checker', 'scanner'] if signed else ['build', 'checker', 'scanner'])
        checker_args = calls[-2][1]
        scanner_args = calls[-1][1]
        if signed:
            expected = str(self.signed_app if signed == "app" else self.signed)
            self.assertEqual(checker_args, [expected])
        else:
            build_args = calls[0][1]
            self.assertEqual(build_args[0], 'archive')
            self.assertEqual(build_args[build_args.index('-configuration') + 1], 'Release')
            expected = build_args[build_args.index('-archivePath') + 1]
            self.assertEqual(pathlib.Path(expected).name, 'MannerPath.xcarchive')
            self.assertEqual(checker_args, [expected, '--unsigned-build', '--wrapper-release-archive'])
        scanned_app = expected if signed == 'app' else str(pathlib.Path(expected) / 'Products/Applications/MannerPath.app')
        self.assertEqual(scanner_args, ['--artifact', scanned_app])

    def test_scanner_success_is_required_for_both_artifact_modes(self):
        for signed in (False, True, "app"):
            with self.subTest(signed=signed):
                self.log.unlink(missing_ok=True)
                result = self.run_wrapper(signed=signed)
                self.assertEqual(result.returncode, 0, result.stderr)
                self.assert_scanned_correct_artifact(signed)

    def test_scanner_suspect_and_execution_error_fail_both_modes(self):
        for signed in (False, True, "app"):
            for scanner_exit in (1, 7):
                with self.subTest(signed=signed, scanner_exit=scanner_exit):
                    self.log.unlink(missing_ok=True)
                    result = self.run_wrapper(signed=signed, scanner_exit=scanner_exit)
                    self.assertEqual(result.returncode, scanner_exit, result.stderr)
                    self.assert_scanned_correct_artifact(signed)


    def test_real_scanner_rejects_invalid_artifact_even_if_checker_passes(self):
        shutil.copyfile(SCRIPT.with_name("security-secret-scan.py"), self.scanner)
        result = self.run_wrapper(signed="app")
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("invalid app root", result.stdout)
        self.assertEqual(self.calls(), [["checker", [str(self.signed_app)]]])

    def test_missing_scanner_fails_both_modes(self):
        self.scanner.unlink()
        for signed in (False, True, "app"):
            with self.subTest(signed=signed):
                self.log.unlink(missing_ok=True)
                result = self.run_wrapper(signed=signed)
                self.assertNotEqual(result.returncode, 0)
                self.assertIn('security-secret-scan.py', result.stderr)
                self.assertEqual(self.calls()[-1][0], 'checker')


if __name__ == "__main__":
    unittest.main()
