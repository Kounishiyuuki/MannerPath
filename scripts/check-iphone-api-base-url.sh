#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."

project=apps/apple/MannerPath/MannerPath.xcodeproj
derived_data=$(mktemp -d)
trap 'rm -rf "$derived_data"' EXIT

check_plist() {
  local plist="$derived_data/Build/Products/Debug-iphonesimulator/MannerPath.app/Info.plist"
  local expected="$1"
  local actual
  actual=$(plutil -extract MannerPathAPIBaseURL raw "$plist")
  test "$actual" = "$expected"
  python3 - "$plist" <<'PY'
import plistlib
import sys

with open(sys.argv[1], "rb") as source:
    info = plistlib.load(source)
assert info["CFBundleIdentifier"] == "com.kounishiyuuki.MannerPath"
assert info["CFBundleDisplayName"] == "MannerPath"
assert "UIApplicationSceneManifest" in info
assert "UILaunchScreen" in info
assert info["NSLocationWhenInUseUsageDescription"]
PY
  test ! -f "$derived_data/Build/Products/Debug-iphonesimulator/MannerPath.app/MannerPath-Info.plist"
}

xcodebuild build -quiet -project "$project" -scheme MannerPath \
  -destination 'generic/platform=iOS Simulator' -derivedDataPath "$derived_data" \
  CODE_SIGNING_ALLOWED=NO MANNERPATH_API_BASE_URL=https://example.invalid
check_plist https://example.invalid

xcodebuild build -quiet -project "$project" -scheme MannerPath \
  -destination 'generic/platform=iOS Simulator' -derivedDataPath "$derived_data" \
  CODE_SIGNING_ALLOWED=NO MANNERPATH_API_BASE_URL=
check_plist ''
