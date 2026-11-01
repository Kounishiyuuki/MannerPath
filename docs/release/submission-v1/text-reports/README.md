# v1.0：写真なし新規地点申請の提出候補

**SUBMISSION: BLOCKED。未承認・実装待ち。** 2026-11-02、main `1fdf89a`基準。
利用者の明示的な仕様変更により、v1.0は**新規地点申請あり・写真添付なし**。
以前の全面停止/写真必須P0は上書き。写真はv1.1以降の計画で提供時期を保証しない。
この文書PRは公開Web、ASC、本番API、iOSコードを変更せず、有効化・法務承認を代行しない。
[canonical Gate](../../../V1_APP_STORE_RELEASE_GATE.md)のP0は実装・実機・承認の証拠が揃うまでOPEN。

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

根拠：[Apple Privacy定義](https://developer.apple.com/app-store/app-privacy-details/)を2026-11-02確認。
申請は主要機能で毎回同意しても開示例外とはしない。写真型を除くmanifest候補5型は未組込。
現iPhone manifestは収集型未宣言のため、この候補とまだ一致しない。
最終manifest/生成Privacy Report/承認済み回答/公開policyを一致させる作業はLane1/3・運営者側に残る。

## 保持・削除・再installの利用者向け候補（未公開）

「申請すると、確認した位置、申請内容、端末認証に由来する識別情報を、審査と不正対策のために取り扱います。
v1.0では写真の添付・送信は提供しません。申請は自動では掲載されず、運営者が審査します。
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

## Lane 1・3との未確定事項（現mainの差分）

| 担当 | 現mainの阻害・食い違い | v1.0の受入条件 |
| --- | --- | --- |
| Lane1 | `ReportModel.acceptsNewSpotProposals`がphoto config/termsを要求。preflight/submitも写真必須。`ContentView`は停止alert、`ReportFormView`は必須写真section | 写真offでも新規申請開始/確定/送信可。写真picker・upload・retry/follow-upなし、写真不要の説明。既存受付/同意/二重送信対策は維持 |
| Lane3 | create経路は写真なしreportを保存可能だが、`review.ts`/`photos.ts`とREPORTS_DB migrations0009/0010が写真なし新規地点のreview/exportを拒否 | 写真なしの証拠審査基準・review/exportとDB制約を整合。写真必須を外してもsource/rights/位置/品質/独立性のゲートを迂回しない |
| Lane3/運営者 | draft terms / community publication pending、実runtime未確認 | #124の通常申請・再利用規約を新versionで承認/同意整合。申請有効、photo route/config無効を確認。写真条項の承認待ちをv1.0申請全停止の理由にしない |
| Lane1/3 | 保存・失敗再送・受付ID・本人確認が最終RCで未検証 | 実App Attest送信、同じidempotencyによる安全な再送、再起動/再installの説明と一致。未提供の履歴復旧/削除を約束しない |

PR #372の「申請自体を延期推奨」は今回の指示で上書き。Lane3所有の同PR3ファイルは編集せず、統合時に再照合する。
写真なしの受理と、審査を経た掲載可能性は別であり、現mainのまま提出可能とは認定しない。

## App Review・実機・撮影の実行シート（全件NOT RUN）

全行でRC source SHA/archive hash/build、端末/OS、日時、期待との差、private証拠ファイルを記録。
実機を操作していない。iPhone16Proはnative1206×2622、Watchは実機対応寸法で全locale同じものを選ぶ。
未公開pin/fixtureを公開地点のように見せない。写真scene I05や写真送信成功ケースはv1.0対象外。

| ケース | 操作 | 期待結果 | 証拠 |
| --- | --- | --- | --- |
| 初回/位置 | cleanな専用install→起動/年齢説明→明示位置要求、別sessionで拒否 | crashなし、不要な自動promptなし。拒否でも目的地検索可 | build/端末、prompt前後録画 |
| 検索/案内 | 浅草駅 東京→目的地→公開map/list→地点選択/詳細/出典→案内/Maps→解除 | 不明/目安/鮮度を保持。遠方徒歩不可は正常説明。解除可能 | 公開ID/出典、Maps前後録画、map credit付き画像 |
| 写真なし申請 | **承認済み環境でのみ**追加入口→pin確定→重複→種類/条件/自由文→規約/同意→送信1回 | photo UIも要求もなし。unknown可。実App Attest受付ID/審査待ち。自動掲載なし | 操作録画、規約版、private ID、運営者の受理件数/attestation記録。dummy本番申請禁止 |
| 通信/再送 | 許可済みstagingで送信前offline、受理応答欠落、再起動→再送 | 入力保持、安全な同一report再送、重複なし、原因と回復方法を表示 | 切断時点、同じID/受理件数、前後録画。mockのみで本番成功としない |
| 受付停止安全 | 別途用意済み停止環境で入口 | 停止理由、送れない。受付可能を装わない。試験のため本番を停止しない | config参照/alert |
| Watch同期 | 初回未同期→実掲載地域のiPhone現在地nearby更新→Watch | 未同期/正常0件/通信失敗/staleを区別。実WC受信、fresh時刻/revision | 両端末画像、公開ID/時刻、再接続結果。目的地検索は同期しない |
| Widget | iPhone/Watchのapp正常後small/medium/lock/Smart Stack/complication→tap | 同じ先頭/目安/不明、署名App Groupで共有、正しい遷移 | 画像・更新時刻/遅延。Widgetは別ストア枠ではない |
| offline/stale | cache読込→機内/再起動、別sessionはcacheなし、Watchは1h超切断 | cache/空/通信失敗/古さを区別。offline徒歩案内を約束しない | 実経過時刻/録画、再接続結果 |
| AX5/VO/dark | iPhone最大文字/keyboard/3detents→検索/申請/同意/receipt。Watch VO/大文字。darkへ | 欠け/到達不能なし、読み順/状態通知、停止も読める | 設定/端末/録画・音声。未確認アクセシビリティをASCで主張しない |
| policy/support | Data & Privacy→各URL/メール作成、source license | 正しい承認文面/到達、宛先、送信は不要 | URL/画面。公開Web変更は別担当 |

審査メモは[全文](review-notes.txt)を使う。写真なしの**正当な**申請を使い、送信や公開を撮影目的で捏造しない。
撮影はmap/search/selection/source、新規申請pin/条件/確認（写真なし）、Watch list/detail、Widget。
申請sceneに無関係の公開spot IDを与えて既存画像validatorを通さない。private台帳でscene/実pin/権利承認を管理。
G1/G2/G3/G5/G6/G7/G8/G10–G12/G14–G17/G19/G21/G23は実証拠待ちでOPEN。
写真v1.1作業はv1.0の完了条件ではないが、通常申請の実装・審査・同意・privacyの不足は残る。
