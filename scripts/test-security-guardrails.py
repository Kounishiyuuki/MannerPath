#!/usr/bin/env python3
"""Regression tests for offline release guardrails; synthetic values never leave tests."""
import contextlib
import importlib.util
import io
import os
import json
from pathlib import Path
import plistlib
import re
import subprocess
import tempfile
import unittest

ROOT = Path(__file__).resolve().parent.parent
spec = importlib.util.spec_from_file_location("secret_scan", ROOT / "scripts/security-secret-scan.py")
scan = importlib.util.module_from_spec(spec)
spec.loader.exec_module(scan)


class SecurityGuardrails(unittest.TestCase):
    def test_secret_assignment_formats_and_names(self):
        value = "0123456789abcdef" * 2
        formats = (
            lambda key: f'{key}="{value}"',
            lambda key: f'export {key}={value}',
            lambda key: json.dumps({"nested": {key: value}}),
            lambda key: f'nested:\n  {key}: "{value}"',
            lambda key: f'let {key} = "{value}"',
            lambda key: f'const {key} = "{value}";',
            lambda key: plistlib.dumps({"nested": {key: value}}).decode(),
        )
        for key in ("API_KEY", "api_key", "apiKey", "SECRET", "TOKEN", "PASSWORD",
                    "CREDENTIAL", "PRIVATE_KEY", "CLIENT_SECRET"):
            for index, render in enumerate(formats):
                with self.subTest(key=key, format=index):
                    self.assertIn("credential-assignment", scan.secret_types(render(key).encode()))
        self.assertIn("credential-assignment", scan.secret_types(('SECRET="' + value * 2 + '"').encode()))
        for declaration in (f'let API_KEY: String = "{value}"',
                            f'const apiKey: string = "{value}";'):
            with self.subTest(declaration=declaration.split("=")[0]):
                self.assertIn("credential-assignment", scan.secret_types(declaration.encode()))

    def test_authorization_context_detects_short_and_low_entropy_literals(self):
        for value in (b's3cr3t7', b'a' * 16):
            for header in (b'Authorization: Bearer ', b'"Authorization": "Bearer '):
                with self.subTest(length=len(value), quoted=header.startswith(b'"')):
                    self.assertIn("authorization-bearer", scan.secret_types(header + value))
        self.assertEqual(scan.secret_types(b'Authorization: Bearer ${AUTH_TOKEN}'), [])

    def test_yaml_block_and_quoted_password_literals(self):
        value = "0123456789abcdef" * 2
        for marker in ("|", ">-"):
            with self.subTest(marker=marker):
                self.assertIn("credential-assignment", scan.secret_types(
                    f'nested:\n  API_KEY: {marker}\n    {value}\n'.encode()))
        sample = " ".join(("the rainbow tiger", "dances in moonlight", "72!"))
        for declaration in (f"PASSWORD='{sample}'", f"export PASSWORD='{sample}'",
                            f'let PASSWORD = "{sample}"'):
            with self.subTest(format=declaration.split("=")[0]):
                self.assertIn("credential-assignment", scan.secret_types(declaration.encode()))

    def test_unquoted_env_literals_preserve_punctuation_and_entropy(self):
        alpha = b'abcdefghijklmnopqrstuvwxyz'
        for declaration in (b'API_KEY=' + alpha + b'ABCDEFG',
                            b'PASSWORD=' + alpha + b'!34'):
            with self.subTest(key=declaration.split(b'=')[0].decode()):
                self.assertIn("credential-assignment", scan.secret_types(declaration))

    def test_headers_and_known_token_formats(self):
        token = b"0123456789abcdef" * 2
        examples = [
            b'Authorization: Bearer ' + token,
            b'"Authorization": "Bearer ' + token + b'"',
            b'"x-api-key": "' + token + b'"',
            b'x-api-key: ' + token,
            b'-----BEGIN ' + b'RSA PRIVATE KEY-----',
            b'ghp_' + b'a' * 36,
            b'github_pat_' + b'a' * 82,
            b'AKIA' + b'A' * 16,
            b'AIza' + b'a' * 35,
        ]
        examples += [prefix + b'a' * 40 for prefix in
                     (b'sk_live_', b'sk_test_', b'sk-proj-', b'sk-ant-', b'xoxb-', b'xoxp-')]
        jwt = b'eyJhbGciOiJIUzI1NiJ9' + b'.' + b'eyJzdWIiOiJzeW50aGV0aWMifQ' + b'.' + b'a' * 43
        examples.append(jwt)
        for index, data in enumerate(examples):
            with self.subTest(format=index):
                self.assertTrue(scan.secret_types(data))

    def test_public_metadata_and_uncontextualized_entropy_are_not_secrets(self):
        metadata = {
            "MANNERPATH_API_BASE_URL": "https://worker.example.invalid",
            "MANNERPATH_PUBLIC_SITE_URL": "https://site.example.invalid",
            "CFBundleIdentifier": "org.example.mannerpath",
            "SHA256": "0123456789abcdef" * 4,
            "ETag": "0123456789abcdef" * 2,
            "UUID": "12345678-1234-5678-abcd-123456789abc",
            "public_app_id": "1234567890",
            "database_id": "12345678-1234-5678-abcd-123456789abc",
        }
        for data in (json.dumps(metadata).encode(), plistlib.dumps(metadata),
                     b'0123456789abcdefghijklmnopqrstuvwxyzABCDEFG'):
            self.assertEqual(scan.secret_types(data), [])

    def test_secret_detection_and_public_name_classification(self):
        self.assertEqual(scan.secret_types(b'MANNERPATH_API_BASE_URL="https://worker.example.invalid"'), [])
        self.assertEqual(scan.secret_types(b'let authorization = "test-pepper-value-not-a-real-secret"'), [])
        self.assertEqual(scan.secret_types(b'-----BEGIN ' + b'PRIVATE KEY-----'), ["private-key"])
        self.assertEqual(scan.secret_types(b'ghp_' + b'a' * 36), ["github-token"])
        self.assertEqual(scan.secret_types(b'API_KEY="' + b'0123456789abcdefghijklmnopqrstuvwxyzABCDEFG' + b'"'), ["credential-assignment"])
        for key in (b'CLOUDFLARE_API_TOKEN', b'AUTH_TOKEN', b'JWT_SECRET', b'REPORT_SUBMITTER_PEPPER'):
            self.assertEqual(scan.secret_types(key + b'=' + b'0123456789abcdef'), ["credential-assignment"])
        self.assertFalse(scan.safe_origin("https://user:synthetic-password@example.invalid/"))
        self.assertFalse(scan.safe_origin("https://user:synthetic-password@bad／host"))

    def test_artifact_scans_embedded_plists_resources_and_binary_strings(self):
        with tempfile.TemporaryDirectory() as folder:
            app = Path(folder)
            fake = b'ghp_' + b'a' * 36
            (app / "binary").write_bytes(b'\xcf\xfa\xed\xfe\x00' + fake + b'\x00')
            embedded = app / "PlugIns" / "Fixture.appex"
            embedded.mkdir(parents=True)
            value = "0123456789abcdef" * 2
            (embedded / "Settings.plist").write_bytes(plistlib.dumps(
                {"nested": {"API_KEY": value}}, fmt=plistlib.FMT_BINARY))
            (app / "settings.xcconfig").write_text('CLIENT_SECRET = "' + value + '"')
            (app / "headers.txt").write_text('Authorization: Bearer ' + value)
            (app / "Info.plist").write_bytes(plistlib.dumps({
                "CFBundleExecutable": "binary",
                "MannerPathAPIBaseURL": "http://example.invalid",
                "NSAppTransportSecurity": {"NSAllowsArbitraryLoads": True},
            }))
            output = io.StringIO()
            with contextlib.redirect_stdout(output):
                self.assertGreaterEqual(scan.scan_artifact(app), 4)
            self.assertNotIn(fake.decode(), output.getvalue())
            self.assertNotIn(value, output.getvalue())
            self.assertIn("Settings.plist", output.getvalue())

    def test_history_detects_deleted_secret_and_redacts_values(self):
        with tempfile.TemporaryDirectory() as folder:
            repo = Path(folder)
            def git(*args):
                return subprocess.check_output(["git", "-C", folder, *args], stderr=subprocess.DEVNULL)
            git("init")
            git("config", "user.email", "fixture@example.invalid")
            git("config", "user.name", "Security fixture")
            fake = b'ghp_' + b'a' * 36
            (repo / "removed.txt").write_bytes(fake)
            git("add", "removed.txt")
            git("commit", "-m", "fixture with synthetic credential")
            git("rm", "removed.txt")
            git("commit", "-m", "remove fixture credential")
            clean_head = git("rev-parse", "HEAD").decode().strip()
            git("checkout", "-b", "fixture-secret-ref")
            (repo / "branch-only.txt").write_bytes(b'AIza' + b'a' * 35)
            git("add", "branch-only.txt")
            git("commit", "-m", "synthetic credential on another ref")
            git("checkout", "--detach", clean_head)
            output = io.StringIO()
            previous = Path.cwd()
            try:
                os.chdir(repo)
                with contextlib.redirect_stdout(output):
                    self.assertGreater(scan.scan_repository(history=True), 0)
            finally:
                os.chdir(previous)
            result = output.getvalue()
            self.assertNotIn(fake.decode(), result)
            self.assertIn("path=removed.txt", result)
            self.assertIn("path=branch-only.txt", result)
            self.assertRegex(result, r"commit=[0-9a-f]{40}")
            self.assertRegex(result, r"reachable_blobs=[1-9][0-9]*")

    def test_empty_history_fails_closed(self):
        with tempfile.TemporaryDirectory() as folder:
            subprocess.run(["git", "init", folder], check=True, capture_output=True)
            previous = Path.cwd()
            try:
                os.chdir(folder)
                with contextlib.redirect_stdout(io.StringIO()):
                    self.assertGreater(scan.scan_repository(history=True), 0)
            finally:
                os.chdir(previous)

    def test_missing_artifact_fails_closed(self):
        with tempfile.TemporaryDirectory() as folder, contextlib.redirect_stdout(io.StringIO()):
            self.assertEqual(scan.scan_artifact(Path(folder)), 1)
            self.assertEqual(scan.scan_artifact(Path(folder) / "absent.app"), 1)

    def test_all_apple_build_configurations_have_no_secret_settings(self):
        # Parse OpenStep syntax rather than guessing block boundaries (also covers all extensions).
        project = ROOT / "apps/apple/MannerPath/MannerPath.xcodeproj/project.pbxproj"
        data = json.loads(subprocess.check_output(["plutil", "-convert", "json", "-o", "-", str(project)]))
        release = []
        for item in data["objects"].values():
            if item.get("isa") != "XCBuildConfiguration":
                continue
            settings = item["buildSettings"]
            for key in settings:
                self.assertIsNone(re.search(r"(?i)secret|pepper|password|credential|api_?key|access_?key|token|authorization|bearer|webhook|private_?key", key), key)
            if item["name"] == "Release":
                release.append(settings)
                self.assertFalse("DEBUG" in str(settings.get("SWIFT_ACTIVE_COMPILATION_CONDITIONS", "")))
                for key in ("MANNERPATH_API_BASE_URL", "MANNERPATH_PUBLIC_SITE_URL"):
                    if key in settings:
                        self.assertTrue(scan.safe_origin(settings[key]), key)
        self.assertGreaterEqual(len(release), 5)
        self.assertEqual(sum("MANNERPATH_API_BASE_URL" in s for s in release), 1)

    def test_fetch_entry_has_no_request_logger(self):
        # Scheduled operational logs are separate; the HTTP runtime must never persist request context.
        paths = [ROOT / "services/api/src/app.ts", ROOT / "services/api/src/index.ts"]
        paths += list((ROOT / "services/api/src/attest").glob("*.ts"))
        paths += list((ROOT / "services/api/src/reports").glob("*.ts"))
        for path in paths:
            source = path.read_text()
            self.assertIsNone(re.search(r"\bconsole\s*(?:\.|\[)", source), str(path.relative_to(ROOT)))
            self.assertNotRegex(source, r"import.*\b(?:logger|analytics)\b")


if __name__ == "__main__":
    unittest.main()
