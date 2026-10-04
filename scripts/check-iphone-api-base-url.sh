#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."

project=apps/apple/MannerPath/MannerPath.xcodeproj
derived_data=$(mktemp -d)
trap 'rm -rf "$derived_data"' EXIT

check_plist() {
  local plist="$derived_data/Build/Products/Debug-iphonesimulator/MannerPath.app/Info.plist"
  local expected="$1"
  local expected_site="$2"
  local actual
  actual=$(plutil -extract MannerPathAPIBaseURL raw "$plist")
  test "$actual" = "$expected"
  actual=$(plutil -extract MannerPathPublicSiteURL raw "$plist")
  test "$actual" = "$expected_site"
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
  CODE_SIGNING_ALLOWED=NO MANNERPATH_API_BASE_URL=https://example.invalid \
  MANNERPATH_PUBLIC_SITE_URL=https://site.example.invalid/MannerPath/
check_plist https://example.invalid https://site.example.invalid/MannerPath/

xcodebuild build -quiet -project "$project" -scheme MannerPath \
  -destination 'generic/platform=iOS Simulator' -derivedDataPath "$derived_data" \
  CODE_SIGNING_ALLOWED=NO MANNERPATH_API_BASE_URL= MANNERPATH_PUBLIC_SITE_URL=
check_plist '' ''
