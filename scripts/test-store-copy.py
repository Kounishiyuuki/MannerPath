#!/usr/bin/env python3
"""Guards the v1.0 store copy and docs/V1_APP_STORE_RELEASE_GATE.md.

The description must stay within Apple's limits, name the covered areas and never claim nationwide coverage.
The gate must say SUBMISSION: BLOCKED while any P0 row is OPEN, so the page cannot read as ready by accident.
"""
import re
import sys
import unittest
from pathlib import Path

DOCS = Path(__file__).resolve().parent.parent / "docs"
ENTRY = DOCS / "APP_STORE_CONNECT_ENTRY.md"
GATE = DOCS / "V1_APP_STORE_RELEASE_GATE.md"
FINAL_ASSETS = DOCS / "release" / "V1_APPSTORE_FINAL_ASSETS.md"
# The 638-spot candidate (準備中). It replaces ENTRY's copy, and TOKYO_AREAS replaces AREAS, only in the PR that
# follows the production switch to 638 (docs/release/V1_TOKYO_STORE_COPY.md §5).
TOKYO_CANDIDATE = DOCS / "release" / "V1_TOKYO_STORE_COPY.md"
AREAS = ["台東区", "港区", "江東区", "武蔵野市", "大阪市", "京都市"]
TOKYO_AREAS = ["千代田区", "中央区", "港区", "台東区", "渋谷区", "豊島区", "江東区", "武蔵野市", "大阪市", "京都市"]
BANNED = ["全国", "どこでも", "日本中", "すべての喫煙所", "全ての喫煙所", "東京都全域", "東京全域"]


def description(text):
    start = text.index("Description (paste as plain text):")
    return text[text.index("```text\n", start) + 8:text.index("\n```", start + 40)]


def entry_value(text, field):
    row = re.search(rf"^\| {field}[^|]*\| `([^`]+)`", text, re.M)
    return row.group(1)


def copy_problems(text, areas=AREAS, *, full_entry=True):
    found = []
    desc = description(text)
    if len(desc) > 4000:
        found.append(f"description {len(desc)} characters > 4000")
    found += [f"description claims {w!r}" for w in BANNED if w in desc]
    found += [f"description does not name {a}" for a in areas if a not in desc]
    if len(entry_value(text, r"Subtitle \(ja\)")) > 30:
        found.append("subtitle > 30 characters")
    if full_entry and len(entry_value(text, r"Name \(ja\)")) > 30:
        found.append("name > 30 characters")
    if full_entry and len(entry_value(text, r"Promotional text \(optional\)")) > 170:
        found.append("promotional text > 170 characters")
    if len(entry_value(text, "Keywords").encode()) > 100:
        found.append("keywords > 100 bytes")
    if "利用条件を確認できた場所" in desc:
        found.append("description claims all access conditions are confirmed")
    return found


def gate_rows(text):
    for line in text.splitlines():
        cells = [c.strip() for c in line.strip().strip("|").split("|")]
        if line.startswith("| G") and len(cells) == 9:
            yield cells


def gate_problems(text, *, require_all=False):
    found, seen = [], set()
    rows = list(gate_rows(text))
    for row in rows:
        gid, sev, status = row[0], row[2], row[3]
        if gid in seen:
            found.append(f"{gid}: duplicate id")
        seen.add(gid)
        if sev not in {"P0", "P1", "P2"}:
            found.append(f"{gid}: severity {sev!r}")
        if status not in {"OPEN", "DONE"}:
            found.append(f"{gid}: status {status!r}")
    open_p0 = [r[0] for r in rows if r[2] == "P0" and r[3] == "OPEN"]
    if open_p0 and "**SUBMISSION: BLOCKED**" not in text:
        found.append(f"open P0 {open_p0} but the page does not say SUBMISSION: BLOCKED")
    if require_all:
        for gid in [f"G{i}" for i in range(1, 24)]:
            if gid not in seen:
                found.append(f"{gid}: missing gate")
    return found, rows


