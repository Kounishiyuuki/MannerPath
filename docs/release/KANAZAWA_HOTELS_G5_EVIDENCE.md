# 金沢ホテル6施設 — G5掲載判断用証拠

2026-11-09確認。対象は #411 の4施設と #417 の2施設。基準mainは
`a77549a0a1106a339c649f7ea43104173935a32c`。
**この文書のマージはG5承認でも公開許可でもない。6施設すべて承認記録は未作成。**
既存の `reviewedBy` / `reviewedOn` は技術的なsource reviewの履歴で、今回の運営者承認ではない。
adapter、fixture、source registry、rights review、監視baseline、公開データは変更していない。

## 判断の要約

全施設とも `factReference`（ADR-0018 D-R）の正規化事実参照。オープンライセンス・施設の個別許諾は取得していない。
著作権留保や「明示禁止が見つからなかった」という技術的読解だけで、商用掲載の適法性は確定しない。
文章・画像・館内図・ロゴ・HTMLの転載を含めない。住所アンカーの利用条件は施設ページと別に審査する。

| 施設 / source slug（末尾は全件 `-smoking-places`） | 掲載対象（1施設1地点） | 現時点の推奨 / G5未解決事項 |
| --- | --- | --- |
| 金沢マンテンホテル駅前 / `manten-kanazawa-ekimae` | 1F駐車場入口横・4F/7F EV付近の喫煙室 | **保留推奨**。FAQの客室階立入制限を掲載時の案内に反映する方法を確認。1Fの一般利用可否も未確認 |
| 金沢白鳥路 ホテル山楽 / `hotel-sanraku-kanazawa` | ロビー入口付近の屋外・地下駐車場の喫煙スペース | 運営者判断待ち。館内喫煙室とはしない。事実参照の権利判断・概略位置・unknownを受容するか |
| ホテルルートイン金沢駅前 / `route-inn-kanazawa-ekimae` | 1F喫煙スペース | 運営者判断待ち。会員規約の適用範囲、概略位置・unknownを受容するか |
| ホテルビスタ金沢 / `hotel-vista-kanazawa` | 2F喫煙ブースのみ | 運営者判断待ち。下記予約システム規約の適用範囲の判断が必要 |
| ドーミーイン金沢 / `dormy-inn-kanazawa` | 1F喫煙ブースのみ | **権利判断まで保留推奨**。第11条6項・第12条の適用範囲を確定できていない |
| スマイルホテル金沢西口駅前 / `smile-hotel-kanazawa-nishiguchi` | 指定喫煙スペース（階・具体的位置不明） | **保留推奨**。権利ページ旧URLが301で監視BLOCKING。移転先の再審査と別PRによる監視修正後に再取得 |

## 現在の公式ページと監視

本作業で公式ページをGETして確認した。現地調査・施設への照会は行っていない。
[測定メタデータ](KANAZAWA_HOTELS_G5_HEALTH.json)にsourceごとのHTTP、対象URL、scoped fingerprint、baselineとの比較結果を保存。
生の本文や地図画像は保存しない。取得日と公式発表日は別で、全件 `observationDateUnknown`。
本文の全体一致を証明する監視ではなく、設定済み事実/権利範囲の一致確認である。

| 対象 | 本文の喫煙事実 | 権利/住所等の監視範囲 | 結果 |
| --- | --- | --- | --- |
| マンテン | HTTP200 / healthy | FAQ・企業Privacy、unchanged | OK。ただし客室階立入制限は監視の正常判定とは別に確認が必要 |
| 山楽 | HTTP200 / healthy | FAQ・企業Privacy、unchanged | OK |
| ルートイン | HTTP200 / healthy | 施設ページ・会員規約、unchanged | OK。Privacyも別途閲覧（監視対象とは区別） |
| ビスタ | HTTP200 / healthy | 施設ページ・規約、unchanged | OK。予約規約の解釈は未承認 |
| ドーミー | HTTP200 / healthy | 客室・アクセス住所・規約、unchanged | OK。第11/12条の解釈は未承認 |
| スマイル | HTTP200 / healthy | 施設ページ unchanged、旧Privacy URL unavailable / HTTP301 | BLOCKING。閉鎖・規約内容変更とは断定しない |

