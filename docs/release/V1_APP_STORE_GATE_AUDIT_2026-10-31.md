# App Store v1.0 提出準備監査 — Lane 4 / 2026-10-31

**SUBMISSION: BLOCKED。** 基準は取得済み `origin/main` `112b919`。
唯一のgo/no-go表は [Release Gate](../V1_APP_STORE_RELEASE_GATE.md)。本書はその残件と証拠の索引。
写真付き新規申請が有効なv1.0を前提とし、受付停止のまま提出する代替案ではない。
文書のみ。ASC閲覧・変更、Apple提出、production API（GETを含む）、Cloudflare/D1/R2操作、規約承認、
公開、問い合わせ送信は実施していない。Lane 1のUIとLane 3のバックエンドを変更しない。

## 1. TestFlight 1.0 (7)の証拠

| 記録 | 反映できること | 反映できないこと |
| --- | --- | --- |
| [#348](https://github.com/Kounishiyuuki/MannerPath/pull/348) | 全構成のソースbuild番号7、未署名preflight | 署名archive、ASC processing、配布binaryのhash、実機PASS |
| [#349本文](https://github.com/Kounishiyuuki/MannerPath/pull/349) | TestFlight 1.0 (7)の実機利用で、地点選択・案内・目的地解除・申請入口に分かりにくさがあった。受付停止中の入口が非表示だったとの記録 | 機種/OS/日時や操作別成功記録がなく、位置権限・オフライン・写真送信のPASSにはできない |
| [#349追記](https://github.com/Kounishiyuuki/MannerPath/pull/349#issuecomment-6515811597) | mainでは入口を常時表示し、受付停止時は理由のalertのみ。フォームやdraftを新規作成しない | この変更は配布済み7への実機検証ではない。Simulatorテストを実機結果に転記しない |

最新mainにはbuild番号更新後のUI変更がある。同じ「1.0 (7)」表記でも配布binaryと同一と断定しない。
次のRCは配布担当がsource SHA・archive/IPA hash・署名preflight・ASC build identityを結び付ける。
既存の [device matrix](../beta-e2e/device-release-matrix.md) の1.0 (2)のPASS/partialは履歴として保持し、7へ付け替えない。
Watch/Widgetの7の実機結果は見つからず、G14/G15/G17/G21はOPEN。

## 2. P0 / P1残件

以下のP0はすべてOPEN。G番号はcanonical Gateに対応し、条件を追加承認したものではない。

| Gate | 提出を妨げる具体的な不足 | 担当・完了証拠 |
| --- | --- | --- |
| G1/G11 | SKU・権利者名・審査連絡先の実入力確認なし | 運営者がASCで確認。個人連絡先はGitに保存しない |
| G2/G3 | 写真有効版の回答承認、現在地pin分類、provider/support保持確認、公開policyとの一致なし | 運営者/法務が§3を決定。Lane 3の承認後PRでpolicy/manifest整合、最終archive Privacy Report |
| G5 | 提出対象corpusと素材の権利最終確認、署名iPhone/Watchでの出典・licenseリンク確認なし | 運営者の権利判断＋実機証拠。未承認金沢候補や638候補を公開範囲へ混入させない |
| G6 | 現行年齢質問票のUGC/たばこ回答と算出rating未確定 | 運営者が最小利用年齢・UGCを判断しASC結果保存。写真非公開でも自動的にUGC=Noにしない |
| G7 | 最終archiveの暗号/library確認と提出buildの輸出回答未確認 | 配布担当/運営者。以前のTestFlight利用を新RC回答の証拠にしない |
| G8/G12 | 掲載地域・写真有効状態に合う最終説明/審査手順の承認とRC再実行なし | §4の差替え、運営者承認、提出当日の照合 |
| G10 | 最終RC・実公開データによる承認済みiPhone/Watch画像なし | §4の撮影manifest、native画像、権利/プライバシー確認 |
| G14/G15/G17/G21 | 最終署名RCのApp Group/実App Attest、Watch/Widget、初回/権限/オフラインの実機PASSなし | §5の同一RC証拠。未署名preflightやmock成功で代用しない |
| G16/G23 | #124規約/写真条項未承認、両側reviewed list空、実staging E2E・承認後の本番有効化・実写真送信証拠なし | §6の順序。runtime停止は安全だが写真P0の完了ではない |
| G19 | 最新の承認済み公開範囲と配備inventoryを照合していない | 別途許可された担当の当日観測。今回production GETはしない |

P1も未完了：G4 標準EULA/規約判断、G9 support掲載地域説明、G13実機support/privacy/mail、
G18実機VoiceOver/大文字/動き/contrastと正直なアクセシビリティ回答、G20審査リスク受容。
各P1は完了または運営者による理由付き受容を記録する。G22のアプリ内地域一覧はP2のまま。

写真投稿に対する[Apple Guideline 1.2](https://developer.apple.com/app-store/review/guidelines/#user-generated-content)
の適用もG6/G12/G20で明示評価する。事前審査、問題報告窓口、対応期限/担当、悪用者への停止手順を記録し、
既存のkey revocationと受付停止だけで十分と断定しない。写真は非公開、事実のみ審査後掲載する構成を審査メモで説明する。
法務・運営者が適合説明または追加対策を決定するまでG23は閉じない。

## 3. App Privacy：写真有効版の回答案（未承認）

[Apple定義](https://developer.apple.com/app-store/app-privacy-details/)を2026-10-31に再確認。
端末外でリアルタイム処理を超えて保持するデータを対象とし、任意送信だけで開示例外にはしない。
現在のper-device関連付けではNot Linkedに置き換えない。以下は入力案で、ASC回答済みではない。

| 型 | Collected / Linked / Tracking | 目的と根拠 |
| --- | --- | --- |
| Photos or Videos | Yes / Yes / No | App Functionality。private R2、report経由でsubmitter hashに関連付く。EXIF除去や写真非公開でも収集に当たる |
| Other User Content | Yes / Yes / No | App Functionality。報告本文・利用条件等を審査/保持 |
| Device ID | Yes / Yes / No | App Functionality。App Attest key ID/登録とkey由来hash。無アカウントは匿名化の根拠にならない |
| Precise Location | Yes / Yes / No | App Functionality。#349で利用者が「現在地を使う」→確定したpinは約1mでdevice fixと一致し得る。5桁pinを保持。閲覧時のraw GPS自動送信とは別 |
| Customer Support / Email Address | Yes / Yes / No（既存推奨） | App Functionality。Gmailサポート保持を別途確認。写真追加で既存support回答を消さない |
| Coarse Location / Other Diagnostic Data | 最終判断保留 | tile/IP、例外ログ、Cloudflare基盤/Logpush/契約保持の未確認を解消。既存§0.2の条件付き非申告案と保守案を運営者が選び、根拠を残す |
| Product Interaction / Analytics / Crash Data | 新たな収集を今回認定しない | SDKなし等の既存根拠を最終archive/運用と照合。未知のprovider保持を「なし」に変換しない |

根拠：[inventoryの現在地pin監査](../APP_PRIVACY_INVENTORY.md#report-pin-from-現在地を使う-audit-2026-10-30-pr-349)、
[photo decision pack §3–4](../legal/PHOTO_LEGAL_DECISION_PACK.md)、[privacy review](../legal/PHOTO_PRIVACY_REVIEW.md)。
旧packの「Locationは写真で不変」は#349追加前の評価。現在地pinはPrecise Location案で補う。

承認後に必要な整合：ASC entry §0.2/§4、submission §2.2、inventory、iPhone manifest、生成Privacy Report、
site/privacyのja/en、アプリ内説明、同意文書。現manifestは収集型なしなので有効版の最終archiveと一致確認が必要。
policyはR2/D1、端末由来関連付け、90日以内の削除とprovider内部処理の限界、端末内follow-up最長89日、
再起動時の写真再選択、顔/ナンバーは自動消去しないことを含める。
ADR-0021はProposedであり即時完全削除を約束しない。撤回/削除要求の本人確認・回答・実施可能範囲は運営者が確定する。

## 4. 説明・審査メモ・対象地域・画像

- 名前/サブタイトル/keywordは既存 [entry sheet](../APP_STORE_CONNECT_ENTRY.md)を維持。説明の停止中段落は
  [final-assets packet §1](V1_APPSTORE_FINAL_ASSETS.md#1-copy-selection--one-actual-rcruntime-not-mixed-feature-sets)
  の写真有効版候補へ承認後に置換。両方を併記しない。即時公開・写真公開・自動顔消去を約束しない。
- 審査メモも同packetの有効版へ置換。最終UIの「＋ 喫煙所を追加」→pin→重複確認→1〜3枚→条件/不明→
  規約→受付/審査待ち→同一報告への写真再送を、実際のRCで説明する。実App Attestが必要な端末条件を示し、
  審査者の地域制限は承認済み動画等で説明する。特別な審査バイパスや架空production報告は作らない。
- 日本のみ/無料/手動公開の方針を維持。過去の6 sources/513 spotsと台東・港・江東・武蔵野・大阪・京都は
  **履歴**で、当日inventoryではない。地域文は別途許可された再確認後に確定。全国/全域/金沢掲載を推定しない。
- 最終RCの実公開データ・日本語・通常利用UIを撮影。fixture、ローカルWorker、Debug注入画像をストア素材にしない。
  地図credit、目安表示、鮮度/利用条件を残す。顔/車番/私的住所/submitterデータを除き、画像hash/端末/OS/
  source SHA/build/撮影時刻/公開ID/fixture=falseと権利承認をprivate manifestへ記録する。
- [Apple画像仕様](https://developer.apple.com/help/app-store-connect/reference/app-information/screenshot-specifications)
  を2026-10-31確認。iPhone必須枠とWatch枠を提出時にも再確認する。1サイズあたり1〜10枚、JPEG/PNG、alphaなし。
  Watchは全localeで同じ寸法。例：iPhone 1320×2868、Watch Series 9 396×484は対応表にあるが、
  この例だけで必須枠充足と判断しない。実際の端末とASC枠で選ぶ。既存offline validatorは権利・実機PASSを証明しない。
- Watchは目的地検索結果を同期しない。金沢から東京を検索したiPhone画面でWatch撮影条件を満たしたとしない。
  既存runbookに従い実掲載地域の実nearby同期で撮影する。撮影困難を偽GPSやfixtureで補わない。

## 5. 同一最終RCで残る実機検証

全行未完了。端末/OS、build、配布identity、時刻、期待/結果、画像またはログを保存しmatrixへ追記する。

| 対象 | P0を閉じるための検証 | P1等の残件 |
| --- | --- | --- |
| iPhone | 初回起動/位置許可・拒否、実掲載/空領域/通信失敗の区別、cacheあり/なしoffline、署名App Group、実App Attest、1〜3枚送信/receipt、写真のみ失敗/再選択/再起動復帰、二重送信しない、受付停止時は送れない | #349後の選択→Apple Maps/目的地解除/現在地pin精度、VoiceOver/AX5/dark/keyboard、support/privacy/mail、権利表示 |
| Watch | W1/W2/W3/W5/W5b：未同期、正常0件、通信失敗、staleの区別、revision更新/再接続、timeout/遅延応答、cache再起動、正確/目安/不明表示、実WCSession | filters/directions、VoiceOver/大文字、実権利リンク、圏外/再接続 |
| iPhone Widget | G2/S1/S2・G3/G3b：同じshared-containerのfirst spot/距離/目安/不明。signed provisioningで成立 | small/medium/lock、空/未同期/stale、tap/deeplink、offline、更新遅延を実測 |
| Watch Widget | WG2/S3/S4：Watch受信→共有container→Smart Stack/complicationの一致 | 未同期/stale/正常0件、tap、offline、システム更新budgetの遅延 |
| 配布物 | 全bundle署名/entitlementとApp Group、production App Attest、ReleaseのDebug fixture非混入、最終archive Privacy Report | 実機icon/MapKit credits、support遷移 |

matrixのR1は歴史的なreports-offケースで、写真有効版の成功証拠に流用しない。
[final device sheet](V1_FINAL_DEVICE_E2E.md)、[Watch/Widget readiness](WATCH_WIDGET_RELEASE_READINESS.md)、
[#340](https://github.com/Kounishiyuuki/MannerPath/pull/340)の自動テストは準備であり実WC通信の証明ではない。
この監査ではSimulatorも実機も操作していない。

## 6. 運営者作業・開発可能作業・順序

1. **運営者/法務**：#124と[decision pack §1](../legal/PHOTO_LEGAL_DECISION_PACK.md)の承認/変更/保留を記録。
   運営者名/連絡先、再利用許諾、法/管轄、責任、撤回と削除、version/日付、写真条項、privacy/Linked、
   private photoの保持/コピー禁止・provider削除の限界、最低年齢/UGC運営を判断。コード担当は承認を代行しない。
2. **Lane 3（別PR）**：承認後のみ、同一新規termsのserver/client bundleのbytes/hash/version、両reviewed list、
   community/source権利、policy/manifest/文書を整合させる。[activation handoff](V1_PHOTO_ACTIVATION_HANDOFF.md)に従う。
   intakeの有効化と公開権利ゲートは別で、写真承認だけでタイル公開しない。Lane 4は実装しない。
   [PR #350](https://github.com/Kounishiyuuki/MannerPath/pull/350)は監査時OPENで写真計画/ADR削除設計を変更中。
   未merge案を実装済みと扱わず、統合後に削除・撤回の承認条件を再照合する。
3. **運営者の別途許可を受けた担当**：staging隔離/実R2/retention cron/edge制限/App Attestの運用設定とE2E。
   本番有効化はstaging成功と承認後の別操作。停止/rollback手順と監視担当も確認。今回の許可には含まれない。
4. **Lane 1/配布担当**：UI回帰修正・自動テスト・署名preflight/Release fixture検査はコードで実施可能。
   運営者は新RCを選び実機§5を実施。mock成功を実本番送信成功と呼ばない。
5. **別途許可された運用担当＋運営者**：当日のruntime/承認済みcorpus照合、画像撮影、説明/notesのRC再実行、
   出典/素材権利・policy確認。dummy報告/公開を監査のために生成しない。
6. **運営者のみ**：ASCの契約/アプリrecord/連絡先、privacy、年齢、輸出、対象地域/無料、処理済みbuild、
   screenshot/説明/notesを承認値で設定し証拠保存。全P0 DONEとP1完了/明示受容を確認する。
   審査提出・公開操作は別途明示許可が必要で、本作業では行わない。

自動化できるのは整合/文字数/リンク/画像寸法/bytes一致/ゲート拒否/Release非混入の検証まで。
法的判断、provider設定の事実認定、実機の実測、ASC回答の承認をCIで置き換えない。
