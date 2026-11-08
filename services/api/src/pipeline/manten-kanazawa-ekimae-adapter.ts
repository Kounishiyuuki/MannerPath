// ADR-0018 facility source through the shared reviewed-facility adapter. Review: fixtures/manten-kanazawa-ekimae-smoking-places/PROVENANCE.md.
import type { ReleaseMetadata } from "./ingest.ts";
import { reviewedFacilityAdapter } from "./reviewed-facility-adapter.ts";

export const MANTEN_KANAZAWA_EKIMAE_SOURCE_ID = "manten-kanazawa-ekimae-smoking-places";
export const MANTEN_KANAZAWA_EKIMAE_PAGE_URL = "https://www.manten-hotel.com/kanazawa/faq/";
export const MANTEN_KANAZAWA_EKIMAE_FIXTURE_SHA256 = "65f0151bf8b26fc2938d35ea849137560bf6f904dfae115e11fd05ff9f67019a";
export const MANTEN_KANAZAWA_EKIMAE_FIXTURE_RELEASE: ReleaseMetadata = {
  sourceUrl: MANTEN_KANAZAWA_EKIMAE_PAGE_URL, observedOn: "2026-11-08", fetchedAt: "2026-11-08T04:56:55Z", httpLastModified: null,
};
export const MANTEN_KANAZAWA_EKIMAE_ADAPTER = reviewedFacilityAdapter({
  sourceId: MANTEN_KANAZAWA_EKIMAE_SOURCE_ID, slug: "manten-kanazawa-ekimae", displayName: "金沢マンテンホテル駅前 喫煙室（公式サイト）",
  pageUrl: MANTEN_KANAZAWA_EKIMAE_PAGE_URL, fixtureFile: "manten-kanazawa-ekimae-page-facts.csv", fixtureSha256: MANTEN_KANAZAWA_EKIMAE_FIXTURE_SHA256,
  release: MANTEN_KANAZAWA_EKIMAE_FIXTURE_RELEASE,
  values: ["manten-kanazawa-ekimae", "金沢マンテンホテル駅前 喫煙室（1F・4F・7F）", "金沢マンテンホテル駅前", "facility", "1F駐車場入口横・4Fエレベーター付近・7Fエレベーター付近", "石川県金沢市北安江1-6-1", "other", "https://www.manten-hotel.com/kanazawa/faq/", "2026-11-08", "36.581441767", "136.649589106", "officialAddressGeocode", "abr-geocoder 2.3.1 abr-kanazawa-nonoichi-2026-10-26:sha256:7be5d250d29e1fb3befc00b5578b10406b4ba225ade172eb5b1148626a77014d residential_detail 入力=石川県金沢市北安江1-6-1 出力=石川県金沢市北安江1丁目6-1"],
  hostType: "other", environment: "unknown",
  attributionText: `出典：金沢マンテンホテル駅前公式サイト ${MANTEN_KANAZAWA_EKIMAE_PAGE_URL}（2026-11-08確認）。`
    + "位置の目安：アドレス・ベース・レジストリ（デジタル庁、公共データ利用規約1.0）をabr-geocoderで照合した所在地の代表点。"
    + "MannerPathが事実のみを正規化して作成。ピンは施設の代表点で喫煙場所そのものの位置ではありません。運営者・デジタル庁による推奨・保証を意味しません。",
  rightsBasis: { kind: "factReference", pageUrls: [MANTEN_KANAZAWA_EKIMAE_PAGE_URL],
    termsUrls: ["https://www.manten-hotel.com/kanazawa/faq/", "https://manten-hotel.co.jp/privacy/"],
    termsReading: "ホテル公式FAQのフッターは著作権留保（Copyright © Manten hotel Co.,Ltd）。FAQ・ナビゲーション・フッターとリンクされたプライバシーポリシーを確認し、情報利用・データ取得・DB化の明示禁止は確認されず。プライバシーポリシーは個人情報の扱いでコンテンツの利用許諾ではない。ADR-0018 D-Rによる正規化事実（喫煙室の有無・階・所在地）のみの参照で文章・写真・地図・ロゴは複製しない。4F・7Fは客室階のエレベーター付近で、宿泊者以外の利用可否は未確認のまま扱う。オープンライセンスや運営者個別承認ではなく、異議・追加制限は保留・撤回審査。",
    prohibitsInformationUse: false, reviewedBy: "Claude source-review", reviewedOn: "2026-11-08" },
  reviewedBy: "Claude source-review", reviewedOn: "2026-11-08",
});
