# 高松空港 喫煙場所 — reviewed normalized page facts (ADR-0018)

This CSV is MannerPath's normalized fact sheet, not a publisher file. No page HTML, prose, image, floor map, screenshot or logo is redistributed.

- Exact internal existence URL: https://www.takamatsu-airport.com/guide/s013/
- Public source reference: https://www.takamatsu-airport.com/; exact evidence links stay internal.
- Checked: 2026-10-14 JST; fetched 2026-10-13T17:59:59.361277+00:00, HTTP 200, 58177 bytes, whole-page SHA-256 `60370993b2a26b9f7c1c2ea3be59a9f796b33c44f45dc852dc0ea237ae55170a`. HTML remains outside the repository.
- Normalized zones: ターミナル中央屋外|2F国際線出発ロビー・ファミリーマート横|2F国内線搭乗待合室. One facility-level spot under the same-anchor rule.
- Current operation: listed on the current first-party page as of checkedAt, not a site visit or publisher observation date. No smoking-place hours or tobacco support are stated; those remain unknown. Aggregate access, physical type and environment remain unknown. The name preserves the security qualifier.
- Rights: `factReference`, maintainer D-R; policy: ホームページの著作権について: 著作権・複製配信の表現保護を確認。情報利用・データ取得・データベース化の禁止は確認されず、正規化事実のみ参照。公開リンクはホームページのみ。 Terms: https://www.takamatsu-airport.com/policy/. This is an engineering classification, not legal clearance. Publisher objections fail closed.
- Anchor: 国土数値情報 空港データ C28 令和3年度; 国土数値情報 空港データ(C28) 令和3年度 TerminalBuilding cf04_00054 高松空港 C28-21_GML.zip sha256:07d69353a34558d7ebd21d4b5f62b685d4f9b9d0e55c6eed6ce05aefcc6b7b35; point 34.21866700, 134.01833300, JGD2011 geographic. Terminal representative point only, `areaApproximate`, scope `facility`; never an exact smoking point.
- Anchor source: https://nlftp.mlit.go.jp/ksj/gml/datalist/KsjTmplt-C28-v3_0.html ; 商用可, https://nlftp.mlit.go.jp/ksj/other/agreement_02.html ; attribution and processing notice carried in adapter. Source XML/member association individually reviewed in the live batch.
- CSV SHA-256: `daff2f45853ae975c603e936621a63cb59a4d45a07425d2f1a312815ff54bf19`; one row; first pinned release only, no automatic refresh or cross-release approval.

The closed international boarding-waiting-room claim is excluded. Current closure notice: https://www.takamatsu-airport.com/news/info/20260612-9764/ (from 2026-06-13 until further notice); the surviving international departure-lobby room is distinct.

Live review: Codex source-review, 2026-10-14 JST. Fact scope fingerprint: `6c2eaf238c545c3d606422828dcdfdaef383ec31d63b531f93b9c3315fa5610d`. Excluded claims: International BOARDING waiting-room closed from2026-06-13 indefinitely; not included. International DEPARTURE LOBBY room is explicit fallback.. Anchor live validation: ZIP digest, XML member digest, airport/terminal/point association and published coordinate all match.

Recheck URLs and normalized fact/rights scopes are pinned in `services/data-pipeline/source-health/review-metadata.json` and `services/api/scripts/source-health.ts`. Review evidence and current exclusions: `docs/research/2026-10-14-nationwide-airport-expansion.json`. Source health is advisory/read-only; only a maintainer-reviewed hold/clear changes publication.
