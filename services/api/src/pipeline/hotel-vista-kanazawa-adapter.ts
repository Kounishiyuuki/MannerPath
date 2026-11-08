// ADR-0018 facility source through the shared reviewed-facility adapter. Review: fixtures/hotel-vista-kanazawa-smoking-places/PROVENANCE.md.
import type { ReleaseMetadata } from "./ingest.ts";
import { reviewedFacilityAdapter } from "./reviewed-facility-adapter.ts";

export const HOTEL_VISTA_KANAZAWA_SOURCE_ID = "hotel-vista-kanazawa-smoking-places";
export const HOTEL_VISTA_KANAZAWA_PAGE_URL = "https://kanazawa.hotel-vista.jp/ja/facilities";
export const HOTEL_VISTA_KANAZAWA_FIXTURE_SHA256 = "88156dd6147a2c917584a746609d4e8285e3c6287a9fc8253f4250252c00c6a6";
export const HOTEL_VISTA_KANAZAWA_FIXTURE_RELEASE: ReleaseMetadata = {
  sourceUrl: HOTEL_VISTA_KANAZAWA_PAGE_URL, observedOn: "2026-11-08", fetchedAt: "2026-11-08T04:57:00Z", httpLastModified: null,
};
export const HOTEL_VISTA_KANAZAWA_ADAPTER = reviewedFacilityAdapter({
  sourceId: HOTEL_VISTA_KANAZAWA_SOURCE_ID, slug: "hotel-vista-kanazawa", displayName: "ホテルビスタ金沢 喫煙ブース（公式サイト）",
  pageUrl: HOTEL_VISTA_KANAZAWA_PAGE_URL, fixtureFile: "hotel-vista-kanazawa-page-facts.csv", fixtureSha256: HOTEL_VISTA_KANAZAWA_FIXTURE_SHA256,
  release: HOTEL_VISTA_KANAZAWA_FIXTURE_RELEASE,
  values: ["hotel-vista-kanazawa", "ホテルビスタ金沢 喫煙ブース（2F）", "ホテルビスタ金沢", "facility", "2F", "石川県金沢市広岡2-13-27", "other", "https://kanazawa.hotel-vista.jp/ja/facilities", "2026-11-08", "36.580329911", "136.643377003", "officialAddressGeocode", "abr-geocoder 2.3.1 abr-kanazawa-nonoichi-2026-10-26:sha256:7be5d250d29e1fb3befc00b5578b10406b4ba225ade172eb5b1148626a77014d residential_detail 入力=石川県金沢市広岡2-13-27 出力=石川県金沢市広岡2丁目13-27"],
  hostType: "other", environment: "unknown",
  attributionText: `出典：ホテルビスタ金沢公式サイト ${HOTEL_VISTA_KANAZAWA_PAGE_URL}（2026-11-08確認）。`
    + "位置の目安：アドレス・ベース・レジストリ（デジタル庁、公共データ利用規約1.0）をabr-geocoderで照合した所在地の代表点。"
    + "MannerPathが事実のみを正規化して作成。ピンは施設の代表点で喫煙場所そのものの位置ではありません。運営者・デジタル庁による推奨・保証を意味しません。",
  rightsBasis: { kind: "factReference", pageUrls: [HOTEL_VISTA_KANAZAWA_PAGE_URL],
    termsUrls: ["https://kanazawa.hotel-vista.jp/ja/facilities", "https://kanazawa.hotel-vista.jp/ja/terms"],
    termsReading: "ホテル公式ページのフッターは© VISTA HOTEL MANAGEMENT CO.,Ltd.。「規約/約款/ポリシー」ページはインターネット宿泊予約システム利用規約で、私的利用以外の目的での本システムの無断利用を禁じるが、規約全文（予約システム利用規約・宿泊約款・利用規則・外部送信）を2026-11-08に再確認：第1条は「本システム」をホームページ上の宿泊予約機能と定義し、第3条の営利目的利用の禁止と私的利用以外の無断利用の禁止は予約システムの利用に関するもの。著作権・転載・複製・DB化に関する条項はなく、情報利用の明示禁止は確認されず。参照は予約システムを使わない公開施設ページ（館内施設）の事実に限る。適用範囲に法的確定判断はしない。ADR-0018 D-Rによる正規化事実（喫煙ブースの有無・階・所在地）のみの参照で文章・写真・地図・ロゴは複製しない。公式ページは喫煙ブース以外の館内を禁煙とする。オープンライセンスや運営者個別承認ではなく、異議・追加制限は保留・撤回審査。",
    prohibitsInformationUse: false, reviewedBy: "Claude source-review", reviewedOn: "2026-11-08" },
  reviewedBy: "Claude source-review", reviewedOn: "2026-11-08",
});
