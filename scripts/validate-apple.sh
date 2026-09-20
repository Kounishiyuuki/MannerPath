#!/usr/bin/env bash
# Apple app validation. See docs/AGENT_WORKFLOWS.md.
set -euo pipefail
cd "$(dirname "$0")/.."

if ! command -v xcodebuild >/dev/null 2>&1; then
  echo "xcodebuild not available; run 'make apple-validate' on a macOS machine with Xcode." >&2
  exit 1
fi

project=apps/apple/MannerPath/MannerPath.xcodeproj
scheme=MannerPath
destination="${MANNERPATH_IOS_DESTINATION:-platform=iOS Simulator,name=iPhone 17}"

exec xcodebuild test \
  -project "$project" \
  -scheme "$scheme" \
  -destination "$destination"
