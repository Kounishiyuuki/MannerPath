// ADR-0018 facility source through the shared reviewed-facility adapter. Review: fixtures/smile-hotel-kanazawa-nishiguchi-smoking-places/PROVENANCE.md.
import type { ReleaseMetadata } from "./ingest.ts";
import { reviewedFacilityAdapter } from "./reviewed-facility-adapter.ts";

export const SMILE_HOTEL_KANAZAWA_NISHIGUCHI_SOURCE_ID = "smile-hotel-kanazawa-nishiguchi-smoking-places";
export const SMILE_HOTEL_KANAZAWA_NISHIGUCHI_PAGE_URL = "https://smile-hotels.com/hotels/kanazawanishiguchiekimae/";
export const SMILE_HOTEL_KANAZAWA_NISHIGUCHI_FIXTURE_SHA256 = "0f3e4ab9eac6ac41dca97482a7c01a768addcaa2dd4269926d58a9cd2f8d0b0d";
export const SMILE_HOTEL_KANAZAWA_NISHIGUCHI_FIXTURE_RELEASE: ReleaseMetadata = {
  sourceUrl: SMILE_HOTEL_KANAZAWA_NISHIGUCHI_PAGE_URL, observedOn: "2026-11-08", fetchedAt: "2026-11-08T11:20:13Z", httpLastModified: null,
};
export const SMILE_HOTEL_KANAZAWA_NISHIGUCHI_ADAPTER = reviewedFacilityAdapter({
  sourceId: SMILE_HOTEL_KANAZAWA_NISHIGUCHI_SOURCE_ID, slug: "smile-hotel-kanazawa-nishiguchi", displayName: "スマイルホテル金沢西口駅前 喫煙スペース（公式サイト）",
  pageUrl: SMILE_HOTEL_KANAZAWA_NISHIGUCHI_PAGE_URL, fixtureFile: "smile-hotel-kanazawa-nishiguchi-page-facts.csv", fixtureSha256: SMILE_HOTEL_KANAZAWA_NISHIGUCHI_FIXTURE_SHA256,
  release: SMILE_HOTEL_KANAZAWA_NISHIGUCHI_FIXTURE_RELEASE,
  values: ["smile-hotel-kanazawa-nishiguchi", "スマイルホテル金沢西口駅前 喫煙スペース", "スマイルホテル金沢西口駅前", "facility", "指定の喫煙スペース（場所の記載なし）", "石川県金沢市広岡3丁目2番37号", "other", "https://smile-hotels.com/hotels/kanazawanishiguchiekimae/", "2026-11-08", "36.580760028", "136.644971769", "officialAddressGeocode", "abr-geocoder 2.3.1 abr-kanazawa-nonoichi-2026-10-26:sha256:7be5d250d29e1fb3befc00b5578b10406b4ba225ade172eb5b1148626a77014d residential_detail 入力=石川県金沢市広岡3丁目2番37号 出力=石川県金沢市広岡3丁目2-37"],
  hostType: "other", environment: "unknown",
  attributionText: `出典：スマイルホテル金沢西口駅前公式サイト ${SMILE_HOTEL_KANAZAWA_NISHIGUCHI_PAGE_URL}（2026-11-08確認）。`
    + "位置の目安：アドレス・ベース・レジストリ（デジタル庁、公共データ利用規約1.0）をabr-geocoderで照合した所在地の代表点。"
    + "MannerPathが事実のみを正規化して作成。ピンは施設の代表点で喫煙場所そのものの位置ではありません。運営者・デジタル庁による推奨・保証を意味しません。",
  rightsBasis: { kind: "factReference", pageUrls: [SMILE_HOTEL_KANAZAWA_NISHIGUCHI_PAGE_URL],
    termsUrls: ["https://smile-hotels.com/hotels/kanazawanishiguchiekimae/", "https://smile-hotels.com/privacy-policies/show/kanazawanishiguchiekimae"],
    termsReading: "ホテル公式ページのフッターはCopyright © 2026 smile hotel。施設別の個人情報保護方針・特定商取引法に基づく表記（ホスピタリティパートナーズグループ）は個人情報の取扱いで、コンテンツの利用許諾でも制限でもない。著作権・転載・情報利用・DB化に関する明示禁止は確認されず。ADR-0018 D-Rによる正規化事実（指定の喫煙スペースの有無・所在地）のみの参照で文章・写真・地図・ロゴは複製しない。喫煙スペースの場所・階は公式に記載がなく、推測しない。オープンライセンスや運営者個別承認ではなく、異議・追加制限は保留・撤回審査。",
    prohibitsInformationUse: false, reviewedBy: "Claude source-review", reviewedOn: "2026-11-08" },
  reviewedBy: "Claude source-review", reviewedOn: "2026-11-08",
});
