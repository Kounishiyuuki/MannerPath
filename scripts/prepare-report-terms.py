#!/usr/bin/env python3
"""Offline, read-only manifest for finalized terms. Never approves or installs terms."""
import argparse
import hashlib
import json
from pathlib import Path
import re
import sys


def prepare(document: bytes, version: str) -> dict:
    if not re.fullmatch(r'report-terms\.\d{4}-\d{2}-\d{2}', version):
        raise ValueError('A new dated version is required')
    from datetime import date
    date.fromisoformat(version[len('report-terms.'):])
    text = document.decode('utf-8')
    if not text.strip() or version not in text or re.search(r'MAINTAINER-INPUT|CANDIDATE|DRAFT|未承認|承認待ち|〔|〕', text, re.I):
        raise ValueError('Unresolved document')
    return {
        'status': 'prepared-not-approved', 'requiresOwnerApproval': True,
        'version': version, 'sha256': hashlib.sha256(document).hexdigest(),
        'documentPath': f'docs/legal/report-terms/{version}.md',
        'iosBundlePath': f'apps/apple/MannerPath/MannerPath/Features/Reports/Terms/{version}.md',
        'checksBeforeActivation': ['owner-final-approval', 'byte-identical-ios-and-api-document',
            'api-registry-version-hash', 'client-summary-and-config-consent-match',
            'privacy-support-live-url-and-archive-report', 'no-retroactive-draft-rights',
            'independent-review-and-source-rights-gates'],
        'publicationGranted': False, 'writesPerformed': False,
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--document', required=True, type=Path)
    parser.add_argument('--version', required=True)
    args = parser.parse_args()
    try:
        result = prepare(args.document.read_bytes(), args.version)
    except (OSError, ValueError, UnicodeError):
        print(json.dumps({'status': 'blocked', 'reason': 'invalid-or-unresolved-document'}))
        return 1
    print(json.dumps(result, ensure_ascii=False, indent=2))
    return 0


if __name__ == '__main__':
    sys.exit(main())
