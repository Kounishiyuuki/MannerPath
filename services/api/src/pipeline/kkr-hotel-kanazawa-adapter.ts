// ADR-0018 facility source through the shared reviewed-facility adapter. Review: fixtures/kkr-hotel-kanazawa-smoking-places/PROVENANCE.md.
import type { ReleaseMetadata } from "./ingest.ts";
import { reviewedFacilityAdapter } from "./reviewed-facility-adapter.ts";

export const KKR_KANAZAWA_SOURCE_ID = "kkr-hotel-kanazawa-smoking-places";
export const KKR_KANAZAWA_PAGE_URL = "https://kanazawa.kkr.or.jp/facilities/";
export const KKR_KANAZAWA_FIXTURE_SHA256 = "a98489eaf55f133b45b8e62746bbd9b66a883fd6055c22b846714eba8d67a38a";
export const KKR_KANAZAWA_FIXTURE_RELEASE: ReleaseMetadata = {
  sourceUrl: KKR_KANAZAWA_PAGE_URL, observedOn: "2026-11-08", fetchedAt: "2026-11-08T04:28:47Z", httpLastModified: null,
};
export const KKR_KANAZAWA_ADAPTER = reviewedFacilityAdapter({
  sourceId: KKR_KANAZAWA_SOURCE_ID, slug: "kkr-kanazawa", displayName: "KKRホテル金沢 喫煙所（公式サイト）",
  pageUrl: KKR_KANAZAWA_PAGE_URL, fixtureFile: "kkr-hotel-kanazawa-page-facts.csv", fixtureSha256: KKR_KANAZAWA_FIXTURE_SHA256,
  release: KKR_KANAZAWA_FIXTURE_RELEASE,
  values: ["kkr", "KKRホテル金沢 喫煙所（1F・3F）", "KKRホテル金沢", "facility", "1Fロビー入口側・3Fエレベーター側", "石川県金沢市大手町2-32", "other",
    KKR_KANAZAWA_PAGE_URL, "2026-11-08", "36.568729789", "136.660338131", "officialAddressGeocode",
    "abr-geocoder 2.3.1 abr-kanazawa-nonoichi-2026-10-26:sha256:7be5d250d29e1fb3befc00b5578b10406b4ba225ade172eb5b1148626a77014d residential_detail 入力=石川県金沢市大手町2-32 出力=石川県金沢市大手町2-32"],
  hostType: "other", environment: "unknown",
  attributionText: `出典：KKRホテル金沢公式サイト ${KKR_KANAZAWA_PAGE_URL}（2026-11-08確認）。`
    + "位置の目安：アドレス・ベース・レジストリ（デジタル庁、公共データ利用規約1.0）をabr-geocoderで照合した所在地の代表点。"
    + "MannerPathが事実のみを正規化して作成。ピンは施設の代表点で喫煙場所そのものの位置ではありません。運営者・デジタル庁による推奨・保証を意味しません。",
  rightsBasis: { kind: "factReference", pageUrls: [KKR_KANAZAWA_PAGE_URL],
    termsUrls: [KKR_KANAZAWA_PAGE_URL, "https://www.kkr.or.jp/siteriyo.html"],
    termsReading: "フッターは著作権留保（© 国家公務員共済組合連合会）。連合会のサイト利用規約は出所明示での引用・転載・複製を認め、商用目的の複製は事前連絡を求める（リンク先サイトには適用しないとし、金沢の施設サイトへの適用は明記なし）。情報利用・データベース化の明示的禁止は確認されず。正規化事実（喫煙所の有無・階・所在地）のみ参照し、文章・写真・地図は複製しない。オープンライセンスや運営者許諾を意味しない。",
    prohibitsInformationUse: false, reviewedBy: "Claude source-review", reviewedOn: "2026-11-08" },
  reviewedBy: "Claude source-review", reviewedOn: "2026-11-08",
});
