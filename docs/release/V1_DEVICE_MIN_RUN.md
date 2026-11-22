# v1.0 shortest device run (maintainer operation)

Every device row still open for v1.0, deduplicated into three sessions. Row IDs are the
[device matrix](../beta-e2e/device-release-matrix.md) §4 rows; gates are the
[release gate](../V1_APP_STORE_RELEASE_GATE.md). Photos are v1.1 and not part of this run.

**Which build:** a matrix cell becomes `PASS 1.0 (N)` only on the build that is submitted (G15, G17, G21). The
dev-signed Release 1.0 (8) on the iPhone today is a rehearsal: its results are observations, not PASS. To avoid doing
the run twice, do it once on the distribution-signed 1.0 (8) (TestFlight internal) after G14/G21 are approved.

Record each row as observed; leave a row blank if it was not seen. No production writes in sessions A and B.

## Session A — iPhone, anywhere outside Tokyo (≈ 40 min)

Start: delete the app. Location not yet granted. Japanese device.

| Step | Do | Rows |
| --- | --- | --- |
| A1 | Install, launch | P1 (eligibility notice first, Japanese), AI1 (no crash) |
| A2 | Open Nearby, tap 「現在地を使用」, allow While Using | P4 (prompt only after the tap) |
| A3 | In search, type 「上野」 one character at a time; then 「上野駅」 quickly; tap a match while typing | L1, L2, L5, U2 |
| A4 | Select 上野駅 (Tokyo) | D1 (first match), D2 (destination row), D5 (far-destination text, no route failure) |
| A5 | Drag the sheet medium ↔ large; read map and list | U1, D3, U3 |
| A6 | Open a place from a row and from a pin; tap walking directions | P10, D4 (distance from destination), P14 (Apple Maps at the spot) |
| A7 | Open About: support and privacy links, mail compose; open a place detail | G13; R1 (「受付停止」 while production intake is paused, no report request while browsing) |
| A8 | Airplane mode, force-quit, relaunch | P8/P9b (cached list, honest failure text) |
| A9 | Settings: largest accessibility text + Reduce Transparency; repeat A3–A6 briefly | P17, L8, U5 |
| A10 | VoiceOver on; search, pick a match, list rows, pins, filters, detail | A1, L7, U7 |

## Session B — iPhone + Apple Watch inside a covered area (≈ 40 min, plus 1 h wait)

Needs real nearby data: a covered area (for example Taito, Minato, Osaka City, Kyoto City). Tokyo destination search
from an uncovered area cannot populate the Watch. Start with the Watch app freshly installed and iPhone Nearby not yet
opened.

| Step | Do | Rows |
| --- | --- | --- |
| B1 | Open the Watch app before the iPhone | W1 (first-use notice, "open iPhone to sync") |
| B2 | Open iPhone Nearby, then the Watch app; look at iPhone and Watch widgets | W2, G2/S1/S2, G3/G3b, WG2/S3–S4 |
| B3 | Refresh twice; reinstall the iPhone app only | W2c |
| B4 | Open each detail type on the Watch (exact, approximate, unknown precision) | W5b |
| B5 | Watch large text; VoiceOver on the Watch | W9/W10, A1W |
| B6 | iPhone off or out of range, Watch radios off; force-quit and reopen | W3 |
| B7 | Leave for more than 1 h, reopen | W5 |

## Session C — text-only report on the signed build (only after G16 and G23)

Production intake stays paused until approved, so this session cannot run before then. When it can: one real,
unlisted smoking location, sent once; check the receipt, then resend after relaunch (G17 "text-only acceptance and
resend"). Record the screen for the Review Notes step 4 alternative (G12). Do not create dummy production reports.

## Not in this run

- Photo checks (v1.1): see [V1_FINAL_DEVICE_E2E.md](V1_FINAL_DEVICE_E2E.md) §3.4–3.5 and its v1.1 list.
- Store screenshots (G10): separate capture procedure in
  [PREP_1_0_8.md](submission-v1/text-reports/PREP_1_0_8.md) §4. The Watch capture can share session B.
