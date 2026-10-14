#!/usr/bin/env python3
"""Guards docs/beta-e2e/device-release-matrix.md: device results must name the build they were observed on.

A row's Result cell is empty (not run) or starts with PASS/FAIL/PARTIAL followed by "1.0 (N)". Anything else
(a bare "PASS", "OK", a tick, a simulator note) would let an unobserved item read as a device pass.
"""
import re
import sys
import unittest
from pathlib import Path

MATRIX = Path(__file__).resolve().parent.parent / "docs/beta-e2e/device-release-matrix.md"
RESULT = re.compile(r"^(PASS|FAIL|PARTIAL) \d+\.\d+ \(\d+\)(\b|:| |$)")


def result_rows(text):
    """Yields (row id, result cell) for every table whose last header column is Result."""
    in_table = False
    for line in text.splitlines():
        if not line.startswith("|"):
            in_table = False
            continue
        cells = [c.strip() for c in line.strip().strip("|").split("|")]
        if cells[-1] == "Result" and cells[0] == "#":
            in_table = True
            continue
        if in_table and not set(cells[0]) <= set("- "):
            yield cells[0], cells[-1]


def problems(text):
    seen, found = set(), []
    for row_id, result in result_rows(text):
        if row_id in seen:
            found.append(f"{row_id}: duplicate row id")
        seen.add(row_id)
        if result and not RESULT.match(result):
            found.append(f"{row_id}: result {result!r} must be empty or PASS/FAIL/PARTIAL with a build, e.g. 'PASS 1.0 (2)'")
        if result.startswith("PARTIAL") and "Open:" not in result and "not recorded" not in result:
            found.append(f"{row_id}: PARTIAL must say what is still open")
    return found, seen


class DeviceReleaseMatrixTests(unittest.TestCase):
    def test_committed_matrix(self):
        found, ids = problems(MATRIX.read_text(encoding="utf-8"))
        self.assertEqual(found, [])
        self.assertTrue({"P10", "P14", "D1", "D5", "L1", "W2", "G2/S1/S2"} <= ids, "matrix tables not parsed")

    def table(self, result):
        return f"| # | Steps | Result |\n| --- | --- | --- |\n| X1 | s | {result} |\n"

    def test_accepts_empty_and_build_named_results(self):
        for ok in ["", "PASS 1.0 (2)", "FAIL 1.0 (3): crash", "PARTIAL 1.0 (2): a seen. Open: b"]:
            self.assertEqual(problems(self.table(ok))[0], [], ok)

    def test_rejects_results_without_a_build(self):
        for bad in ["PASS", "OK", "✓", "PASS (simulator)", "passed 1.0 (2)", "PARTIAL 1.0 (2)"]:
            self.assertNotEqual(problems(self.table(bad))[0], [], bad)

    def test_rejects_duplicate_ids(self):
        self.assertNotEqual(problems(self.table("") + "| X1 | s | |\n")[0], [])


if __name__ == "__main__":
    sys.exit(0 if unittest.main(exit=False).result.wasSuccessful() else 1)
