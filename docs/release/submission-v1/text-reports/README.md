# v1.0：写真なし新規地点申請の提出候補

**SUBMISSION: BLOCKED。** スコープ決定は2026-11-02。最新照合main `2e0eec7`（運営者の実機報告2026-11-05）。
利用者の明示的な仕様変更により、v1.0は**新規地点申請あり・写真添付なし**。
以前の全面停止/写真必須P0は上書き。写真はv1.1以降の計画で提供時期を保証しない。
この文書PRは公開Web、ASC、本番API、iOSコードを変更せず、有効化・法務承認を代行しない。
[canonical Gate](../../../V1_APP_STORE_RELEASE_GATE.md)のP0は実装・実機・承認の証拠が揃うまでOPEN。

[2026-11-05の要件総点検・4分類・優先ブロッカー](REQUIREMENTS_AUDIT.md)を提出前に確認する。

## 転記用ファイル

[日本語説明](description-ja.txt)、[Review Notes](review-notes.txt)、[metadata](metadata.json)、
[App Privacy候補](app-privacy-candidate.json)、[未組込manifest候補](PrivacyInfo.reports-only.candidate.plist)。
候補の「申請できます」は完成後の提出対象の説明で、現本番機能の確認ではない。
Lane1/3の実装と下記の条件が揃うまでASCへ転記しない。掲載地域は過去の6-source観測を基にした候補。
当日の承認済み配備/公開範囲を照合し、descriptionとnotesを同時に修正する。金沢候補や未公開データを加えない。

## App Privacyの再評価（未承認）

| 型 | 提案 | 根拠・条件 |
| --- | --- | --- |
| Photos or Videos | アプリ内収集なし。ASCからの除外は条件確認後 | v1.0は選択/upload/retryを提供しない。support添付やprovider経由で写真を保持するなら、そのflowとして申告を再評価。写真offだけでサービス全体の非収集を断定しない |
| Other User Content | Collected / Linked / Not Tracking / App Functionality | 申請本文・自由文claimを審査用に保持 |
| Precise Location | 同上 | 明示確定pinは現在地と一致し得る約1m精度。閲覧のraw GPS自動送信とは別 |
| Device ID | 同上 | App Attest key ID/public key、key由来submitter hash。無アカウントは非関連付けではない |
| Customer Support / Email Address | 同上の既存包括案 | Gmailの送信者/問い合わせ内容。保管範囲と任意開示例外は運営者確認 |
| Coarse Location / Other Diagnostic Data等 | 未決 | tile/IP/ログ、provider/Logpush、support保持、最終archive通信の確認が必要。写真延期では解決しない |

根拠：[Apple Privacy定義](https://developer.apple.com/app-store/app-privacy-details/)を2026-11-03再確認。
申請は主要機能で毎回同意しても開示例外とはしない。写真型を除くmanifest候補5型は未組込。
現iPhone manifestは収集型未宣言のため、この候補とまだ一致しない。
最終manifest/生成Privacy Report/承認済み回答/公開policyを一致させる作業はLane1/3・運営者側に残る。

## 保持・削除・再installの利用者向け候補（未公開）

「申請すると、確認した位置、申請内容、端末認証に由来する識別情報を、審査と不正対策のために取り扱います。
v1.0では写真の添付・送信は提供しません。申請は自動では掲載されず、運営者が公式情報源や現地確認などの独立した根拠で確認・審査します。
申請本文、位置、自由文や申請者の関連付け情報は、受信から90日を基準に削除・最小化する設計です。
これは全記録の消去ではなく、最小限の受付・審査記録や項目の分類などが残ります。
認証鍵の登録・不正対策記録、問い合わせ情報の保持は申請本文とは別です。
データベースの復元用履歴や別途管理するバックアップには処理前の情報が残る可能性があり、
SQL上の削除・最小化を、即時の復元不能化や媒体からの物理的消去とは説明しません。
アプリの再インストールはサーバー上の削除依頼にはなりません。元のinstallの認証情報を失うと、
過去の申請の所有確認や復旧ができない場合があります。報告IDだけで削除や復旧を保証しません。
取扱いのご相談は報告IDが分かる場合は添えてサポートへ。鍵・認証情報・本人確認書類を送らないでください。」

この90日は`create.ts`/`retention.ts`の**現コードの最小化設計**で、実cron成功や物理消去期限の確認ではない。
D1 Time Travelは[常時有効](https://developers.cloudflare.com/d1/reference/time-travel/)、
[Free 7日/Paid 30日](https://developers.cloudflare.com/d1/platform/limits/)の復元窓（2026-11-02確認）。
実plan、copy/export、restore後の最小化再適用、認証登録/receipt/audit/support保持を運営者が確定するまで公開しない。
ADR-0021の早期最小化endpoint/申請履歴/本人確認は未実装。削除ボタン・即時完全削除を約束しない。
申請の個人情報削除と公開済み場所factの撤回は別。第三者privacyリスクは本人確認不能でも一律拒否せず運営者へ相談する。

## 最新状況（2026-11-05）

main `2e0eec7`へ#374・#375・#382（旧#381の再送実装）が統合済み。
証拠はmain上の自動テスト記録と2026-11-05の運営者報告。このLaneは実機・remote操作を再実行していない。

| 区分 | 確認できた範囲 | 未確認・限界 |
| --- | --- | --- |
| 実施済み（運営者報告） | 実機App Attestで写真なし申請201。stagingに2件保存、pending、未掲載 | 最終提出Release全体のPASSではない |
| 自動テストのみ | 冪等性、独立確認必須、審査・export制限、限定v3再送 | 実機の特殊な応答消失、staging実承認・exportは未検証 |
| 実施済み（構築/停止） | REPORTS_DB0011、合成データ、readiness/security-smoke成功。その後App Attestを無効化し受付停止・fail-closed確認 | 過去のavailable=true/登録pausedは試験時点。現在の受付稼働を意味しない。本番は未変更 |
| 未確認 | 十分なCPU余裕、1102時の実機復旧、CHALLENGE_RATE_LIMITERの429 | 成功受付やbinding存在から安全余裕・IP制限成功を推定しない |
| 未完了 | #124、最終署名Release・iPhone/Watch/Widget・提出素材・ASC・本番有効化 | 未承認・未検証を完了扱いしない |

合成データはストア素材に使用しない。実機2件の成功は写真非収集6条件やprivacy承認全体の代用ではない。
[運営者の決定表](OWNER_DECISIONS.md)と下記の残件に従う。

[最終レビュー・提出P0とv1.1分離](FINAL_REVIEW.md)を参照。
