# 米子鬼太郎空港 喫煙場所 — reviewed normalized page facts (ADR-0018)

This CSV is MannerPath's normalized fact sheet, not a publisher file. No page HTML, prose, image, floor map, screenshot or logo is redistributed.

- Exact internal existence URL: https://www.yonago-air.com/faq
- Public source reference: https://www.yonago-air.com/; exact evidence links stay internal.
- Checked: 2026-10-14 JST; fetched 2026-10-13T17:59:59.340341+00:00, HTTP 200, 50775 bytes, whole-page SHA-256 `955c0c1c46d67d135a78680dcecfb32a05f128773f6ee5b4789ee2ea1cd077d0`. HTML remains outside the repository.
- Normalized zones: 屋外中央出入口付近|2F搭乗待合室. One facility-level spot under the same-anchor rule.
- Current operation: listed on the current first-party page as of checkedAt, not a site visit or publisher observation date. No smoking-place hours or tobacco support are stated; those remain unknown. Aggregate access, physical type and environment remain unknown. The name preserves the security qualifier.
- Rights: `factReference`, maintainer D-R; siteinfo: 著作権について §2: 著作権・複製配信の表現保護を確認。情報利用・データ取得・データベース化の禁止は確認されず、正規化事実のみ参照。公開リンクはホームページのみ。 Terms: https://www.yonago-air.com/siteinfo/. This is an engineering classification, not legal clearance. Publisher objections fail closed.
- Anchor: 国土数値情報 空港データ C28 令和3年度; 国土数値情報 空港データ(C28) 令和3年度 TerminalBuilding cf04_00077 美保飛行場 C28-21_GML.zip sha256:07d69353a34558d7ebd21d4b5f62b685d4f9b9d0e55c6eed6ce05aefcc6b7b35; point 35.50066700, 133.24530600, JGD2011 geographic. Terminal representative point only, `areaApproximate`, scope `facility`; never an exact smoking point.
- Anchor source: https://nlftp.mlit.go.jp/ksj/gml/datalist/KsjTmplt-C28-v3_0.html ; 商用可, https://nlftp.mlit.go.jp/ksj/other/agreement_02.html ; attribution and processing notice carried in adapter. Source XML/member association individually reviewed in the live batch.
- CSV SHA-256: `74049b2178a21075bc574a19ffb41d77b38af05967b1dcc8f48523d0472ff90b`; one row; first pinned release only, no automatic refresh or cross-release approval.

Live review: Codex source-review, 2026-10-14 JST. Fact scope fingerprint: `3af366410b4e3b14de5e04d88e46a6a82c7ee84667c2e801b1eff6238787a078`. Excluded claims: none in reviewed bounded scope. Anchor live validation: ZIP digest, XML member digest, airport/terminal/point association and published coordinate all match.

Recheck URLs and normalized fact/rights scopes are pinned in `services/data-pipeline/source-health/review-metadata.json` and `services/api/scripts/source-health.ts`. Review evidence and current exclusions: `docs/research/2026-10-14-nationwide-airport-expansion.json`. Source health is advisory/read-only; only a maintainer-reviewed hold/clear changes publication.