スマイルの旧URLは [旧Privacy](https://smile-hotels.com/privacy-policies/show/kanazawanishiguchiekimae)、
閲覧時の移転先は [現Privacy](https://smile-hotels.com/privacy-policies/kanazawanishiguchiekimae/)。
移転先を閲覧できたことは旧baselineとの同一性や権利承認の証明ではない。
自動追従・fixture更新・監視のgreen化はしていない。人が移転先の運営主体・条項・scopeを読み、
承認された変更だけを別PRで監視へ反映し、その後live検証する。

GitHubの直近定期run [42542798834](https://github.com/Kounishiyuuki/MannerPath/actions/runs/42542798834) は
請求によるアカウントlockでjob未開始。定期監視が稼働した証拠には使わない。上表は本作業のローカルlive測定。
再実行（読み取り専用、終了コード1は今回はスマイルのBLOCKING）：

```sh
cd services/api
npm run source:health -- --live --repository-reviewed \
  --source=manten-kanazawa-ekimae-smoking-places \
  --source=hotel-sanraku-kanazawa-smoking-places \
  --source=route-inn-kanazawa-ekimae-smoking-places \
  --source=hotel-vista-kanazawa-smoking-places \
  --source=dormy-inn-kanazawa-smoking-places \
  --source=smile-hotel-kanazawa-nishiguchi-smoking-places
```

## 位置・出典表示の共通確認

以下すべて既存の `listing-batch.json` → `abrg-output.json` → `anchor-evaluation.json` を照合済み。
`address-anchor-gate.v2` の `residential_detail`、各1/1 anchor。今回ジオコーダの再実行はしていない。
データセットは `abr-kanazawa-nonoichi-2026-10-26:sha256:7be5d250d29e1fb3befc00b5578b10406b4ba225ade172eb5b1148626a77014d`。

| 施設 | 公式住所（石川県金沢市） | 緯度, 経度（施設代表点） |
| --- | --- | --- |
| マンテン | 北安江1-6-1 | 36.581441767, 136.649589106 |
| 山楽 | 丸の内6-3 | 36.568208225, 136.662038903 |
| ルートイン | 昭和町22番5号 | 36.574896175, 136.646092219 |
| ビスタ | 広岡2-13-27 | 36.580329911, 136.643377003 |
| ドーミー | 堀川新町2-25（アクセスページ） | 36.579348656, 136.650432875 |
| スマイル | 広岡3丁目2番37号 | 36.580760028, 136.644971769 |

精度は全件 `areaApproximate` / `locationArea.scope=facility`。桁数は喫煙場所の精度を意味しない。
入口・階・喫煙ブースの座標として扱わない。Google/Apple/OSMの座標・地図は根拠にしていない。
各adapterの `attributionText` は公式施設ページ、2026-11-08確認、ABR（デジタル庁、公共データ利用規約1.0）、
正規化作成・代表点・非推奨非保証を明記している。今回の再閲覧日で既存releaseの確認日を上書きしない。

## 施設別の根拠とG5チェックリスト

チェック欄は**すべて運営者未記入**。事実照合済みの根拠を読んだうえで、各施設ごとに承認または保留を記録する。
保留を選ぶ場合は理由と解消条件を記す。共通unknownは喫煙時間、紙巻き/加熱式対応、喫煙区画の構造・屋内外の統一分類、
購入条件・非宿泊者の利用可否（ただしマンテンの客室階制限は判明）。ホテルの営業時間や浴場時間を喫煙時間に転用しない。

### 1. 金沢マンテンホテル駅前

- [公式FAQ](https://www.manten-hotel.com/kanazawa/faq/)は3か所の喫煙室と住所を案内する。
  同じFAQは非宿泊者の客室・客室階立入を制限している。4F/7Fへの一般利用案内は避ける。
  深夜のホテル入口施錠案内も喫煙室の営業時間とはみなさない。1Fの一般利用許可は不明。
- [企業Privacy](https://manten-hotel.co.jp/privacy/)は個人情報の方針で、コンテンツ利用許諾ではない。
  PROVENANCEの明示禁止未発見は技術的読解。立入制限が新設されたかは今回の比較では確定できない。
- 証拠: [PROVENANCE](../../services/data-pipeline/fixtures/manten-kanazawa-ekimae-smoking-places/PROVENANCE.md)、
  [adapter/rightsBasis/出典](../../services/api/src/pipeline/manten-kanazawa-ekimae-adapter.ts)。
- [ ] 権利：factReferenceの限定利用を承認 / 保留（理由を記録）
- [ ] 掲載条件：4F/7F立入制限を明示できる表現を別変更で審査。全域unknownだけでは既知の制限が伝わらない点を解消
- [ ] 位置・出典：施設代表点とABR表示を受容、1施設1地点・非一般公開保証を確認
- [ ] 公開直前：live再確認とG5判断、bundle/plan digestの記録

### 2. 金沢白鳥路 ホテル山楽

- [公式FAQ](https://sanraku.kenhotels.com/hakuchoro/faq/)は屋外と地下駐車場の喫煙スペースを案内する。
  全館禁煙・喫煙客室なし。レストラン/ロビーの非宿泊者利用案内を喫煙場所の一般利用許可に転用しない。
- [企業Privacy](https://kenhotels.com/privacy/)は個人情報方針。著作権留保を確認、利用許諾ではない。
- 証拠: [PROVENANCE](../../services/data-pipeline/fixtures/hotel-sanraku-kanazawa-smoking-places/PROVENANCE.md)、
  [adapter/rightsBasis/出典](../../services/api/src/pipeline/hotel-sanraku-kanazawa-adapter.ts)。
- [ ] 権利：正規化事実のみのfactReferenceを承認 / 保留
- [ ] 掲載条件：2区分を1施設にまとめ、館内喫煙室/客室と誤認させず、共通unknownを維持
- [ ] 位置・出典：丸の内6-3の代表点。FAQ内の別施設の住所を混用しない
- [ ] 公開直前：live再確認とG5判断、bundle/plan digestの記録

### 3. ホテルルートイン金沢駅前

- [公式設備](https://www.route-inn.co.jp/hotel_list/ishikawa/index_hotel_id_231/facilitiesetc/)は1F喫煙スペースを案内。
  加熱式たばこ専用客室は共用スペースから除外し、そこから対応たばこ種別を推測しない。
- [会員規約](https://www.route-inn.co.jp/reserve_rules/kiyaku/)はインターネット会員サービスの規約で権利侵害を禁止。
  [Privacy](https://www.route-inn.co.jp/company/privacy/)は個人情報方針。公開事実参照の明示許諾はない。
- 証拠: [PROVENANCE](../../services/data-pipeline/fixtures/route-inn-kanazawa-ekimae-smoking-places/PROVENANCE.md)、
  [adapter/rightsBasis/出典](../../services/api/src/pipeline/route-inn-kanazawa-ekimae-adapter.ts)。
- [ ] 権利：会員サービスの適用範囲を確認しfactReferenceを承認 / 保留
- [ ] 掲載条件：1Fのみ、客室除外・共通unknown維持
- [ ] 位置・出典：昭和町22番5号の施設代表点とABR表示を受容
- [ ] 公開直前：live再確認とG5判断、bundle/plan digestの記録

### 4. ホテルビスタ金沢

- [公式設備](https://kanazawa.hotel-vista.jp/ja/facilities)は2Fブースとそれ以外の館内禁煙を案内。
- **確認した条項の事実**：[規約](https://kanazawa.hotel-vista.jp/ja/terms)の予約システム規約は、
  冒頭・第1条で宿泊予約機能を対象にし、第3条2項で営利目的のシステム利用を禁止、
  第8条2項4号で私的利用以外の無断システム利用を損害責任の対象とする。
  これらを「サイト情報の商用利用が許諾された」と読み替えない。
- **運営者判断**：予約機能を一切使わず公開施設ページの事実だけを正規化する参照に、
  予約システムの制限が及ばないという既存termsReadingを採用するか。
  判断できなければ保留し、必要に応じ許諾/専門家確認を行う（本作業では照会送信しない）。
- 証拠: [PROVENANCE](../../services/data-pipeline/fixtures/hotel-vista-kanazawa-smoking-places/PROVENANCE.md)、
  [adapter/rightsBasis/出典](../../services/api/src/pipeline/hotel-vista-kanazawa-adapter.ts)。
- [ ] 権利：上記適用範囲の判断と理由を明示して承認 / 保留
- [ ] 掲載条件：2Fブース以外禁煙、予約操作なし、共通unknown維持
- [ ] 位置・出典：広岡2-13-27の施設代表点とABR表示を受容
- [ ] 公開直前：live再確認とG5判断、bundle/plan digestの記録

### 5. 天然温泉 加賀の湧泉 ドーミーイン金沢

- [公式客室](https://dormy-hotels.com/dormyinn/hotels/kanazawa/rooms/)の1Fブースのみ対象。
  7F喫煙客室フロアは対象外。住所は[公式アクセス](https://dormy-hotels.com/dormyinn/hotels/kanazawa/access/)。
- **確認した条項の事実**：[規約](https://dormy-hotels.com/terms/)第11条6項は承諾なくサービスを通じ、
  または関連して行う営利行為を禁止。第12条は提供著作物の利用を原則私的使用に制限する。
  第3条にホテル予約サイトの記述はあるが、ビスタと同じ限定範囲と断定しない。
- **運営者判断**：正規化事実を商用アプリの掲載根拠にする行為が第11条の「関連」する営利行為に当たるか、
  第12条の著作物利用に当たらない範囲を守れるか。既存PRの「fact referenceを禁止していない」は承認根拠の確定ではない。
  明示的なDB化禁止がないだけでは疑義は解消しない。判断がつくまで保留、必要に応じ許諾/専門家確認。
- 証拠: [PROVENANCE](../../services/data-pipeline/fixtures/dormy-inn-kanazawa-smoking-places/PROVENANCE.md)、
  [adapter/rightsBasis/出典](../../services/api/src/pipeline/dormy-inn-kanazawa-adapter.ts)。
- [ ] 権利：第11条6項と第12条の両方について適用判断・理由を記録して承認 / 保留
- [ ] 掲載条件：1Fのみ、7F客室除外・共通unknown維持
- [ ] 位置・出典：堀川新町2-25の施設代表点とABR表示を受容
- [ ] 公開直前：live再確認とG5判断、bundle/plan digestの記録

### 6. スマイルホテル金沢西口駅前

- [公式施設ページ](https://smile-hotels.com/hotels/kanazawanishiguchiekimae/)は指定喫煙スペースの存在と住所を案内。
  場所・階・屋内外の説明はなく、入口付近と推測しない。
- 著作権留保と個人情報保護方針は利用許諾ではない。旧Privacyへの301は取得上の異常で、施設閉鎖の根拠ではない。
- 証拠: [PROVENANCE](../../services/data-pipeline/fixtures/smile-hotel-kanazawa-nishiguchi-smoking-places/PROVENANCE.md)、
  [adapter/rightsBasis/出典](../../services/api/src/pipeline/smile-hotel-kanazawa-nishiguchi-adapter.ts)。
- [ ] 権利：移転先を読み旧scope/運営主体/追加制限を確認、別PRで監視URL/baseline等を審査しlive BLOCKINGを解消
- [ ] 権利：上記解消後に正規化事実のみのfactReferenceを承認 / 保留
- [ ] 掲載条件・位置・出典：具体場所不明を維持、広岡3丁目2番37号の施設代表点とABR表示を受容
- [ ] 公開直前：live再確認とG5判断、bundle/plan digestの記録

## 判断の記録と公開との境界

運営者はsource IDごとに「承認/保留」「採用する権利解釈と理由」「利用制限・unknownの表示方針」
「確認したrelease/CSV SHAと根拠URL」「実際の判断者・日時」を当該PRまたはrelease記録へ記入する。
この資料では判断者・承認日を埋めない。保留施設はbundleから除き、他施設の承認を流用しない。

承認後も [既存runbookのG5](ID_PRESERVING_PROMOTION_RUNBOOK.md#publication-approval-g5-not-recorded-so-no-production-publication)
の公開直前確認・bundle/plan digest・ID保持検証が別途必要。監視OKや文書マージでは自動掲載されない。
本PRは6候補・既存513地点・タイル・ID・申請/承認処理・promotion・Cloudflare設定に変更を加えない。

検証：`make contract`、`git diff --check`、文書内の相対リンク/測定6件の整合確認は成功。
`kanazawa-hotel-facility-sources.test.ts` と `kanazawa-hotel-batch2-sources.test.ts` は28/28成功
（既存fixtureの改変拒否・住所gate・概略位置でのローカル取込/タイル/detailを検証）。
初回は新worktreeの依存未導入で起動失敗し、`npm ci --ignore-scripts` 後に再実行した。
このテスト成功は現在の権利許諾や本番公開の検証ではない。
