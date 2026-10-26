# iPhone 新規喫煙所申請 UX — Lane 2

## 範囲と根拠

既存の申請API、管理画面、承認、公開ゲートは変更しない。調査した入口はContentViewの地図・大シート固定バー・空状態、
ReportFormView/Model、ReportPinPicker、ReportPhotos、DuplicateCandidates、ReportTermsSheet、写真follow-upと冪等再送。
関連Issue #30、#46、#124、#147、ADR-0006/0007/0013/0016、位置表示ADR-0017、PRODUCT_REQUIREMENTS、SPECIFICATION、
ARCHITECTUREの報告/写真境界、DESIGN、V1_PHOTO_PLACE_SUBMISSION、Apple READMEと実装・テストを参照。
#124の法務/メンテナー承認と本番写真受付の前提は未解決のまま。

## 導線の変更

以前：地図/大シートの「喫煙所を報告」→単一Formの位置・候補・条件・メモ・写真・同意・送信。
位置未指定や文字数超過などは送信時に判明し、破棄は即時だった。

変更後：「＋ 喫煙所を追加する」→同じ単一Formで1場所、2登録済み地点、3写真、4種類/条件、5内容確認/規約/送信。
受付可能時だけ追加案内を表示。新規受付停止は「新規申請の受付停止中」として説明画面を開き、送信は不可。
下書き・写真追送はそれぞれ再開用の名称。小/中シートは地図上、大シートは固定バー。検索中は退避し、既存の44pt以上を維持。
既存地点からの情報修正・報告は従来の入口・タイプのまま。

必須（明示pin、写真1〜3枚、規約同意）と任意/不明を先に説明。店舗の存在だけは証拠にしない。
重複候補なしでも端末内データに限ると説明し、網羅的な検索済みとはしない。写真の顔/ナンバー注意、EXIF位置不使用、
memory-only、再エンコード、同意版一致は既存仕様を維持。

送信前に既存wireバリデータを下書きの値コピーへ適用。追加のID生成/永続化、認証、通信は行わず、実送信でも独立して再検証。
下書き破棄に確認を追加し、ピン再編集は選択済み候補を保持。画面を閉じても下書きを維持し、送信中のinteractive dismissalを禁止。
写真はアプリ終了時に消えることを明記。送信受付後は「受付完了・審査待ち」、写真未確認なら写真待ちを上部に固定表示し、
既存の写真のみ再送と冪等な保存済み申請の再送を使う。終端失敗に再送できると案内しない。

地図選択は左右に余白を確保し、最大文字サイズでも地図操作とフォームの縦スクロールを使い分けられる。
通信結果不明の案内と既存の明示的な再送を上部に表示し、再送前の確認とavailability gateを維持。
送信準備中は写真編集も無効にする。英語ナビタイトルは短い「Add a place」、日本語の再送・期限切れ・競合案内も整備。

## 検証記録

- `make contract`：PASS。
- `make apple-validate`：最終ソースでPASS（iPhone310/310件、Watch37/37件、Watch build、Debug/Release境界、Release埋込バイナリ検査）。
- iOS 26.5 / iPhone 17 Pro / dark：新規UI7件＋既存写真再送1件 = **8/8 PASS**。
- iOS 18.6 / iPhone 16 Pro / light：新規UI **7/7 PASS**。
- 最終の日本語再送ラベル・収納状態追加後、iOS26.5の該当2件を再実行：**2/2 PASS**。
- 両OSで通常/最大Dynamic Type、キーボード、下書き保持、破棄キャンセル、明示pin、写真/同意不足、正常受付、
  受付後に通常送信なし、受付停止、通信結果不明→同じ保存済み申請の明示再送、日本語/英語、シート/検索共存。
