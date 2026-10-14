# 松山空港 喫煙場所 — reviewed normalized page facts (ADR-0018)

This CSV is MannerPath's normalized fact sheet, not a publisher file. No page HTML, prose, image, floor map, screenshot or logo is redistributed.

- Exact internal existence URL: https://www.matsuyama-airport.co.jp/service/smoking.html
- Public source reference: https://www.matsuyama-airport.co.jp/; exact evidence links stay internal.
- Checked: 2026-10-14 JST; fetched 2026-10-13T17:59:58.394162+00:00, HTTP 200, 25629 bytes, whole-page SHA-256 `7b324db44f74df35a86ec2db1279541317d6e8270aae6495cbc2ed17d84f4452`. HTML remains outside the repository.
- Normalized zones: 国内線2F出発ロビー|国内線2F搭乗待合室|国際線2F搭乗待合室|屋外ジェットスターカウンター東側|屋外国際線到着口側. One facility-level spot under the same-anchor rule.
- Current operation: listed on the current first-party page as of checkedAt, not a site visit or publisher observation date. No smoking-place hours or tobacco support are stated; those remain unknown. Aggregate access, physical type and environment remain unknown. The name preserves the security qualifier.
- Rights: `factReference`, maintainer D-R; links.html: リンクについて: 著作権・複製配信の表現保護を確認。情報利用・データ取得・データベース化の禁止は確認されず、正規化事実のみ参照。公開リンクはホームページのみ。 Terms: https://www.matsuyama-airport.co.jp/links.html. This is an engineering classification, not legal clearance. Publisher objections fail closed.
- Anchor: 国土数値情報 空港データ C28 令和3年度; 国土数値情報 空港データ(C28) 令和3年度 TerminalBuilding cf04_00053 松山空港 C28-21_GML.zip sha256:07d69353a34558d7ebd21d4b5f62b685d4f9b9d0e55c6eed6ce05aefcc6b7b35; point 33.82877800, 132.70411100, JGD2011 geographic. Terminal representative point only, `areaApproximate`, scope `facility`; never an exact smoking point.
- Anchor source: https://nlftp.mlit.go.jp/ksj/gml/datalist/KsjTmplt-C28-v3_0.html ; 商用可, https://nlftp.mlit.go.jp/ksj/other/agreement_02.html ; attribution and processing notice carried in adapter. Source XML/member association individually reviewed in the live batch.
- CSV SHA-256: `fdb3471cd4880b47d698f2dc0480c8523d1f490f33f7815f8ad4a072831e918e`; one row; first pinned release only, no automatic refresh or cross-release approval.

Live review: Codex source-review, 2026-10-14 JST. Fact scope fingerprint: `a142bf657a403a08a4d496bcec7b259168f1ecfb5fd0b26c3d4356e5432d17ec`. Excluded claims: none in reviewed bounded scope. Anchor live validation: ZIP digest, XML member digest, airport/terminal/point association and published coordinate all match.

Recheck URLs and normalized fact/rights scopes are pinned in `services/data-pipeline/source-health/review-metadata.json` and `services/api/scripts/source-health.ts`. Review evidence and current exclusions: `docs/research/2026-10-14-nationwide-airport-expansion.json`. Source health is advisory/read-only; only a maintainer-reviewed hold/clear changes publication.
