# 正式承認後の最小反映差分（未実行）

候補差分の準備は可能。承認済み値を反映する段階では、[公開前P0表](Q2_PUBLICATION_P0.md)のP01/P02の結論と最終全文の正式承認が必要。
保持/外部保存先の実態が本文を変えるなら先に確定する。公開・受付開始までにP03〜P05を含む全P0を閉じる。最終RC照合を差分作成前の必須条件にして循環させない。
以下は作業手順で、承認・公開許可ではない。[Q1〜Q3](OWNER_CHOICES.md)の再選択は求めない。
今はdraft/pendingと`REVIEWED_PHOTO_TERMS=[]`を維持する。版文字列や最終hashを先に確定しない。

## 1. #394で採用済みの同意要約（日英、旧表現は変更履歴）

main `b13a061`で下記の採用文へ修正済み。全文bundleとは別の要約であり、今後は新版全文・署名RCとの一致を確認する。表の旧keyは変更履歴で、現行表示ではない。

| 修正箇所・旧説明（履歴） | 採用済み日本語 | 採用済み英語 |
| --- | --- | --- |
| ReportTermsSheetの`No account is needed. Your device location and location history are not sent.` | アカウントは不要です。閲覧時の現在地は端末上で使います。申請では明示的に選び確認した位置を送信し、現在地と一致する場合があります。位置履歴を自動収集しません。 | No account is needed. Browsing uses your location on the device. Reports send the pin you explicitly select and confirm; it may equal your current location. Location history is not automatically collected. |
| 同`Personal content ... is deleted within 90 days of receipt.` | 申請本文・位置・確認日等は、受信後90日を基準に最小化する設計です。処理の実行が必要で、認証・審査記録や復元履歴などは別に残ります。全情報の完全消去ではありません。 | Personal report fields, including text, pin and observation date, are designed to be minimized based on 90 days after receipt. Processing must run; authentication, review records and recovery history remain separately. This is not complete erasure of all data. |
| ReportFormViewの`Names and hours ... deleted after 90 days.` | 店名や自由入力の営業時間は審査用で、受信後90日を基準に最小化する対象です。処理状況や別に残る記録については規約・Privacyをご確認ください。 | Names and free-text hours are for review and are subject to minimization based on 90 days after receipt. See the terms and privacy policy for processing and separately retained records. |

`ReportTermsSheet.swift`・`ReportFormView.swift`と対応する`Localizable.xcstrings`は#394で修正済み。
この変更は位置/保持説明の採用で、正式規約の承認やdraft切替ではない。再修正をP0にせず、最終署名RCで日英の表示・改行・リンク・新版全文との一致を記録する。

## 2. 新しい正文と版/hash

1. 正式な採用内容・承認者・日付、公開名/窓口/適用日/URLを記録する。和文候補の冒頭注記/metadataを確定し、本文が承認時から変わったら再確認。
2. 新version `report-terms.YYYY-MM-DD`を全文に入れ、`prepare-report-terms.py --document <最終.md> --version <新version>`で正確なbytesのhash/pathを得る。出力は承認証明ではない。
3. 正文を`docs/legal/report-terms/<version>.md`とiOSの`Features/Reports/Terms/<version>.md`へ同一bytesで配置。旧draft原文/hashを保持。
4. API `community-publication.ts`には正式承認された値だけを記録し、新版path/hash/URLを登録。API registryの新版とiOS `ReportTerms.documents`を対応させる。iOS要約は#394の採用済み文を維持し、最終全文との一致を確認する。
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
