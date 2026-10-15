#!/usr/bin/env python3
import copy
import hashlib
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest

spec = importlib.util.spec_from_file_location("store_check", Path(__file__).with_name("validate-store-screenshots.py"))
check = importlib.util.module_from_spec(spec)
spec.loader.exec_module(check)


class Screenshots(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
        self.bytes = b"\xff\xd8\xffsynthetic-format-test-only-not-an-app-image"
        (self.root / "sample.jpg").write_bytes(self.bytes)
        self.data = {"version": 1, "appVersion": "1.0", "build": "3", "sourceHead": "1" * 40,
                     "sourceTree": "2" * 40, "apiOrigin": check.ORIGIN, "locale": "ja", "images": [{
                         "file": "sample.jpg", "platform": "iphoneLarge", "captureKind": "releaseSimulator",
                         "width": 1320, "height": 2868, "sha256": hashlib.sha256(self.bytes).hexdigest(),
                         "sourceIds": ["synthetic-only"], "spotIds": ["sp_" + "0" * 26],
                         "syntheticSpotData": False, "status": "candidate", "physicalDeviceVerified": False,
                         "rightsApproved": False, "submitReady": False}]}

    def run_check(self, properties=(1320, 2868, "no")):
        manifest = self.root / "manifest.json"
        manifest.write_text(json.dumps(self.data))
        return check.validate(manifest, lambda _: properties)

    def test_candidate_stays_unapproved(self):
        result = self.run_check()
        self.assertEqual(result["technicalValidation"], "PASS")
        self.assertFalse(result["submissionReady"])
        self.assertEqual(result["physicalDeviceVerification"], "NOT_PROVEN")

    def test_alpha_and_dimensions(self):
        for props in [(1320, 2868, "yes"), (100, 100, "no")]:
            with self.assertRaises(ValueError):
                self.run_check(props)

    def test_hash_and_provenance(self):
        for key, value in [("sha256", "0" * 64), ("submitReady", True), ("physicalDeviceVerified", True),
                           ("syntheticSpotData", True), ("rightsApproved", True), ("spotIds", [])]:
            data = copy.deepcopy(self.data)
            self.data["images"][0][key] = value
            with self.assertRaises(ValueError):
                self.run_check()
            self.data = data

    def test_path_and_symlink(self):
        for name in ["../sample.jpg", "/tmp/sample.jpg", "missing.jpg"]:
            self.data["images"][0]["file"] = name
            with self.assertRaises(ValueError):
                self.run_check()
        (self.root / "link.jpg").symlink_to(self.root / "sample.jpg")
        self.data["images"][0]["file"] = "link.jpg"
        with self.assertRaises(ValueError):
            self.run_check()

    def test_destination_search_is_not_a_smoking_place(self):
        self.data["images"][0].update(scene="destinationSearch", spotIds=[])
        self.assertEqual(self.run_check()["technicalValidation"], "PASS")

    def test_wrong_origin(self):
        self.data["apiOrigin"] = "https://fixture.example.invalid"
        with self.assertRaises(ValueError):
            self.run_check()


if __name__ == "__main__":
    unittest.main()
