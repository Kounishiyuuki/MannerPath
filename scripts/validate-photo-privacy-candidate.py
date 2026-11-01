#!/usr/bin/env python3
"""Check proposal consistency offline; never verifies encryption, erasure or release approval."""
import argparse
import json
from pathlib import Path
import plistlib

ROOT = Path(__file__).resolve().parent.parent / "docs/release/submission-v1"


def problems(answers, manifest):
    found = []
    if answers.get("status") != "candidate-not-approved" or answers.get("submissionReady") is not False:
        found.append("This tool accepts unapproved candidates only")
    storage = answers.get("storageReview", {})
    if (storage.get("decision") != "undecided" or storage.get("keyDestructionVerified") is not False
            or storage.get("physicalErasureVerified") is not False
            or storage.get("sqlDeletionProvesPhysicalErasure") is not False):
        found.append("Unresolved design cannot claim verified destruction or physical erasure")
    if storage.get("d1Proposal") != "merged-poc-not-mounted-not-production-enabled":
        found.append("D1 PoC is merged, but not mounted in normal intake or enabled in production")
    history = storage.get("timeTravel", {})
    if (history.get("alwaysOn") is not True or history.get("freeDays") != 7 or history.get("paidDays") != 30
            or history.get("deployedPlanVerified") is not False):
        found.append("Keep documented recovery windows separate from unverified deployed plan")
    if not answers.get("unresolved"):
        found.append("Unresolved approval and operational evidence must remain explicit")
    rows = answers.get("dataTypes", [])
    if not isinstance(rows, list) or any(not isinstance(r, dict) for r in rows):
        return found + ["Invalid dataTypes"]
    required = {"Photos or Videos", "Other User Content", "Device ID", "Precise Location"}
    if not required.issubset({r.get("ascType") for r in rows}):
        found.append("Photo report flow still collects photos, content, device ID and precise pin")
    expected = []
    for row in rows:
        if (row.get("collected") is not True or row.get("linked") is not True
                or row.get("tracking") is not False or row.get("purposes") != ["App Functionality"]):
            found.append("Encryption/storage choice does not remove current collection or linkage")
        expected.append({"NSPrivacyCollectedDataType": row.get("manifestType"),
                         "NSPrivacyCollectedDataTypeLinked": row.get("linked"),
                         "NSPrivacyCollectedDataTypeTracking": row.get("tracking"),
                         "NSPrivacyCollectedDataTypePurposes": ["NSPrivacyCollectedDataTypePurposeAppFunctionality"]})
    if manifest.get("NSPrivacyCollectedDataTypes") != expected:
        found.append("Manifest candidate and proposed ASC answers differ")
    if answers.get("tracking") is not False or manifest.get("NSPrivacyTracking") is not False:
        found.append("Current proposal is not for tracking")
    return found


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--answers", type=Path, default=ROOT / "app-privacy-candidate.json")
    parser.add_argument("--manifest", type=Path, default=ROOT / "PrivacyInfo.photos-enabled.candidate.plist")
    args = parser.parse_args()
    try:
        errors = problems(json.loads(args.answers.read_text()), plistlib.loads(args.manifest.read_bytes()))
    except (OSError, ValueError, TypeError, AttributeError, plistlib.InvalidFileException):
        parser.exit(1, "Invalid privacy candidate files\n")
    print(json.dumps({"candidateConsistency": "FAIL" if errors else "PASS", "submissionReady": False,
                      "implementationVerified": False, "errors": errors}, ensure_ascii=False, indent=2))
    raise SystemExit(bool(errors))
