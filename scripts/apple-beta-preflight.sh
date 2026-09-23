#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."

if [[ $# -eq 1 ]]; then
  exec python3 scripts/check-apple-beta-artifact.py "$1"
fi
if [[ $# -ne 0 ]]; then
  echo "usage: $0 [signed MannerPath.app or .xcarchive]" >&2
  exit 2
fi
: "${MANNERPATH_API_BASE_URL:?Set MANNERPATH_API_BASE_URL to the beta HTTPS origin}"
derived_data=$(mktemp -d)
trap 'rm -rf "$derived_data"' EXIT
xcodebuild build -quiet -project apps/apple/MannerPath/MannerPath.xcodeproj \
  -scheme MannerPath -configuration Release -destination 'generic/platform=iOS Simulator' \
  -derivedDataPath "$derived_data" CODE_SIGNING_ALLOWED=NO \
  MANNERPATH_API_BASE_URL="$MANNERPATH_API_BASE_URL"
python3 scripts/check-apple-beta-artifact.py \
  "$derived_data/Build/Products/Release-iphonesimulator/MannerPath.app" --unsigned-build
