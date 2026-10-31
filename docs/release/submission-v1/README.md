# v1.0 転記用素材と実機実行シート

**準備物完成・未承認・提出不可。** `bb538e5`を基準に用意した入力ファイル。
[Release Gate](../../V1_APP_STORE_RELEASE_GATE.md)のOPENを変更しない。法務/規約/削除処理やアプリは編集していない。
現在の本番で写真申請が有効だとは認定していない。以下の有効版テキストは、Lane 3の承認・有効化と
最終署名RCの実機結果、当日公開範囲が一致した後に運営者が承認して使う。今はASCへ貼らない。

| 完成した入力ファイル | 使う先・条件 |
| --- | --- |
| [metadata.json](metadata.json) | 名称、サブタイトル、keyword、PR文、support/privacy URL、カテゴリ、無料/日本/手動公開。権利者名・連絡先は運営者がASCで入力 |
| [ja/description-photos-enabled.txt](ja/description-photos-enabled.txt) | 日本語説明の全文。既存の停止中説明への継ぎ足し不要。地域文とWatch/Widget機能の最終実機確認後のみ |
| [review-notes-photos-enabled.txt](review-notes-photos-enabled.txt) | 審査担当向けEnglish全文・操作手順。閲覧のtile送信と明示選択したpinの送信を区別。実機App Attest/地域条件を説明 |
| [app-privacy-candidate.json](app-privacy-candidate.json) | 6項目の型/Linked/Tracking/目的・保持説明の回答候補。provider/support未確認は未決のまま |
| [PrivacyInfo.photos-enabled.candidate.plist](PrivacyInfo.photos-enabled.candidate.plist) | iPhone現manifestに回答候補6型を加えたレビュー用実ファイル。`.xcprivacy`としてアプリに組み込んでいない。Lane 3が承認後の整合PRで取り込む候補 |
| [DEVICE_CAPTURE_SESSION.md](DEVICE_CAPTURE_SESSION.md) | iPhone 16 Pro/Watch/Widget撮影、端末別実行順序、操作/期待/証拠、記録用表 |

## D1/暗号化を検討中の場合（2026-10-31追記）

初回監査時のmain `1e2d009`ではD1/暗号化PoCは未統合だった。
2026-11-01再照合：最新main `d3508d5`へ#357・#358・#360のPoCソースは統合済み。
通常の申請経路はR2のままで、D1/暗号化の正式採用・法務承認・本番有効化は確認されていない。
`app-privacy-candidate.json`の`storageReview`（`unmerged-poc`等）は初回監査のsnapshotとして保持する。
現在の統合状態はこの追記を参照し、候補値や削除説明、未承認ゲートの変更とは扱わない。
[D1データフローと公式文書](D1_PHOTO_PRIVACY.md)、[日英policy候補](PRIVACY_POLICY_D1_CANDIDATE.md)、
[削除依頼/再install support候補](SUPPORT_PHOTO_DELETION_CANDIDATE.md)を承認前の差分として使う。
下記の旧R2由来90日/89日記述を、D1の物理消去期限やupload可能期間の確約へ転用しない。

`python3 scripts/validate-photo-privacy-candidate.py`でJSON/plist候補の整合を検査できる。
暗号化だけでNot Linkedに変更する、SQL削除を物理消去とする、未検証plan/鍵破棄を完了扱いにする変更を拒否する。
これは文書候補の検査で、実暗号方式・消去・法務・提出承認を検証しない。出力は常にsubmissionReady=false。

## 転記前の3つの照合

1. **地域**：今回使ったのは2026-10-15の[保存済み観測](../store-screenshots/production-recheck.json)にある
   台東/港/江東/武蔵野/大阪/京都のみ。金沢候補・638候補・架空IDを追加していない。
   これは現在inventoryの再測定ではない。当日、別途許可された担当が承認済み配備一覧と公開範囲を確認し、
   一致しなければdescriptionとReview Notesの両方を直す。既存`release:data-audit`はreports/photos OFFを要求するため、
   **写真ON状態の証明には使えない**。Lane 3が有効版の検証を引き継ぐ。今回実行しない。
2. **写真/法務**：#124の新version・条項・両reviewed list、manifest/policy、retention/deletion運用、
   App Attest、staging結果をLane 3が揃える。写真は審査用非公開、公開される事実は別の品質/権利ゲートを通る。
   写真・本文の90日とApp Attest登録/receipt/audit/サポートの保持を同一視しない。即時完全削除を約束しない。
3. **RC**：SHA・署名archive/IPA hash・ASC build identityと撮影/実機結果を結ぶ。
   1.0 (7)という番号だけで#349の後続UIを配布済みとしない。文面上のWatch/Widget機能は実機が通るまで未承認。

## Privacy候補をLane 3へ渡す手順

- 運営者がJSONの6型と未決事項を承認/変更する。現設計はPhotos、Other User Content、Device ID、
  Precise LocationをCollected/Linked/Not Tracking/App Functionalityとする案。support/emailは既存のsupport包括案。
- 現在地pinは利用者の明示操作と確定で送信され得る。写真のEXIF除去はこのpinの非収集を意味しない。
- Coarse Location/Other Diagnostic Dataの採否、provider保持、supportの範囲は運営者が根拠を記録。
  追加型が必要ならJSON/plistの両方へ反映し、候補ファイルだけの一致を法的承認としない。
- Lane 3の承認後PRでアプリmanifestへ取り込み、terms/policyのja/enと照合。最終archiveをXcode Organizerで
  選択→Generate Privacy Report→保存。reportとASCの回答・実際の通信を照合する。今回archiveは作成していない。
- オフライン検証：`make contract`。文字数/地域/停止文の混在、privacy候補の型・Linked/目的、manifestの
  required-reason既存宣言保持を検査する。技術PASSは法務承認・有効化・提出可否を変更しない。

## 今回減らした残作業

G8/G12の「全文を組み立てる」、G2の「回答型とmanifestの対応を準備する」、G10/G15/G17の
「撮影/実機手順を起こす」を完了。G1–G23のP0行自体は運営者承認・実機・当日runtime証拠が必要なため、
**新たにDONEとなったP0は0件**。承認なしでDONEへ変えない。
次は運営者の法務判断→Lane 3の整合/実環境準備→最終署名RC→この実行シート→当日scope/素材/ASC確認。
ASC入力・Apple提出・本番変更は今回実施しない。mainへmergeしない。

参照（2026-10-31再確認）：[Apple App Privacy](https://developer.apple.com/app-store/app-privacy-details/)、
[privacy manifest](https://developer.apple.com/documentation/bundleresources/describing-data-use-in-privacy-manifests)、
[画像仕様](https://developer.apple.com/help/app-store-connect/reference/app-information/screenshot-specifications/)。
