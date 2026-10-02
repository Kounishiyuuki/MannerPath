#!/usr/bin/env bash
# Apple app validation. See docs/AGENT_WORKFLOWS.md.
#
# Three gates, all required (set -e: any failure fails `make apple-validate`):
#   1. iOS tests for the MannerPath scheme (also builds the embedded iPhone widget extension)
#   2. watchOS unit tests: the MannerPathWatch Watch AppTests target only. The scheme's test action also lists the
#      Watch UI tests, which are not a gate here, hence -only-testing.
#   3. a watchOS build of the MannerPathWatch Watch App scheme. Kept alongside 2: the build action is what proves the
#      Watch app as shipped (Debug run configuration, with its embedded Watch widget extension) builds, independent
#      of what the test action happens to build.
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

echo "==> watchOS unit tests (${watch_destination})"
xcodebuild test \
  -project "$project" \
  -scheme "MannerPathWatch Watch App" \
  -destination "$watch_destination" \
  -only-testing:"MannerPathWatch Watch AppTests"

echo "==> watchOS build (${watch_destination})"
xcodebuild build \
  -project "$project" \
  -scheme "MannerPathWatch Watch App" \
  -destination "$watch_destination"

echo "==> iPhone built Info.plist API origin"
./scripts/check-iphone-api-base-url.sh
