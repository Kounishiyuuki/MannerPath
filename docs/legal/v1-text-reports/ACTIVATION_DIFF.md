# 正式承認後の最小反映差分（未実行）

前提：[Q1〜Q3](OWNER_CHOICES.md)と最終全文の正式承認、Q2の法務/運用上のP0解消。以下は作業手順で、承認・公開許可ではない。
今はdraft/pendingと`REVIEWED_PHOTO_TERMS=[]`を維持する。版文字列や最終hashを先に確定しない。

## 1. 同意要約の具体的な置換候補（日英、未承認）

現iOSの全文bundleと下記の要約は別なので、全文を追加するだけでは不一致が残る。

| 修正箇所・現在の説明 | 承認後の日本語候補 | 承認後の英語候補 |
| --- | --- | --- |
| ReportTermsSheetの`No account is needed. Your device location and location history are not sent.` | アカウントは不要です。閲覧時の現在地は端末上で使います。申請では明示的に選び確認した位置を送信し、現在地と一致する場合があります。位置履歴を自動収集しません。 | No account is needed. Browsing uses your location on the device. Reports send the pin you explicitly select and confirm; it may equal your current location. Location history is not automatically collected. |
| 同`Personal content ... is deleted within 90 days of receipt.` | 申請本文・位置・確認日等は、受信後90日を基準に最小化する設計です。処理の実行が必要で、認証・審査記録や復元履歴などは別に残ります。全情報の完全消去ではありません。 | Personal report fields, including text, pin and observation date, are designed to be minimized based on 90 days after receipt. Processing must run; authentication, review records and recovery history remain separately. This is not complete erasure of all data. |
| ReportFormViewの`Names and hours ... deleted after 90 days.` | 店名や自由入力の営業時間は審査用で、受信後90日を基準に最小化する対象です。処理状況や別に残る記録については規約・Privacyをご確認ください。 | Names and free-text hours are for review and are subject to minimization based on 90 days after receipt. See the terms and privacy policy for processing and separately retained records. |

`ReportTermsSheet.swift`・`ReportFormView.swift`と対応する`Localizable.xcstrings`だけを修正する候補。
同じ旧表現の英日keyを検索し、アクセシビリティ表示・改行・リンクを確認する。draftの全文は書き換えない。
**最小コード修正として必要**であり、現行1.0(8)がこれらの候補文で表示済みとは扱わない。

## 2. 新しい正文と版/hash

1. 正式な採用内容・承認者・日付、公開名/窓口/適用日/URLを記録する。和文候補の冒頭注記/metadataを確定し、本文が承認時から変わったら再確認。
2. 新version `report-terms.YYYY-MM-DD`を全文に入れ、`prepare-report-terms.py --document <最終.md> --version <新version>`で正確なbytesのhash/pathを得る。出力は承認証明ではない。
3. 正文を`docs/legal/report-terms/<version>.md`とiOSの`Features/Reports/Terms/<version>.md`へ同一bytesで配置。旧draft原文/hashを保持。
4. API `community-publication.ts`には正式承認された値だけを記録し、新版path/hash/URLを登録。API registryの新版とiOS `ReportTerms.documents`を対応させる。iOS要約も上記の採用済み文へ揃える。
5. 英訳は参考訳としてWeb用に同じversion/適用日を明示。和文正文を英訳hashへすり替えない。iOSで英訳を表示する追加対応を採用する場合は同じ版との対応を別途テストする。

## 3. 公開WebとPrivacy回答

- `site/privacy/index.html`・`site/support/index.html`へ承認済み日英を反映する差分、Q3の`site/terms/reports/index.html`を用意する。予定URLは未公開であり、今は変更しない。
- 候補警告/公開日付を確定し、CSS/ホーム相対リンクを戻す。API termsUrlとiPhone/Watchから全文・Privacy/Supportへ到達することを確認する。
- App Privacyは本文/位置/Device ID/サポート/メールのCollected/Linked/Not Tracking案を原則維持。実ログ/提供者・サポート添付を確認し、Photos非収集6条件と最終archive Privacy Reportを照合する。写真再有効化やストア回答の代理確定をしない。
- Pagesが自動公開する差分は、正式なWeb公開許可があるまでmergeしない。規約本文承認と、本番受付/個別データ公開は別許可。

## 4. 最小検証と切替

`make contract`、API `report-terms`/`community-activation`/同意・署名/独立確認の対象テスト、`make api-validate`、iOS変更の`make apple-validate`を実行。
新版全文の同一bytes/hash・configのtermsVersion・同意署名・旧版拒否/更新案内・非遡及を検証。
署名RCで日英要約/全文/Privacyと送信内容、写真UI/旧follow-upなしを観測する。
承認済みアプリ/公開URL/サーバー版を揃えて切り替える。アプリだけ/サーバーだけを先行して、利用不能や旧文同意での正式受付を起こさない。
本番のデプロイ/DB/登録開放は別の許可と#387のpreflightを使い、この準備作業では実行しない。
