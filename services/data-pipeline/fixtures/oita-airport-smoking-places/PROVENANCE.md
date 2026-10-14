# 大分空港 喫煙場所 — reviewed normalized page facts (ADR-0018)

This CSV is MannerPath's normalized fact sheet, not a publisher file. No page HTML, prose, image, floor map, screenshot or logo is redistributed.

- Exact internal existence URL: https://www.oita-airport.jp/qa/
- Public source reference: https://www.oita-airport.jp/; exact evidence links stay internal.
- Checked: 2026-10-14 JST; fetched 2026-10-13T17:59:58.689700+00:00, HTTP 200, 51930 bytes, whole-page SHA-256 `7499b8e349dac458c3a1c000b590be44d474a193e44090e6bce038a2b7fe2f93`. HTML remains outside the repository.
- Normalized zones: 2F搭乗待合室|1F旅客ビル北側. One facility-level spot under the same-anchor rule.
- Current operation: listed on the current first-party page as of checkedAt, not a site visit or publisher observation date. No smoking-place hours or tobacco support are stated; those remain unknown. Aggregate access, physical type and environment remain unknown. The name preserves the security qualifier.
- Rights: `factReference`, maintainer D-R; sitepolicy: 著作権について: 著作権・複製配信の表現保護を確認。情報利用・データ取得・データベース化の禁止は確認されず、正規化事実のみ参照。公開リンクはホームページのみ。 Terms: https://www.oita-airport.jp/sitepolicy/. This is an engineering classification, not legal clearance. Publisher objections fail closed.
- Anchor: 国土数値情報 空港データ C28 令和3年度; 国土数値情報 空港データ(C28) 令和3年度 TerminalBuilding cf04_00096 大分空港 C28-21_GML.zip sha256:07d69353a34558d7ebd21d4b5f62b685d4f9b9d0e55c6eed6ce05aefcc6b7b35; point 33.47736100, 131.73272200, JGD2011 geographic. Terminal representative point only, `areaApproximate`, scope `facility`; never an exact smoking point.
- Anchor source: https://nlftp.mlit.go.jp/ksj/gml/datalist/KsjTmplt-C28-v3_0.html ; 商用可, https://nlftp.mlit.go.jp/ksj/other/agreement_02.html ; attribution and processing notice carried in adapter. Source XML/member association individually reviewed in the live batch.
- CSV SHA-256: `76f8a44d95816da7200843ec6b76600da44582f83393a6cc6cf2f55eaeb9bd1b`; one row; first pinned release only, no automatic refresh or cross-release approval.

Live review: Codex source-review, 2026-10-14 JST. Fact scope fingerprint: `df09f30339c6d60437716ccc308555f4a9f7d5062b10d5b856ad26a6aee301e3`. Excluded claims: Original2F cash-corner-rear: D, not matched to current central-stairs-rear; excluded.; Current central-stairs-rear and extra international room not added to this original-surviving-scope package.. Anchor live validation: ZIP digest, XML member digest, airport/terminal/point association and published coordinate all match.

Recheck URLs and normalized fact/rights scopes are pinned in `services/data-pipeline/source-health/review-metadata.json` and `services/api/scripts/source-health.ts`. Review evidence and current exclusions: `docs/research/2026-10-14-nationwide-airport-expansion.json`. Source health is advisory/read-only; only a maintainer-reviewed hold/clear changes publication.
