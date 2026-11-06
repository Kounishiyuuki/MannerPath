#!/usr/bin/env python3
"""Unapproved legal prep must remain outside the public artifact and live consent registry."""
import hashlib
import importlib.util
import json
from pathlib import Path
import re
import tarfile
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]
PACKET = ROOT / 'docs/legal/v1-text-reports'


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


class LegalPrepTests(unittest.TestCase):
    def test_pages_artifact_excludes_unapproved_candidates(self):
        spec = importlib.util.spec_from_file_location('package_pages', ROOT / 'scripts/package-pages-artifact.py')
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        with tempfile.TemporaryDirectory() as directory:
            archive = Path(directory) / 'site.tar'
            module.package_site(ROOT / 'site', archive)
            with tarfile.open(archive) as tar:
                names = tar.getnames()
                self.assertNotIn('docs', names)
                for page in ('privacy/index.html', 'support/index.html'):
                    published = tar.extractfile(page).read()
                    self.assertEqual(published, (ROOT / 'site' / page).read_bytes())
                    self.assertNotEqual(published, (PACKET / 'web' / page).read_bytes())
                self.assertFalse(any('v1-text-reports' in name or 'CANDIDATE' in name for name in names))

    def test_draft_consent_bytes_remain_identical_to_registry(self):
        draft = ROOT / 'docs/legal/REPORT_TERMS_DRAFT.md'
        bundled = ROOT / 'apps/apple/MannerPath/MannerPath/Features/Reports/Terms/report-terms.2026-09-30.draft.md'
        self.assertEqual(draft.read_bytes(), bundled.read_bytes())
        registry = (ROOT / 'services/api/src/reports/terms.ts').read_text()
        self.assertIn(digest(draft), registry)
        self.assertIn('publicationRights: "pending"', registry)
        decision = (ROOT / 'services/api/src/reports/community-publication.ts').read_text()
        self.assertIn('COMMUNITY_PUBLICATION: CommunityPublicationDecision = { state: "pending" }', decision)
        self.assertIn('MAINTAINER-INPUT', (ROOT / 'docs/legal/REPORT_TERMS_CANDIDATE.md').read_text())

    def test_bilingual_candidates_keep_approval_and_privacy_boundaries(self):
        for name in ('privacy', 'support'):
            text = (PACKET / f'web/{name}/index.html').read_text()
            self.assertIn('CANDIDATE — NOT APPROVED', text)
            self.assertIn('<section id="en" lang="en">', text)
            self.assertIn('写真', text)
            self.assertIn('without photos', text)
            self.assertIn('再インストール', text)
            self.assertIn('Reinstall', text)
            self.assertIn('報告ID', text)
            self.assertIn('ID alone', text)
            self.assertNotIn('初回公開版では、アプリからの報告の送信は利用できません', text)
            self.assertNotIn('initial read-only version', text)
        privacy = (PACKET / 'web/privacy/index.html').read_text()
        self.assertIn('no uniform automatic deletion deadline', privacy)
        self.assertIn('アプリ内削除・復旧・自動withdrawalを提供しない', (PACKET / 'FINAL_TEXT_REVIEW.md').read_text())
        self.assertIn('cryptographic key destruction', privacy)
        self.assertIn('not mean anonymous', privacy)
        answers = json.loads((ROOT / 'docs/release/submission-v1/text-reports/app-privacy-candidate.json').read_text())
        self.assertFalse(answers['submissionReady'])
        self.assertFalse(answers['photoDisclosure']['conditionsVerified'])
        for kind in ('Precise Location', 'Other User Content', 'Device ID'):
            row = next(r for r in answers['dataTypes'] if r['ascType'] == kind)
            self.assertTrue(row['collected'])
            self.assertTrue(row['linked'])
            self.assertFalse(row['tracking'])

    def test_decision_packet_keeps_runtime_mismatch_and_unapproved_translation_visible(self):
        choices = (PACKET / 'OWNER_CHOICES.md').read_text()
        self.assertIn('推奨A（条件付き）', choices)
        self.assertIn('予定URL・未公開', choices)
        self.assertIn('残るリスク', choices)
        activation = (PACKET / 'ACTIVATION_DIFF.md').read_text()
        self.assertIn('Your device location and location history are not sent.', activation)
        self.assertIn('This is not complete erasure of all data.', activation)
        english = (ROOT / 'docs/legal/REPORT_TERMS_CANDIDATE_EN.md').read_text()
        self.assertIn('CANDIDATE — NOT APPROVED', english)
        self.assertIn('no uniform automatic deletion deadline', english)
        self.assertIn('An ID helps locate information but is not proof of ownership', english)

    def test_only_three_owner_questions_and_no_assumed_implementation(self):
        decisions = (PACKET / 'DECISIONS.md').read_text()
        self.assertEqual(re.findall(r'^## (Q\d)\.', decisions, re.M), ['Q1', 'Q2', 'Q3'])
        self.assertIn('未承認・未実装部分あり', decisions)
        self.assertIn('LOCAL ONLY', (PACKET / 'CONSISTENCY.md').read_text())
        self.assertIn('現コードにこの期限/削除処理はない', decisions)
        self.assertIn('それだけで申請者本人と認定しません', (ROOT / 'docs/legal/REPORT_TERMS_CANDIDATE.md').read_text())


if __name__ == '__main__':
    unittest.main()
