#!/usr/bin/env bash
# Apple app validation. See docs/AGENT_WORKFLOWS.md.
#
# Two gates, both required:
#   1. iOS tests for the MannerPath scheme
#   2. a watchOS build of the MannerPathWatch Watch App scheme
# Override the simulators with MANNERPATH_IOS_DESTINATION / MANNERPATH_WATCH_DESTINATION.
set -euo pipefail
cd "$(dirname "$0")/.."

if ! command -v xcodebuild >/dev/null 2>&1; then
  echo "xcodebuild not available; run 'make apple-validate' on a macOS machine with Xcode." >&2
  exit 1
fi

project=apps/apple/MannerPath/MannerPath.xcodeproj
ios_destination="${MANNERPATH_IOS_DESTINATION:-platform=iOS Simulator,name=iPhone 17}"
watch_destination="${MANNERPATH_WATCH_DESTINATION:-platform=watchOS Simulator,name=Apple Watch Series 10 (46mm)}"

echo "==> iOS tests (${ios_destination})"
xcodebuild test \
  -project "$project" \
  -scheme "MannerPath" \
  -destination "$ios_destination"

echo "==> watchOS build (${watch_destination})"
xcodebuild build \
  -project "$project" \
  -scheme "MannerPathWatch Watch App" \
  -destination "$watch_destination"
