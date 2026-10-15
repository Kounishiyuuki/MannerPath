#!/usr/bin/env python3
"""Every UI test class is either run by scripts/run-iphone-ui-tests.sh or listed, with how to run it, in
docs/beta-e2e/device-release-matrix.md §10 "UI test classes outside the runner".

A class in neither place never runs before a release candidate; that is how a regression can ship unseen.
"""
import re
import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
UI_DIRS = [ROOT / "apps/apple/MannerPath/MannerPathUITests",
           ROOT / "apps/apple/MannerPath/MannerPathWatch Watch AppUITests"]
RUNNER = ROOT / "scripts/run-iphone-ui-tests.sh"
MATRIX = ROOT / "docs/beta-e2e/device-release-matrix.md"
CLASS = re.compile(r"^(?:final\s+)?class\s+(\w+)\s*:\s*(?:MannerPathUITestCase|XCTestCase)\b", re.M)
HEADING = "### UI test classes outside the runner"


def ui_classes():
    found = set()
    for d in UI_DIRS:
        for f in sorted(d.glob("*.swift")):
            found |= set(CLASS.findall(f.read_text(encoding="utf-8")))
    return found - {"MannerPathUITestCase"}


def runner_classes(text):
    return set(re.findall(r"-only-testing:MannerPathUITests/(\w+)", text))


def listed_outside(text):
    if HEADING not in text:
        return None
    section = text.split(HEADING, 1)[1].split("\n#", 1)[0]
    return set(re.findall(r"^\| `(\w+)` \|", section, re.M))


def problems(classes, run, outside):
    if outside is None:
        return [f"matrix has no '{HEADING}' section"]
    found = [f"{c}: neither run by run-iphone-ui-tests.sh nor listed in matrix §10" for c in sorted(classes - run - outside)]
    found += [f"{c}: listed in §10 but also run by the runner" for c in sorted(run & outside)]
    found += [f"{c}: named but no such UI test class" for c in sorted((run | outside) - classes)]
    return found


class UITestInventoryTests(unittest.TestCase):
    def test_committed_inventory(self):
        classes = ui_classes()
        self.assertIn("B_OnlineUITests", classes, "UI test classes not parsed")
        found = problems(classes, runner_classes(RUNNER.read_text(encoding="utf-8")),
                         listed_outside(MATRIX.read_text(encoding="utf-8")))
        self.assertEqual(found, [])

    def test_unlisted_class_fails(self):
        self.assertNotEqual(problems({"A", "B"}, {"A"}, set()), [])

    def test_class_in_both_or_missing_fails(self):
        self.assertNotEqual(problems({"A"}, {"A"}, {"A"}), [])
        self.assertNotEqual(problems({"A"}, {"A"}, {"Gone"}), [])
        self.assertNotEqual(problems({"A"}, {"A"}, None), [])

    def test_complete_inventory_passes(self):
        self.assertEqual(problems({"A", "B"}, {"A"}, {"B"}), [])


if __name__ == "__main__":
    sys.exit(0 if unittest.main(exit=False).result.wasSuccessful() else 1)
