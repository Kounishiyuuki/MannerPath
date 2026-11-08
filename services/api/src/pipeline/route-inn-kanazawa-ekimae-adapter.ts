// ADR-0018 facility source through the shared reviewed-facility adapter. Review: fixtures/route-inn-kanazawa-ekimae-smoking-places/PROVENANCE.md.
import type { ReleaseMetadata } from "./ingest.ts";
import { reviewedFacilityAdapter } from "./reviewed-facility-adapter.ts";

export const ROUTE_INN_KANAZAWA_EKIMAE_SOURCE_ID = "route-inn-kanazawa-ekimae-smoking-places";
export const ROUTE_INN_KANAZAWA_EKIMAE_PAGE_URL = "https://www.route-inn.co.jp/hotel_list/ishikawa/index_hotel_id_231/facilitiesetc/";
export const ROUTE_INN_KANAZAWA_EKIMAE_FIXTURE_SHA256 = "4c3b9f32a145371b2bd45a38d9a0ccfba3ad05609886a264d02c60f1ac29035f";
export const ROUTE_INN_KANAZAWA_EKIMAE_FIXTURE_RELEASE: ReleaseMetadata = {
  sourceUrl: ROUTE_INN_KANAZAWA_EKIMAE_PAGE_URL, observedOn: "2026-11-08", fetchedAt: "2026-11-08T04:56:58Z", httpLastModified: null,
};
export const ROUTE_INN_KANAZAWA_EKIMAE_ADAPTER = reviewedFacilityAdapter({
  sourceId: ROUTE_INN_KANAZAWA_EKIMAE_SOURCE_ID, slug: "route-inn-kanazawa-ekimae", displayName: "ホテルルートイン金沢駅前 喫煙スペース（公式サイト）",
  pageUrl: ROUTE_INN_KANAZAWA_EKIMAE_PAGE_URL, fixtureFile: "route-inn-kanazawa-ekimae-page-facts.csv", fixtureSha256: ROUTE_INN_KANAZAWA_EKIMAE_FIXTURE_SHA256,
  release: ROUTE_INN_KANAZAWA_EKIMAE_FIXTURE_RELEASE,
  values: ["route-inn-kanazawa-ekimae", "ホテルルートイン金沢駅前 喫煙スペース（1F）", "ホテルルートイン金沢駅前", "facility", "1F", "石川県金沢市昭和町22番5号", "other", "https://www.route-inn.co.jp/hotel_list/ishikawa/index_hotel_id_231/facilitiesetc/", "2026-11-08", "36.574896175", "136.646092219", "officialAddressGeocode", "abr-geocoder 2.3.1 abr-kanazawa-nonoichi-2026-10-26:sha256:7be5d250d29e1fb3befc00b5578b10406b4ba225ade172eb5b1148626a77014d residential_detail 入力=石川県金沢市昭和町22番5号 出力=石川県金沢市昭和町22-5"],
  hostType: "other", environment: "unknown",
  attributionText: `出典：ホテルルートイン金沢駅前公式サイト ${ROUTE_INN_KANAZAWA_EKIMAE_PAGE_URL}（2026-11-08確認）。`
    + "位置の目安：アドレス・ベース・レジストリ（デジタル庁、公共データ利用規約1.0）をabr-geocoderで照合した所在地の代表点。"
    + "MannerPathが事実のみを正規化して作成。ピンは施設の代表点で喫煙場所そのものの位置ではありません。運営者・デジタル庁による推奨・保証を意味しません。",
  rightsBasis: { kind: "factReference", pageUrls: [ROUTE_INN_KANAZAWA_EKIMAE_PAGE_URL],
    termsUrls: ["https://www.route-inn.co.jp/hotel_list/ishikawa/index_hotel_id_231/facilitiesetc/", "https://www.route-inn.co.jp/reserve_rules/kiyaku/", "https://www.route-inn.co.jp/company/privacy/"],
    termsReading: "ホテル公式ページのフッターは著作権留保（Copyright © Route Inn Japan co., Ltd.）。フッターからリンクされたインターネット会員利用規約は会員サービスの利用に関する規約で、著作権等の権利侵害行為を禁止するが、公開ページの情報利用・データ取得・DB化の明示禁止は確認されず。プライバシーポリシーは個人情報の扱い。ADR-0018 D-Rによる正規化事実（喫煙スペースの有無・階・所在地）のみの参照で文章・写真・地図・ロゴは複製しない。加熱式たばこ専用の客室は客室であり、この共用喫煙スペースの情報に含めない。オープンライセンスや運営者個別承認ではなく、異議・追加制限は保留・撤回審査。",
    prohibitsInformationUse: false, reviewedBy: "Claude source-review", reviewedOn: "2026-11-08" },
  reviewedBy: "Claude source-review", reviewedOn: "2026-11-08",
});