class StoreCopyTests(unittest.TestCase):
    def test_committed_copy(self):
        self.assertEqual(copy_problems(ENTRY.read_text(encoding="utf-8")), [])

    def test_tokyo_candidate_is_valid_and_marked_not_live(self):
        text = TOKYO_CANDIDATE.read_text(encoding="utf-8")
        self.assertEqual(copy_problems(text, TOKYO_AREAS, full_entry=False), [])
        self.assertIn("**Status: 準備中.**", text.split("\n## ", 1)[0], "the candidate must say 準備中 before its first section")
        # Some Tokyo places have unknown access conditions, so the copy must not claim every listed place has them confirmed.
        self.assertNotIn("利用条件を確認できた場所", description(text))

    def test_live_copy_names_no_area_production_does_not_serve(self):
        # Until the switch, the live sheet must not name a Tokyo addition.
        desc = description(ENTRY.read_text(encoding="utf-8"))
        self.assertEqual([a for a in TOKYO_AREAS if a not in AREAS and a in desc], [])

    def test_committed_gate(self):
        found, rows = gate_problems(GATE.read_text(encoding="utf-8"), require_all=True)
        self.assertEqual(found, [])
        self.assertEqual([r[0] for r in rows], [f"G{i}" for i in range(1, 24)])

    def test_rejects_lost_photo_legal_gate(self):
        text = GATE.read_text(encoding="utf-8")
        bad = "\n".join(line for line in text.splitlines() if not line.startswith("| G23 |"))
        self.assertIn("G23: missing gate", gate_problems(bad, require_all=True)[0])

    def test_rejects_nationwide_claim(self):
        text = ENTRY.read_text(encoding="utf-8")
        bad = text.replace("現在の掲載地域は", "全国の喫煙所を掲載。現在の掲載地域は", 1)
        self.assertIn("description claims '全国'", copy_problems(bad))

    def test_rejects_metadata_over_limits(self):
        text = ENTRY.read_text(encoding="utf-8")
        for field, count, message in [(r"Name \(ja\)", 31, "name > 30 characters"),
                                      (r"Subtitle \(ja\)", 31, "subtitle > 30 characters"),
                                      (r"Promotional text \(optional\)", 171, "promotional text > 170 characters"),
                                      ("Keywords", 101, "keywords > 100 bytes")]:
            original = entry_value(text, field)
            bad = text.replace(f"`{original}`", f"`{'x' * count}`")
            self.assertIn(message, copy_problems(bad))

    def test_rejects_confirmed_access_claim(self):
        text = ENTRY.read_text(encoding="utf-8")
        bad = text.replace("公的機関の公開データを出典とする場所の一部", "利用条件を確認できた場所")
        self.assertIn("description claims all access conditions are confirmed", copy_problems(bad))

    def test_enabled_photo_copy_is_separate_and_within_description_limit(self):
        entry = ENTRY.read_text(encoding="utf-8")
        packet = FINAL_ASSETS.read_text(encoding="utf-8")
        heading = "### Photo-enabled description replacement — NOT FOR ENTRY before activation evidence"
        section = packet.split(heading, 1)[1].split("### Photo-enabled Review Notes", 1)[0]
        candidate = section.split("```text\n", 1)[1].split("\n```", 1)[0]
        disabled = "現在、場所の報告と写真の送信は利用できません。"
        self.assertIn(disabled, description(entry))
        self.assertNotIn(candidate, description(entry))
        self.assertIn("写真を1〜3枚", candidate)
        self.assertIn("公開されません", candidate)
        self.assertIn("送信や写真の承認だけでは掲載されません", candidate)
        self.assertEqual(copy_problems(entry.replace(disabled, candidate)), [])

    def test_final_assets_handoff_covers_every_submission_gate_without_approving_it(self):
        packet = FINAL_ASSETS.read_text(encoding="utf-8")
        ids = re.findall(r"^\| (G\d+) \|", packet, re.M)
        self.assertEqual(ids, [f"G{i}" for i in range(1, 24)])
        self.assertIn("V1_FINAL_DEVICE_E2E.md", packet)
        self.assertIn("PHOTO_LEGAL_DECISION_PACK.md", packet)
        self.assertIn("V1_PHOTO_ACTIVATION_HANDOFF.md", packet)
        self.assertIn("terms are **not approved; photo intake remains disabled**", packet)
        self.assertIn("PhotoEvidencePolicy.reviewedPhotoTerms", packet)
        self.assertIn("REVIEWED_PHOTO_TERMS", packet)
        self.assertIn("**SUBMISSION: BLOCKED.", packet)
        self.assertIn("NOT RUN here", packet)
        self.assertIn("Destination results do not sync to Watch", packet)
        self.assertIn("no data additions until separately approved", GATE.read_text(encoding="utf-8"))

    def test_rejects_ready_wording_with_open_p0(self):
        bad = "| G1 | x | P0 | OPEN | a | b | 1 | yes | no |\n"
        self.assertNotEqual(gate_problems(bad)[0], [])
        self.assertEqual(gate_problems("**SUBMISSION: BLOCKED**\n" + bad)[0], [])


if __name__ == "__main__":
    sys.exit(0 if unittest.main(exit=False).result.wasSuccessful() else 1)
