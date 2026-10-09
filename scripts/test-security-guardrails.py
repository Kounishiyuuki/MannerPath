#!/usr/bin/env python3
"""Regression tests for offline release guardrails; synthetic values never leave tests."""
import contextlib
import importlib.util
import io
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

    def test_artifact_rejects_credentials_debug_transport_and_ats_without_values(self):
        with tempfile.TemporaryDirectory() as folder:
            app = Path(folder)
            fake = b'ghp_' + b'a' * 36
            (app / "binary").write_bytes(fake + b' http://localhost:8787/')
            (app / "Info.plist").write_bytes(plistlib.dumps({
                "CFBundleExecutable": "binary",
                "MannerPathAPIBaseURL": "http://example.invalid",
                "NSAppTransportSecurity": {"NSAllowsArbitraryLoads": True},
            }))
            output = io.StringIO()
            with contextlib.redirect_stdout(output):
                self.assertEqual(scan.scan_artifact(app), 4)
            self.assertNotIn(fake.decode(), output.getvalue())
            self.assertNotIn("http://localhost", output.getvalue())

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
