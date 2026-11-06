# 写真なしv1.0 — 規約・公開ページの変更準備

**CANDIDATE / NOT APPROVED。公開禁止。**

現在の判断入口は[Q1〜Q3の選択表](OWNER_CHOICES.md)。承認対象全文・実装上の限界・残るP0と、承認後の最小反映差分まで揃えています。 #124の承認を代行しません。基準main `3463e15`（#373統合後）。

## 最終確認する文面

[最終文面確認票](FINAL_TEXT_REVIEW.md)から規約全文・日英Privacy・Supportの3点を確認してください。本文の編集用注記は整理し、未解決の法務/運用判断と承認後の最小反映PRを同票へ分離しました。未承認/未公開の状態は維持しています。

## 実際に用意した差分

- [規約候補](../REPORT_TERMS_CANDIDATE.md)：現在地と確定pin、App Attestの関連付け、90日最小化と履歴、手動相談/本人確認、再利用・取り下げ・免責を修正。稼働中の草案bytesは不変。
- [日英Privacy置換HTML](web/privacy/index.html)：写真なし申請、情報と目的、D1/保持/削除、再install、問い合わせを更新。
- [日英Support置換HTML](web/support/index.html)：申請開始→審査待ち、失敗/限定再送、削除相談、再installを更新。
- [3問の決定表](DECISIONS.md)：従来の12項目をまとめ、技術的に担当者が決められる版/hash操作を質問から除外。
- [整合・切替チェック](CONSISTENCY.md)：現アプリ/API/草案/公開ページと、承認後に変更すべき順序。

HTMLはレビュー可能な完成した置換案ですが、保持に関する現実装の制限を本文で開示し、残る判断は最終確認票で管理します。承認後の別PRで注記/日付・実稼働・CSS/トップページパスを確定し、`site/privacy/index.html`・`site/support/index.html`へ反映します。
このPRのmergeで公開されません。Pagesは`site/`だけを配信し、`docs/`は含まれません。`site/`、規約レジストリ、bundled terms、公開sourceを変更しません。
既存スタイルはローカル相対参照し、英語アンカーと相互リンクを維持しています。CSSとトップページは既存siteへのローカル参照です。公開用コピーでは既存の`../style.css`と`../`へ戻します。

## 残る公開条件

Q1〜Q3への回答だけでP0は閉じません。期限・本人確認/withdrawalの履行可能性、保持処理の実行、最終文面の法務/運営承認、規約bytes/hash、最終Release/manifest/Privacy Report、公開URLとの一致が必要です。
新しい期限候補は現実装済みとは扱いません。自動削除/本人確認/履歴復旧を一般利用者へ約束しません。
App Storeの[説明](../../release/submission-v1/text-reports/description-ja.txt)・[Review Notes](../../release/submission-v1/text-reports/review-notes.txt)は再照合し、意味の変更は不要。現在の候補を無条件でASCへ転記しません。

## 公式資料（2026-11-05確認）

- [Apple App Privacy定義](https://developer.apple.com/app-store/app-privacy-details/)：アカウントがなくても端末関連付けを回答。追跡と機能用途を区別。
- [D1 Time Travel](https://developers.cloudflare.com/d1/reference/time-travel/)・[D1 limits](https://developers.cloudflare.com/d1/platform/limits/)：常時有効、Free7日/Paid30日。SQL削除は過去履歴や物理消去と別。
- [Workers Logs](https://developers.cloudflare.com/workers/observability/logs/workers-logs/)：提供者仕様と実設定/別ログを区別。全ログの消去期限とはしない。
- [個人情報保護委員会 法令・ガイドライン](https://www.ppc.go.jp/personalinfo/legal/)：法的判断の参照入口。推奨日数は法定期限や法的十分性の認定ではない。

## ローカル検証

`python3 scripts/test-v1-legal-prep.py` は候補の公開artifact非混入、稼働中草案のbytes/hash、pending権利ゲート、申請/写真なし/日英記述を確認。
`make contract`も実行。実機・本番・法的承認を検証するテストではありません。

## 1.0 (8)の次の実作業

#384でiPhone manifestが更新、#385で本番用のローカル生成planが追加済み。[最小運用手順](OPERATIONS.md)は、生成cronの容量修正、未実行/遅延を正常扱いしない検査、削除相談の可能/不可能、P0/P1と承認後のversion/hash準備をまとめています。実配備・法的承認は未完了です。

## Q2の具体的な残件と調査結果

[保持台帳・請求対応の実態](Q2_RETENTION_REGISTER.md)に、Issue #124の準備方針の採用（正式承認ではない）、22テーブル等の保持目的/実期間/削除可否、P0/P1、担当者の実行証拠を整理しました。Q1〜Q3を再選択する必要はありません。
