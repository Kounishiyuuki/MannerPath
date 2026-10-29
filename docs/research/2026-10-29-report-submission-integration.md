# PR #344 / PR #347 統合検証

## 最終ローカル検証結果

| 検証 | 結果 |
| --- | --- |
| `git diff --check` | PASS |
| `make contract` | 11/11 PASS |
| `make apple-validate` | iPhone310/310、Watch37/37、Watch build、Debug/Release境界・Release埋込検査 PASS |
| iOS26.5 dark | 対象28ケースの最終成功を照合 |
| iOS18.6 light | 対象28ケースの最終成功を照合 |

各OSの28件はJ申請12、I写真4、決定的目的地検索6、Native検索4、詳細2。一括run成功ではなく、中断/修正の履歴を残したうえで各テストIDの最終成功を照合している。
最終fetchでもmainは`af05a4a`。同mainがHEADの祖先であることを確認した。CIは[PR #344](https://github.com/Kounishiyuuki/MannerPath/pull/344)の同HEADのチェックを参照。

対象: `feat/report-submission-ux`。開始HEAD `2a4c869`、取り込んだmain `af05a4a`（#347）。
未コミット変更なしを確認し、通常merge `c7e2125` で履歴を保持。force pushは使用しない。

## 競合と確認範囲

- Git競合は `Localizable.xcstrings` 冒頭への追加のみ。#344の申請文言と#347のShow List/アクセシビリティヒントを両方保持し、JSON parseを確認。
- ContentViewは自動merge。#347の3 detent、searchPresented、目的地名/Refresh/Clear、AX見出しの非固定化、検索結果/ピンから詳細へ進む経路を保持。
- 追加のproduction差分は、地図/全画面申請導線の退避条件に `!searchPresented` を加える2箇所のみ。検索開始直後のfocus不安定性にも既存のsystem search状態を使う。
- 既存のavailability・写真受付・下書き/追送・同意/冪等再送のgateは変更しない。受付停止時は「新規申請の受付停止中」と説明し、送信可能と見せない。
- バックエンド、管理画面、承認フロー、本番設定、署名設定は変更しない。ローカルWorkerの既存fixtureをUIテストの読み取りに使い、申請はDEBUG専用注入stackのみ。
- 要件の追加・ADR変更なし。PRODUCT_REQUIREMENTS、ADR-0001/0013、Apple contractに従う。写真/公開承認の前提は既存のまま。

## 対象UIテスト

申請導線テストを、状態を明示確認する3 detentへ強化。通常/AX5で表示名・44pt・画面内・フォーム起動を確認し、検索開始時の退避と空検索終了時の復帰を確認する。
別の通常文字ケースで収納/中間/全画面の受付停止名と送信不可を確認する。AX5の受付停止操作を直接検証したとは扱わない。

## #347からの既知課題

`NativeSearchSheetUITests/testLargeTextSearchCandidatesCanBeReachedAndSelected` は #347で、iOS18.6のRefresh到達タイムアウトとiOS26.5のXCTest `Activation point invalid` が断続的に発生した。これを新規製品回帰と自動的に同一視せず、今回の失敗があれば箇所/実画面を記録して区別する。
#347はiOS18.6のDataAndPrivacy/PhysicalTypeFilter/EmptyFilterもmain既知失敗として報告。今回変更のない領域まで成功と主張しない。
実VoiceOverの音声・ジェスチャー、署名済み実機のAX5、実App Attest/本番配送は未検証。手動確認は[既存資料](2026-10-27-report-submission-ux.md)参照。

## 検証記録

iOS26.5 dark の統合導線3件：**3/3 PASS**。通常/AX5は収納・中間・全画面からフォーム起動、44pt/非クリップ、検索開始時退避、空検索終了時復帰を確認。受付停止も3段階で停止を明示し、送信不可を確認。

| 状態 | iOS26.5 / AX5 | iOS18.6 / AX5 |
| --- | --- | --- |
| 収納 | [画像](../assets/research/report-submission-integration/collapsed-ios26-ax5.png) | [画像](../assets/research/report-submission-integration/collapsed-ios18-ax5.png) |
| 中間 | [画像](../assets/research/report-submission-integration/medium-ios26-ax5.png) | [画像](../assets/research/report-submission-integration/medium-ios18-ax5.png) |
| 全画面 | [画像](../assets/research/report-submission-integration/large-ios26-ax5.png) | [画像](../assets/research/report-submission-integration/large-ios18-ax5.png) |

[受付停止・全画面](../assets/research/report-submission-integration/paused-ios26.png)。加工なしのSimulator/DEBUG注入stack証跡で、本番受付・実機の証明ではない。

`make contract` **11/11 PASS**、`git diff --check` PASS。
`make apple-validate` exit **0**：iPhone **310/310**、Watch **37/37**、Watch build、Debug/Release境界、Release埋込バイナリ検査が成功。

### 中断と写真追送テストの修正

iOS26.5回帰24件のrunは、途中で別作業のXcode開始を検出し、自分のプロセスだけをSIGINTで中断（exit75）。run全体は成功扱いにしない。
結果確定は15件成功、写真追送1件のassertion失敗、新規申請1件が`Testing was canceled`。残りは未実施として補完する。

写真追送の失敗は、`testRelaunchOffersResumeAndSendsPhotoToTheSameReport`が一覧の`resumeReportPhotos`までスクロールした後、全画面では非表示になる`mapReportButton`を90秒待っていたこと。
ツリーは全画面の一覧/固定バーに追送ボタンがある状態を示した。uploadや下書きの失敗ではなく、mainにも存在するテスト経路の不整合。
表示済みの一覧内追送ボタンをsettle→tapする最小のテスト修正とした。写真・申請処理には追加変更なし。
別作業と重複しないよう、残りの実行を短い単位に分割し、開始前の待機と実行中の他Xcode検出で自分だけ中断する。

### iOS26.5 最終照合

対象は **27ケースすべて成功**（J申請11、I写真4、決定的目的地検索6、Native検索4、詳細2）。一括runの成功ではなく、上記の中断後に未完了・修正対象を補完し、各テストIDの最終成功を照合した結果。

| run | 成功 | 失敗/中断 |
| --- | ---: | --- |
| 初期の統合導線 | 3 | 0 |
| 最初の回帰run | 15 | 写真1、cancel1、残り未実施 |
| 写真追送修正後 | 1 | 0 |
| 残りの申請 | 4 | 0 |
| 収納/3段階シート | 2 | 0 |
| 複数目的地・名称・変更・解除 | 1 | 0 |
| AX5検索・候補選択・Refresh・detent | 1 | 0 |

AX5検索は今回は成功したが、#347の断続問題の根因を修正したとは主張しない。
最初の回帰runには`Invalid frame dimension (negative or non-finite)`が2件記録されている。既存#344検証にも類似警告の記録があり、発生源特定は今回の統合差分では行っていない。

### iOS18.6 導線

通常/AX5/受付停止の統合導線 **3/3 PASS**。Xcode競合で中断したattempt1〜3は成功扱いにせず、単独実行のattempt4で結果を確定した。3段階からフォーム起動、44pt/非クリップ、検索中の退避と終了後復帰を確認。

### iOS18.6 回帰照合

対象 **27ケースすべて成功**（J申請11、I写真4、決定的目的地検索6、Native検索4、詳細2）。

| グループ | 成功 | 失敗 |
| --- | ---: | ---: |
| 統合導線 | 3 | 0 |
| 通常受付/受付停止/名前・trait監査/明示再送 | 4 | 0 |
| 下書き/英語 | 2 | 0 |
| 最大文字サイズの入力/再送 | 2 | 0 |
| 写真選択/送信/写真のみ再送/再起動後追送 | 4 | 0 |
| 決定的目的地検索 | 6 | 0 |
| 一覧/ピンから詳細 | 2 | 0 |
| 収納/3段階シート | 2 | 0 |
| 複数目的地・名称・変更・解除 | 1 | 0 |
| AX5検索 | 1 | 0 |

最大文字サイズの申請runにframe dimension警告2件がある。テスト失敗やクラッシュはなく、警告の原因特定は未実施。
#347のAX5断続失敗は今回は両OSとも再現しなかった。根因解決の主張はせず、継続課題として保持する。

最終のテストレビューで、当初の検索開始/終了の直接assertionは全画面だけだったことを確認した。
追加の1ケースでは通常/AX5の両方について、中間・収納から空検索を始めると地図上の申請ボタンが消え、終了後に元のdetentと同ボタンが復帰することを直接検証する。アプリ側の追加変更はない。

追加の空検索ケースは **iOS26.5 1/1、iOS18.6 1/1 PASS**、runtime warningなし。
1 XCTestケース内で通常/AX5 × 中間/収納の4経路を確認し、全画面の既存確認と合わせ、3段階それぞれで検索中退避と終了後復帰を直接確認した。
受付停止の操作テストは通常文字であり、AX5の受付停止まで検証したとは主張しない。
独立コード/テストレビュー、両OSのAX5実画像レビューにブロッキングな指摘はなかった。
