// ADR-0018 facility source through the shared reviewed-facility adapter. Review: fixtures/hotel-sanraku-kanazawa-smoking-places/PROVENANCE.md.
import type { ReleaseMetadata } from "./ingest.ts";
import { reviewedFacilityAdapter } from "./reviewed-facility-adapter.ts";

export const HOTEL_SANRAKU_KANAZAWA_SOURCE_ID = "hotel-sanraku-kanazawa-smoking-places";
export const HOTEL_SANRAKU_KANAZAWA_PAGE_URL = "https://sanraku.kenhotels.com/hakuchoro/faq/";
export const HOTEL_SANRAKU_KANAZAWA_FIXTURE_SHA256 = "5a86fa29639fa2968de9ba92b3773bbf2acf7d9bd150b254b8bab8dea0f54384";
export const HOTEL_SANRAKU_KANAZAWA_FIXTURE_RELEASE: ReleaseMetadata = {
  sourceUrl: HOTEL_SANRAKU_KANAZAWA_PAGE_URL, observedOn: "2026-11-08", fetchedAt: "2026-11-08T04:56:57Z", httpLastModified: null,
};
export const HOTEL_SANRAKU_KANAZAWA_ADAPTER = reviewedFacilityAdapter({
  sourceId: HOTEL_SANRAKU_KANAZAWA_SOURCE_ID, slug: "hotel-sanraku-kanazawa", displayName: "金沢白鳥路 ホテル山楽 喫煙スペース（公式サイト）",
  pageUrl: HOTEL_SANRAKU_KANAZAWA_PAGE_URL, fixtureFile: "hotel-sanraku-kanazawa-page-facts.csv", fixtureSha256: HOTEL_SANRAKU_KANAZAWA_FIXTURE_SHA256,
  release: HOTEL_SANRAKU_KANAZAWA_FIXTURE_RELEASE,
  values: ["hotel-sanraku-kanazawa", "金沢白鳥路 ホテル山楽 喫煙スペース（エントランス付近屋外・地下駐車場）", "金沢白鳥路 ホテル山楽", "facility", "ロビーエントランス付近の屋外・地下駐車場", "石川県金沢市丸の内6-3", "other", "https://sanraku.kenhotels.com/hakuchoro/faq/", "2026-11-08", "36.568208225", "136.662038903", "officialAddressGeocode", "abr-geocoder 2.3.1 abr-kanazawa-nonoichi-2026-10-26:sha256:7be5d250d29e1fb3befc00b5578b10406b4ba225ade172eb5b1148626a77014d residential_detail 入力=石川県金沢市丸の内6-3 出力=石川県金沢市丸の内6-3"],
  hostType: "other", environment: "unknown",
  attributionText: `出典：金沢白鳥路 ホテル山楽公式サイト ${HOTEL_SANRAKU_KANAZAWA_PAGE_URL}（2026-11-08確認）。`
    + "位置の目安：アドレス・ベース・レジストリ（デジタル庁、公共データ利用規約1.0）をabr-geocoderで照合した所在地の代表点。"
    + "MannerPathが事実のみを正規化して作成。ピンは施設の代表点で喫煙場所そのものの位置ではありません。運営者・デジタル庁による推奨・保証を意味しません。",
  rightsBasis: { kind: "factReference", pageUrls: [HOTEL_SANRAKU_KANAZAWA_PAGE_URL],
    termsUrls: ["https://sanraku.kenhotels.com/hakuchoro/faq/", "https://kenhotels.com/privacy/"],
    termsReading: "ホテル公式FAQのフッターは© Ken Hotels & Resorts Holdings Ltd.。FAQ・ナビゲーション・フッターとリンクされたプライバシーポリシーを確認し、情報利用・データ取得・DB化の明示禁止は確認されず。プライバシーポリシーは個人情報の扱いでコンテンツの利用許諾ではない。ADR-0018 D-Rによる正規化事実（喫煙スペースの有無・場所の区分・所在地）のみの参照で文章・写真・地図・ロゴは複製しない。館内は全館禁煙で喫煙ルームはないと公式FAQが述べるため、館内喫煙室としては扱わない。オープンライセンスや運営者個別承認ではなく、異議・追加制限は保留・撤回審査。",
    prohibitsInformationUse: false, reviewedBy: "Claude source-review", reviewedOn: "2026-11-08" },
  reviewedBy: "Claude source-review", reviewedOn: "2026-11-08",
});