- 入口とpin操作の44pt以上、意味を持つラベルを使用。受付見出しは画像/テキストを一つのアクセシビリティ要素にまとめた。
- UIテストは `J_ReportSubmissionUXUITests`、runnerのphoto-report phaseに登録。`I_PhotoReportFlowUITests` の既存の
  正常写真送信、写真再送、native PhotosPickerキャンセルも実行し通過（最初の他ケース失敗を含むrunの個別結果）。
- 独立コードレビュー・実画像レビューの指摘を修正。`git diff --check`：PASS。

最初のUI失敗は逆方向へのテストスクロール、受理ラベルの画像/テキスト重複ID、地図が縦スクロールを受ける点などを切り分けて修正。
iOS18の最初の実行はXcodeの結果収集停止で中断し、成功扱いにしていない。最終実行は
`-collect-test-diagnostics never`（verbose sysdiagnoseのみ無効、assertion・スクリーンショット・xcresultは保持）で結果確定まで成功。

再現する場合は他Laneの端末を使わず専用Simulatorを作成し、Xcode workloadsを直列に実行する：

```sh
MANNERPATH_IOS_DESTINATION='platform=iOS Simulator,id=<専用iOS UUID>' \
MANNERPATH_WATCH_DESTINATION='platform=watchOS Simulator,id=<専用Watch UUID>' make apple-validate
xcodebuild test -project apps/apple/MannerPath/MannerPath.xcodeproj -scheme MannerPathUITests \
  -destination 'platform=iOS Simulator,id=<専用iOS UUID>' -parallel-testing-enabled NO \
  -collect-test-diagnostics never -test-timeouts-enabled YES -default-test-execution-time-allowance 300 \
  -only-testing:MannerPathUITests/J_ReportSubmissionUXUITests MANNERPATH_API_BASE_URL=
```

## 実UIスクリーンショット

すべて専用Simulator・DEBUG注入stack。画像は単色のテスト写真であり、実在地点や本番申請成功の証拠でもStore素材でもない。
元のスクリーンショットを加工せず保持した。

| 状態 | 画像 |
| --- | --- |
| 地図の追加入口 / iOS26.5 dark | [入口](../assets/research/report-submission-ux/map-entry-ios26-dark.png) |
| 収納時の入口 / iOS18.6 light | [収納](../assets/research/report-submission-ux/collapsed-ios18-light.png) |
| 初めての申請・必須と手順 / iOS18.6 light | [フォーム](../assets/research/report-submission-ux/form-ios18-light.png) |
| 内容確認・同意 / iOS26.5 dark | [送信前](../assets/research/report-submission-ux/review-ios26-dark.png) |
| 受付完了・審査待ち / iOS26.5 dark | [受付](../assets/research/report-submission-ux/received-ios26-dark.png) |
| 通信結果不明・明示再送 / iOS26.5 dark | [再送](../assets/research/report-submission-ux/retry-ios26-dark.png) |
| 最大文字サイズとキーボード / iOS26.5 dark | [入力](../assets/research/report-submission-ux/keyboard-ios26-axxxl.png) |
| 受付停止 / iOS18.6 light | [停止](../assets/research/report-submission-ux/paused-ios18-light.png) |
| 英語・短いタイトル / iOS26.5 dark | [English](../assets/research/report-submission-ux/english-ios26-dark.png) |

## 未検証と公開条件

UIの成功はDEBUG専用注入stackによるクライアント状態の検証であり、署名済み実機・本番受理の証明ではない。
実App Attest、実写真の選択から実サービスへの送信、実回線オフライン、実VoiceOverの読み上げ順/ジェスチャーは未検証。
VoiceOver用の名前・要素の結合・到達可能性を自動テスト/アクセシビリティツリーで確認したことと区別する。
本番の受付有効化、#124承認、写真規約の承認、公開審査、D1/Cloudflare/管理画面/公開処理には変更なし。
mainへmergeしない。

開始および最終確認のbaseはorigin/main `3b5fd608dab2b3e97be18931836c3f7839ea7450`。Lane 3の検索シート変更は、この確認時点では未統合。ContentViewは入口・説明・表示条件だけに限定した。
