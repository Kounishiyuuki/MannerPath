# #35 iPhone + backend + App Attest lane — evidence (2026-09-25)

Evidence for the iPhone, backend and signing rows of `docs/BETA_E2E_CHECKLIST.md`. Only what was
observed on this run is marked `PASS`. Nothing here is a physical-device pass: no row was operated on
a physical iPhone. `docs/BETA_E2E_CHECKLIST.md` is intentionally not updated by this lane.

Machine: macOS 26.6, Xcode 27.0, wrangler 4.135.0. Base: `origin/main` `3ff2169` (after PR #63).

## Classification of the lane's rows (before this run)

| Class | Rows |
| --- | --- |
| Automated (unit/UI/API suites) | P3–P5, P7, P8, P9a, P10, P11, P13, P15–P23 (logic only), B2, B4, B5 (source) |
| Simulator-observed | P1, P3, P5, P8, P9a, P10, P16, P17, A2, A3 |
| Physical iPhone required | P1–P24, S1, A1, A3 |
| Remote backend required | B1, B3, B5 (dashboard), B6, P19, P21, P23, S1 |
| Paid signing required | S1, P21, P23, signed archive preflight |

## Results

| Row | Result | Evidence |
| --- | --- | --- |
| `make contract` | PASS | `MannerPath contract files present.` |
| `make api-validate` | PASS | `tests 199 · pass 199 · fail 0` (after the smoke fix below) |
| `make apple-validate` | PASS | iOS `** TEST SUCCEEDED **`, 123 passed / 0 failed; watchOS `** BUILD SUCCEEDED **` |
| `scripts/test-apple-beta-preflight.py` | PASS | `Ran 15 tests … OK` |
| Unsigned preflight (`MANNERPATH_API_BASE_URL=https://example.invalid make apple-beta-preflight`) | PASS | four bundle IDs + App Group, HTTPS origin, `CFBundleVersion … 1`, embedding present; `Evidence: UNSIGNED BUILD + source entitlements; no signing/device proof` |
| B6 disposable remote deployment (#55 path) | PASS | fresh D1 `mannerpath-e2e-p35`; migrations 0001–0007 applied, `No migrations to apply!`; promotion bundle (1 source release, 32 spots, 5 tile snapshots) executed; Worker `mannerpath-api-e2e-p35` deployed from the generated `--config` (no `env` block) |
| B1 remote tile 200/304/404 | PASS | smoke: `tile 200 … spots=11`, `tile 304 … status=304`, `tileNotPublished 404` |
| B3 remote config, fail-closed reports | PASS | smoke `--expect-reports unavailable`: `configReportsAvailable=false status=503 error=attestationUnavailable`; `8/8 checks passed` |
| Remote spot detail + attribution (P15 server side) | PASS | smoke: `spot detail … schema=valid`, `attribution — sources=1 withoutAttribution=0 detailMatchesTile=true` |
| Signed archive (`xcodebuild archive … -allowProvisioningUpdates`) | **FAIL (blocker)** | see below |
| P21 App Attest register → assert → `201` | NOT RUN | blocked by the signing blocker; App Attest values not set on the E2E Worker |
| P23 bundle version not allowlisted | NOT RUN | same |
| P1–P20, P22, P24, S1, A1–A3 on device | NOT RUN | no signed build could be produced; no device operation |
| B5 dashboard (invocation logs off) | NOT RUN | needs a human look at the Cloudflare dashboard; config side is `AUTO` |

## Found and fixed: remote smoke `tile 304` false failure

The first remote smoke run printed
`FAIL tile 304 — status=304 etag="1-77e1…"` while the `200` had carried `W/"1-77e1…"`.
Cloudflare's edge weakens the ETag when it gzips the `200`. It leaves the bodyless `304` alone.
The server's RFC 9110 weak comparison already handles this. `curl` with `If-None-Match: W/"…"` and
`"…"` both returned `304`, and so does the app's stored tag. The failure was in the smoke script's
strict string equality. `scripts/smoke.ts` now compares the tags with the server's own
`ifNoneMatchMatches`. `publish-api.test.ts` pins that a weakened tag matches and that a different tag
does not. The server, contract and app are unchanged.

## Blocker: the signing team is a Personal team

```
error: Cannot create a iOS App Development provisioning profile for "com.kounishiyuuki.MannerPath".
Personal development teams, including "y k", do not support the App Attest capability.
error: Provisioning profile "iOS Team Provisioning Profile: com.kounishiyuuki.MannerPath" doesn't include the App Groups capability.
error: Signing for "MannerPathWidgets" requires a development team.
error: Signing for "MannerPathWatchWidgets" requires a development team.
```

`DEVELOPMENT_TEAM = 58A7G4U27M` (iPhone and Watch app targets) is a Personal team. A Personal team
cannot provision App Attest or App Groups, so no beta artifact with the shipped entitlements can
be signed. That blocks S1–S4, P21, P23 and every widget/Watch row that depends on the App Group.
The widget targets also have no `DEVELOPMENT_TEAM`. Set it when a paid team is chosen. This is an
account decision, not a code defect, so the project file was not changed. Removing entitlements to get
a build would test a different app and would weaken App Attest, so that was not done.

## What the maintainer must do next

1. Join the Apple Developer Program (paid team). Register the four identifiers with App Group
   `group.com.kounishiyuuki.MannerPath`, and App Attest on `com.kounishiyuuki.MannerPath`.
   Set `DEVELOPMENT_TEAM` for all four targets.
2. Archive: `xcodebuild archive -project apps/apple/MannerPath/MannerPath.xcodeproj -scheme MannerPath
   -configuration Release -destination 'generic/platform=iOS' -archivePath <out>.xcarchive
   -allowProvisioningUpdates 'MANNERPATH_API_BASE_URL=https:/$()/mannerpath-api-e2e-p35.happywestyuki.workers.dev'`,
   then `./scripts/apple-beta-preflight.sh <out>.xcarchive`, and save the output.
3. On the E2E Worker (`services/api`, `C=.wrangler/e2e/p35.json`), set the three values from
   `OPERATIONS.md` "Disposable App Attest E2E environment": `REPORT_APP_ATTEST_APP_ID` =
   `<paid team App ID prefix>.com.kounishiyuuki.MannerPath`, `REPORT_APP_ATTEST_ENVIRONMENT` =
   `development`, `REPORT_APP_ATTEST_BUNDLE_VERSIONS` = the printed `CFBundleVersion`. Then run smoke
   with `--expect-reports appAttest`.
4. On the iPhone (inside Taito tiles `14/14552–14554/6449–6450`): walk P1–P24. For P21, submit a report
   and confirm success; the server returns `201`. For P23, set `REPORT_APP_ATTEST_BUNDLE_VERSIONS` to a
   value that does not contain the installed build, submit, and confirm "Update the app" and that
   the draft is kept. Record device, iOS version, build number and pass/fail per row.
5. Cleanup, after the run: `npx wrangler delete --config .wrangler/e2e/p35.json` and
   `npx wrangler d1 delete mannerpath-e2e-p35`.

## Noticed, not changed

- The published promotion bundle has 32 spots; checklist limitation L1 still says 34 (probably changed
  by the #42 reconciliation). Left for the checklist owner.
- The unsigned preflight build warns `result of call to 'validated()' is unused`
  (`PhoneWatchSync.swift:88`); it is harmless and was not changed.
