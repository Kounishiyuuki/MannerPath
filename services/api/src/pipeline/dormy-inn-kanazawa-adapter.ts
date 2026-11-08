// ADR-0018 facility source through the shared reviewed-facility adapter. Review: fixtures/dormy-inn-kanazawa-smoking-places/PROVENANCE.md.
import type { ReleaseMetadata } from "./ingest.ts";
import { reviewedFacilityAdapter } from "./reviewed-facility-adapter.ts";

export const DORMY_INN_KANAZAWA_SOURCE_ID = "dormy-inn-kanazawa-smoking-places";
export const DORMY_INN_KANAZAWA_PAGE_URL = "https://dormy-hotels.com/dormyinn/hotels/kanazawa/rooms/";
export const DORMY_INN_KANAZAWA_FIXTURE_SHA256 = "9703a8b70e8b84d955af6cb01f64a13f54a1ce40908f46011cabbcaac0bca864";
export const DORMY_INN_KANAZAWA_FIXTURE_RELEASE: ReleaseMetadata = {
  sourceUrl: DORMY_INN_KANAZAWA_PAGE_URL, observedOn: "2026-11-08", fetchedAt: "2026-11-08T11:20:09Z", httpLastModified: null,
};
export const DORMY_INN_KANAZAWA_ADAPTER = reviewedFacilityAdapter({
  sourceId: DORMY_INN_KANAZAWA_SOURCE_ID, slug: "dormy-inn-kanazawa", displayName: "天然温泉 加賀の湧泉 ドーミーイン金沢 喫煙ブース（公式サイト）",
  pageUrl: DORMY_INN_KANAZAWA_PAGE_URL, fixtureFile: "dormy-inn-kanazawa-page-facts.csv", fixtureSha256: DORMY_INN_KANAZAWA_FIXTURE_SHA256,
  release: DORMY_INN_KANAZAWA_FIXTURE_RELEASE,
  values: ["dormy-inn-kanazawa", "天然温泉 加賀の湧泉 ドーミーイン金沢 喫煙ブース（1F）", "天然温泉 加賀の湧泉 ドーミーイン金沢", "facility", "1F", "石川県金沢市堀川新町2-25", "other", "https://dormy-hotels.com/dormyinn/hotels/kanazawa/rooms/", "2026-11-08", "36.579348656", "136.650432875", "officialAddressGeocode", "abr-geocoder 2.3.1 abr-kanazawa-nonoichi-2026-10-26:sha256:7be5d250d29e1fb3befc00b5578b10406b4ba225ade172eb5b1148626a77014d residential_detail 入力=石川県金沢市堀川新町2-25 出力=石川県金沢市堀川新町2-25"],
  hostType: "other", environment: "unknown",
  attributionText: `出典：天然温泉 加賀の湧泉 ドーミーイン金沢公式サイト ${DORMY_INN_KANAZAWA_PAGE_URL}（2026-11-08確認）。`
    + "位置の目安：アドレス・ベース・レジストリ（デジタル庁、公共データ利用規約1.0）をabr-geocoderで照合した所在地の代表点。"
    + "MannerPathが事実のみを正規化して作成。ピンは施設の代表点で喫煙場所そのものの位置ではありません。運営者・デジタル庁による推奨・保証を意味しません。",
  rightsBasis: { kind: "factReference", pageUrls: [DORMY_INN_KANAZAWA_PAGE_URL],
    termsUrls: ["https://dormy-hotels.com/dormyinn/hotels/kanazawa/rooms/", "https://dormy-hotels.com/dormyinn/hotels/kanazawa/access/", "https://dormy-hotels.com/terms/"],
    termsReading: "ホテル公式ページのフッターは© kyoritsugroup.co.jp All rights reserved.。所在地はアクセスページの「金沢市堀川新町2-25」（県名は既存の住所補完規則で補う）。ご利用規約の対象は株式会社共立メンテナンスの「本サービス」で、第12条は当社が本サービスを通じて提供する著作物の利用を原則として私的使用の範囲に限り、第11条は当社の承諾なく本サービスを通じて営利を目的とした行為を禁じる。事実の参照や情報利用・DB化を明示的に禁止する条項はなく、両条項は文脈として記録する。ADR-0018 D-Rによる正規化事実（喫煙ブースの有無・階・所在地）のみの参照で文章・写真・地図・ロゴは複製しない。7F喫煙フロアーは客室で登録しない。オープンライセンスや運営者個別承認ではなく、異議・追加制限は保留・撤回審査。",
    prohibitsInformationUse: false, reviewedBy: "Claude source-review", reviewedOn: "2026-11-08" },
  reviewedBy: "Claude source-review", reviewedOn: "2026-11-08",
});
