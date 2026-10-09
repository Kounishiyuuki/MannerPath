#!/usr/bin/env bash
# Release artifact preflight before TestFlight / the physical-device matrix (docs/beta-e2e/device-release-matrix.md).
#   no argument: unsigned Release archive for generic iOS from the committed Release settings (production API and
#                public-site origins; no override is accepted), then the artifact checks with source entitlements.
#   one argument: a signed MannerPath.app or .xcarchive; reads signed entitlements and embedded profiles.
set -euo pipefail
cd "$(dirname "$0")/.."

if [[ $# -eq 1 ]]; then
  exec python3 scripts/check-apple-beta-artifact.py "$1"
fi
if [[ $# -ne 0 ]]; then
  echo "usage: $0 [signed MannerPath.app or .xcarchive]" >&2
  exit 2
fi
if [[ -n "${MANNERPATH_API_BASE_URL:-}${MANNERPATH_PUBLIC_SITE_URL:-}" ]]; then
  echo "unset MANNERPATH_API_BASE_URL / MANNERPATH_PUBLIC_SITE_URL: the release preflight checks committed Release values" >&2
  exit 2
fi
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT
xcodebuild archive -quiet -project apps/apple/MannerPath/MannerPath.xcodeproj \
  -scheme MannerPath -configuration Release -destination 'generic/platform=iOS' \
  -archivePath "$work/MannerPath.xcarchive" -derivedDataPath "$work/dd" CODE_SIGNING_ALLOWED=NO
python3 scripts/check-apple-beta-artifact.py "$work/MannerPath.xcarchive" --unsigned-build
