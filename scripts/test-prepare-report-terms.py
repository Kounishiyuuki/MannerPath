#!/usr/bin/env python3
import hashlib
import importlib.util
from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('prep', Path(__file__).with_name('prepare-report-terms.py'))
prep = importlib.util.module_from_spec(spec)
spec.loader.exec_module(prep)


class TermsPreparationTests(unittest.TestCase):
    def test_manifest_hashes_exact_bytes_but_never_grants_rights_or_installs(self):
        version = 'report-terms.2026-11-05'
        raw = f'# Terms\nVersion: {version}\nFixture text only.\n'.encode()
        result = prep.prepare(raw, version)
        self.assertEqual(result['sha256'], hashlib.sha256(raw).hexdigest())
        self.assertNotEqual(result['sha256'], prep.prepare(raw + b'\n', version)['sha256'])
        self.assertTrue(result['requiresOwnerApproval'])
        self.assertFalse(result['publicationGranted'])
        self.assertFalse(result['writesPerformed'])
        self.assertEqual(Path(result['documentPath']).name, Path(result['iosBundlePath']).name)

    def test_candidate_draft_bad_date_and_missing_version_are_rejected(self):
        for raw, version in [
            ((ROOT / 'docs/legal/REPORT_TERMS_CANDIDATE.md').read_bytes(), 'report-terms.2026-11-05'),
            (b'report-terms.2026-11-05 MAINTAINER-INPUT', 'report-terms.2026-11-05'),
            (b'report-terms.2026-11-05 DRAFT', 'report-terms.2026-11-05'),
            (b'report-terms.2026-11-05', 'report-terms.2026-11-05.draft'),
            (b'report-terms.2026-02-30', 'report-terms.2026-02-30'),
            (b'no version here', 'report-terms.2026-11-05'),
        ]:
            with self.assertRaises(ValueError):
                prep.prepare(raw, version)


if __name__ == '__main__':
    unittest.main()
