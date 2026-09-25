#!/usr/bin/env bash
# iPhone UI tests (MannerPathUITests) against a local Worker with the published Taito fixture.
#
# Everything the app cannot do for itself is prepared here with simctl, never in app code:
# a fresh simulator, Japanese locale, a fixed location in Taito, location permission,
# appearance, text size, a stopped Worker, and a reinstalled app. Each phase runs the test
# class that expects that state. Needs no signing team, no device, no network beyond localhost.
#
# Result bundles (with screenshots) go to $MANNERPATH_UI_RESULTS (default: a temp directory).
set -euo pipefail
cd "$(dirname "$0")/.."

project=apps/apple/MannerPath/MannerPath.xcodeproj
bundle_id=com.kounishiyuuki.MannerPath
results="${MANNERPATH_UI_RESULTS:-$(mktemp -d -t mannerpath-ui)}"
derived="$results/DerivedData"
worker_log="$results/worker.log"
failed_phases=()
worker_pid=""
mkdir -p "$results"
# Wrangler's metrics/update checks reach the internet and have hung setup indefinitely.
export WRANGLER_SEND_METRICS=false

kill_tree() {
  local child
  for child in $(pgrep -P "$1"); do kill_tree "$child"; done
  kill -TERM "$1" 2>/dev/null || true
}

# Runs a command with a hard time limit (macOS has no timeout(1)); returns 124 when exceeded.
bounded() {
  local seconds=$1 label=$2 pid waited=0
  shift 2
  "$@" &
  pid=$!
  while kill -0 "$pid" 2>/dev/null; do
    if (( waited >= seconds )); then
      echo "$label exceeded ${seconds}s; stopping it" >&2
      kill_tree "$pid"
      wait "$pid" 2>/dev/null || true
      return 124
    fi
    sleep 1
    waited=$((waited + 1))
  done
  wait "$pid"
}

sim=$(xcrun simctl create mannerpath-ui-tests "iPhone 17")
cleanup() {
  [[ -n "$worker_pid" ]] && kill_tree "$worker_pid"
  xcrun simctl delete "$sim" 2>/dev/null || true
}
trap cleanup EXIT

xcrun simctl boot "$sim"
xcrun simctl spawn "$sim" defaults write -g AppleLanguages -array ja-JP
xcrun simctl spawn "$sim" defaults write -g AppleLocale ja_JP
xcrun simctl location "$sim" set 35.7118,139.7775

start_worker() {
  (cd services/api && npm run --silent dev >"$worker_log" 2>&1) &
  worker_pid=$!
  for _ in $(seq 60); do
    curl -fsS http://127.0.0.1:8787/v1/config >/dev/null 2>&1 && return 0
    sleep 1
  done
  echo "Local Worker did not start; see $worker_log" >&2
  exit 1
}

stop_worker() {
  [[ -n "$worker_pid" ]] && kill_tree "$worker_pid"
  pkill -f "wrangler dev --local" 2>/dev/null || true
  worker_pid=""
  sleep 2
}

setup_data() {
  cd services/api
  npm run --silent local:migrate && npm run --silent local:registry && npm run --silent local:pipeline
}
bounded 300 "Local data setup" setup_data >"$results/setup.log" 2>&1 </dev/null


bounded 1200 "build-for-testing" xcodebuild build-for-testing -quiet \
  -project "$project" -scheme MannerPathUITests \
  -destination "id=$sim" -derivedDataPath "$derived" \
  MANNERPATH_API_BASE_URL=http://127.0.0.1:8787

app_path=$(find "$derived/Build/Products" -maxdepth 2 -name MannerPath.app -path "*iphonesimulator*" | head -1)

fresh_install() {
  xcrun simctl uninstall "$sim" "$bundle_id" 2>/dev/null || true
  xcrun simctl install "$sim" "$app_path"
}

run_phase() {
  local phase=$1; shift
  echo "==> UI tests: $phase"
  # Re-apply the fixed location: a long-booted simulator can stop delivering it.
  xcrun simctl location "$sim" set 35.7118,139.7775
  TEST_RUNNER_MP_PHASE="$phase" bounded 1800 "UI phase $phase" xcodebuild test-without-building \
    -project "$project" -scheme MannerPathUITests \
    -destination "id=$sim" -derivedDataPath "$derived" \
    -resultBundlePath "$results/$phase.xcresult" \
    -parallel-testing-enabled NO \
    -test-timeouts-enabled YES -default-test-execution-time-allowance 300 \
    "$@" || failed_phases+=("$phase")
}

start_worker

fresh_install
run_phase first-launch -only-testing:MannerPathUITests/A_FirstLaunchUITests
run_phase not-determined -only-testing:MannerPathUITests/F_LocationNotDeterminedUITests

xcrun simctl privacy "$sim" grant location "$bundle_id"
run_phase light -only-testing:MannerPathUITests/B_OnlineUITests

xcrun simctl ui "$sim" appearance dark
run_phase dark \
  -only-testing:MannerPathUITests/B_OnlineUITests/testNearbyLoadedShowsMapAndFirstResultWithoutScrolling \
  -only-testing:MannerPathUITests/B_OnlineUITests/testListRowOpensDetailWithKeySections
xcrun simctl ui "$sim" appearance light

xcrun simctl ui "$sim" content_size accessibility-extra-extra-extra-large
run_phase large-text \
  -only-testing:MannerPathUITests/B_OnlineUITests/testNearbyLoadedShowsMapAndFirstResultWithoutScrolling \
  -only-testing:MannerPathUITests/B_OnlineUITests/testListRowOpensDetailWithKeySections
xcrun simctl ui "$sim" content_size large

stop_worker
run_phase offline-cached -only-testing:MannerPathUITests/C_OfflineWithCacheUITests

fresh_install
xcrun simctl privacy "$sim" grant location "$bundle_id"
run_phase clean-offline -only-testing:MannerPathUITests/D_CleanOfflineUITests

xcrun simctl privacy "$sim" revoke location "$bundle_id"
run_phase denied -only-testing:MannerPathUITests/E_LocationDeniedUITests

echo "Result bundles: $results"
if (( ${#failed_phases[@]} )); then
  echo "Failed phases: ${failed_phases[*]}" >&2
  exit 1
fi
echo "All iPhone UI test phases passed."
