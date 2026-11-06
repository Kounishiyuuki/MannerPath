# 確定前の整合チェックと承認後の変更順序

基準main `b13a061`（#383/#384/#385統合後、iPhone 1.0(8)）。本PRは候補だけを更新し、稼働する規約・同意・公開URL・source gateは変更しません。

| 対象 | 現状を確認した根拠 | このPRと、承認後に残る操作 |
| --- | --- | --- |
| アプリ同意文書 | `ReportDomain.swift`のReportTermsは`report-terms.2026-09-30.draft`/isDraft=true。同名Termsファイルをbundleから表示 | 候補を直接bundleしない。承認後の新versionを登録し、全文bytes・要約・日英説明を照合 |
| API規約 | `services/api/src/reports/terms.ts`はdraftのSHA256を固定、CURRENTはdraft。community-publication.tsはpending | 草案bytes/hashとpendingを保持。承認後のみ新version/path/hash/terms URL/承認記録を追加。草案の権利を昇格しない |
| 同意と公開 | acceptedTermsVersionはApp Attest対象。draftのpublicationRightsはpending、sourceはblocked | 通常申請の受付と公開権利は別。既存staging2件を新規約へ遡及移行しない。独立確認と後段審査も残る |
| 位置情報 | API説明は#383でraw GPS自動送信と明示選択pinを区別済み。iOSは明示選択した現在地pinも送る | 現在の説明を維持。raw GPS自動送信を意味しない。PrivacyのPrecise Locationは収集/関連付けありを維持 |
| 保持 | create.tsは90日期限、retention.tsは本文/pin/関連付け等の最小化。receipt・分類・監査・認証は別。wranglerのcronsは空 | `local:reports:retention`はLOCAL ONLYで本番完了の証拠に使わない。生成planの定期処理と[最小運用手順](OPERATIONS.md)・オフラインheartbeat判定を準備済み。実配備/実行成功/日次確認は未完了。早期削除/withdrawalはADR-0021 Proposedのまま |
| Privacy/Support | `site/`は申請停止時の公開用原稿 | 日英置換HTMLを`docs/`下に準備。まだ公開元を変更しない。未決箇所を確定し、警告を除去、日付/スタイルパス/リンクを最終化して別承認の公開PRへ |
| App Privacy | text-reports JSONはcandidate-not-approved/submissionReady=false、5型のCollected/Linked/NotTracking案 | iPhone manifestは#384で申請データを宣言済み。最終archiveとの一致は未確認。既存条件を維持。提供者ログ/問い合わせ添付/最終archiveを検証して回答とmanifest/Privacy Reportを一致させる |
| App Store説明/Review Notes | 写真なし、限定再試行、明示pin、審査待ち、独立確認、90日最小化/別保持/再install制約を記載 | 文面の意味は候補と一致し変更不要。『approved retention』は承認後の最終公開policyを指す。公開前/本番停止中にそのままASCへ転記しない |

[最小反映差分](ACTIVATION_DIFF.md)のGPS/90日要約は#394で日英採用済み。新しい全文と最終署名RCの一致は別途確認する。Q2の[公開前P0確定表](Q2_PUBLICATION_P0.md)に、判断・実行証拠・必要時のみの追加実装を分けた。

## 最短の実施順序

1. Q1〜Q3への回答を記録し、保持台帳/本人確認・削除/取り下げの未実装・運用不能を解消。推奨期限を現状の保証として先に公開しない。
2. 必要に応じ法務確認後、候補本文の未決注記を除き、最終bytesから新しい規約version/hashを生成。旧draftは不変。
3. 小さい承認済みPRで新規約をアプリ/APIへ揃え、同意署名/権利/独立確認/非遡及の既存テストを実行。承認とsource公開操作は分離。
4. Privacy/Support/規約URL・manifestを同じ意味へ揃え、署名ReleaseでURL到達・同意全文・送信payload・写真非収集を確認。公開URLを切替える担当と受付開始時点を合わせる。
5. 最終metadata/Review Notesと公開範囲を再照合。既存Release Gateの実機/無料枠/素材/ASCゲートを閉じた後、運営者が本番・Apple提出を別途判断。

このチェックはソース/ローカル検証であり、実機・本番設定・法的十分性・承認済みを示すものではありません。
