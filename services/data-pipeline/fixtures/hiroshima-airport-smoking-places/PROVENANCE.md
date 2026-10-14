# 広島空港 喫煙場所 — reviewed normalized page facts (ADR-0018)

This CSV is MannerPath's normalized fact sheet, not a publisher file. No page HTML, prose, image, floor map, screenshot or logo is redistributed.

- Exact internal existence URL: https://www.hij.airport.jp/news/2025/02/terminalinfo-smokingarea.html
- Public source reference: https://www.hij.airport.jp/; exact evidence links stay internal.
- Checked: 2026-10-14 JST; fetched 2026-10-13T17:59:57.634504+00:00, HTTP 200, 36943 bytes, whole-page SHA-256 `3428dea779a0c36057093aa3acfbe7bde67a161357b7122fc33467852fa4d329`. HTML remains outside the repository.
- Normalized zones: 1F国際線到着ロビー外|2F国際線チェックイン前|3F展望デッキ前. One facility-level spot under the same-anchor rule.
- Current operation: listed on the current first-party page as of checkedAt, not a site visit or publisher observation date. No smoking-place hours or tobacco support are stated; those remain unknown. Aggregate access, physical type and environment remain unknown. The name says 利用条件未確認; no after-security qualifier is inferred for this included scope.
- Rights: `factReference`, maintainer D-R; about/index.html §1; homepage links §2: 著作権・複製配信の表現保護を確認。情報利用・データ取得・データベース化の禁止は確認されず、正規化事実のみ参照。公開リンクはホームページのみ。 Terms: https://www.hij.airport.jp/about/index.html. This is an engineering classification, not legal clearance. Publisher objections fail closed.
- Anchor: 国土数値情報 空港データ C28 令和3年度; 国土数値情報 空港データ(C28) 令和3年度 TerminalBuilding cf04_00079 広島空港 C28-21_GML.zip sha256:07d69353a34558d7ebd21d4b5f62b685d4f9b9d0e55c6eed6ce05aefcc6b7b35; point 34.43986100, 132.91925000, JGD2011 geographic. Terminal representative point only, `areaApproximate`, scope `facility`; never an exact smoking point.
- Anchor source: https://nlftp.mlit.go.jp/ksj/gml/datalist/KsjTmplt-C28-v3_0.html ; 商用可, https://nlftp.mlit.go.jp/ksj/other/agreement_02.html ; attribution and processing notice carried in adapter. Source XML/member association individually reviewed in the live batch.
- CSV SHA-256: `559617124dfa4b85f4439476c45165032be9bad8115cb1e352d97a9f16dfdb8b`; one row; first pinned release only, no automatic refresh or cross-release approval.

Live review: Codex source-review, 2026-10-14 JST. Fact scope fingerprint: `34b51a11f9f0863c15c74fbbb69c390f84528d8fc3ce7662e69ef8dae225fa03`. Excluded claims: 1F domestic-arrival exterior closed2025-02-28; excluded.. Anchor live validation: ZIP digest, XML member digest, airport/terminal/point association and published coordinate all match.

Recheck URLs and normalized fact/rights scopes are pinned in `services/data-pipeline/source-health/review-metadata.json` and `services/api/scripts/source-health.ts`. Review evidence and current exclusions: `docs/research/2026-10-14-nationwide-airport-expansion.json`. Source health is advisory/read-only; only a maintainer-reviewed hold/clear changes publication.
