# iPhone 16 Pro / Watch：そのまま使う実機・撮影シート

**全件NOT RUN。結果欄をPASSで事前入力しない。** [既存matrix](../../beta-e2e/device-release-matrix.md)の
履歴は保持し、本シートの証拠を同じRCの該当行に追記する。機能が停止中なら写真成功ケースはBLOCKED。
検証のための本番設定変更・ダミー送信はしない。写真送信ケースは別途許可されたstagingで実行し、
最終本番RCの有効化確認/正当な申請の実送信は運営者が別途許可する。mockを実本番成功と記録しない。

## 0. セッション開始（privateな記録へコピー）

- 日時/担当：
- source SHA / archive hash / IPA hash / ASC build identity：
- アプリversion/build / 配布経路 / API環境（stagingまたはproduction）：
- iPhone 16 Pro / iOS：
- Watch機種・ケース寸法 / watchOS：
- 言語ja / region / light-dark / 文字サイズ：
- App Attest environmentと受理buildの確認担当・証拠参照（秘密値を書かない）：
- 規約version/承認記録、公開privacy policy/ASC回答の承認参照：
- 対象地域と承認済みcorpus、別途許可された当日公開観測のhash/時刻：
- paired Watch、両Widgetのインストール、選択RCの署名preflight証拠：
- 画像・動画・結果を保存するprivateディレクトリ：

自分の端末/専用テスト環境だけを使う。既存draft/写真再送を失わないよう必要な記録を先に確保し、
消去してよい専用インストールでのみクリーンインストール試験をする。通知を隠し個人情報が映らないようにする。

## 1. 実機検証：上から順に実行

| ID / matrix・gate | 操作手順 | 期待結果 | 保存する証拠 |
| --- | --- | --- | --- |
| D01 / P1,AI1,W1; G14/G17/G21 | 専用端末へ選択RCを新規install→起動→年齢/利用説明を確認。iPhone Nearbyを読み込む前にWatchを開く | 起動crashなし。初回説明。Watchは未同期を示し、正常0件とは区別する | build表示、初回画面、Watch未同期画面、機種/OS/時刻 |
| D02 / P4; G17 | iPhoneで現在地使用を明示操作→When In Use許可→更新。別クリーンsessionで拒否→目的地検索 | 操作前に不要な位置promptなし。許可時は更新。拒否でも目的地検索可、設定変更を強制しない | prompt前後の録画、許可/拒否結果、session別記録 |
| D03 / D1–D5,P10,P14; G12/G17 | 「浅草駅 東京」を入力→候補選択→公開map/list→地点選択→詳細/出典→案内→Apple Maps→戻る→目的地解除 | 公開地点のみ。目的地からの距離と現在地を混同しない。遠方は徒歩寄り道計算なし。現RCの案内ボタンでMapsが開く。解除後に目的地名が残らない | 入力〜解除の録画、実公開IDと出典、Maps前後。私的GPS/住所は公開しない |
| D04 / G13/G5 | 詳細の出典/利用条件/目安/不明を確認→licenseリンク。Data & Privacy→privacy/support→メール作成 | 条件不明を許可としない。Webページが開く。メール宛先はmannerpath.support@gmail.com、送信不要 | 画面とURL、同じRCのリンク到達記録 |
| D05 / R14; G14/G16/G23 | **承認済み有効環境のみ**。追加入口（map上/展開sheet/検索中）→pin→移動/必要なら現在地→確定→重複候補→写真1〜3枚→条件→規約→同意→送信を一度押す | 審査用写真、重複、必須/任意/不明が説明される。現在地は選択後も編集でき、確定前に送らない。顔/ナンバーなしの実証拠のみ。受付完了・審査待ち＋ID。実App Attestで受理。即時掲載しない | 全手順録画、規約version、receipt ID/時刻、運営者の同一reportに対するApp Attest検証成功・写真受理記録。key/assertion/raw写真をGitへ保存しない |
| D06 / R14 recovery; G16/G23 | **staging/許可済み失敗試験のみ**。送信前にoffline→復帰。別ケースでreport受理後に写真だけ失敗→再送。途中で再起動→同じreportへ再選択 | 入力保持。原因/回復方法が表示される。受付済みreportを再送せず、残り写真のみ。同一IDのまま。二重tapでも重複なし | before/after ID、受理件数、確認済み写真数、network切断時点、再起動前後。画面だけでは二重送信なしと断定しない |
| D07 / paused; G16 | 設定変更せず、別途用意された停止中環境で追加入口を押す | 停止理由を表示し、新規form/draftを作らず送信不可。受付を装わない | runtime環境証拠とalert。停止環境が無ければNOT RUN、作るために本番を切り替えない |
| D08 / W2,G2/S1–S2,WG2/S3–S4; G14/G15 | **実掲載地域に実在**しiPhoneで現在地Nearby更新→無filterの先頭を記録→Watch起動→iPhone small/medium/lock Widget、Watch Smart Stack/complication追加 | Watchは実nearby snapshotを受信。更新時刻・revisionが進む。Widgetは各appの先頭/距離/鮮度と一致。目的地検索だけで成立させない | 両端末並び画像、公開ID、更新時刻/revision（観測可能範囲）、Widget更新遅延。署名App Group証拠 |
| D09 / Watch sync states; G15 | Watch同期なしのD01と比較。実掲載なし領域で正常nearby更新。次にiPhone圏外/Watch通信offで更新→復帰して再同期 | 未同期/正常0件/通信失敗は別表示。到達不可は速やかに失敗表示。到達可能だが応答しない専用試験では最大約15秒で待機終了。遅い応答が新しいrevisionを戻さない | 状態遷移録画/時刻、両端末結果、revision。自然に再現不能な遅延競合はNOT RUNとしstaging/専用検証へ分離 |
| D10 / P8/P9b,W3; G15/G17 | 掲載地域で読込後offline→force quit→両app再起動→更新。別clean sessionはcacheなしoffline起動 | cacheは残り通信失敗と空領域を区別。cacheなしは利用可能データなし。offline徒歩経路を保証しない。Widgetは保存状態を読む | 読込時刻、offline/再起動録画、cache有無の別session記録 |
| D11 / W5,G4,WG3; G15 | WatchをiPhone/通信から切り離して1時間超→再表示。Widgetも鮮度を確認→再接続/更新 | 古さが表示され、古いfixから現在距離を装わない。復帰後に新snapshotとなる | 切断/再表示/再同期の実時刻と画像。時計を変更して実経過と偽らない |
| D12 / W5b,G3/G3b; G15 | 実公開データにexact/areaApproximate/unknownがあれば各app/Widgetで確認 | 目安/不明を正確pinとして扱わない。該当データがなければ未実施、架空地点を作らない | 該当実公開ID/precision、端末別画像。存在しないcaseはNOT RUN理由 |
| D13 / A1,A1W,P17,W9/W10; G18 | iPhone最大AX5、3段階sheet、keyboard表示で検索/追加/フォーム。VoiceOverで位置/写真/同意/送信/receipt、Watchのlist/detail/filterを順に操作。darkへ切替 | 欠け/到達不能/読み順不整合なし。44pt操作、error/stateが伝わる。写真privacy注意や停止状態も読める | 設定値、操作録画/音声、問題時画像、端末/OS。Appleのアクセシビリティ回答は実測範囲のみ |
| D14 / widgets tap; G15 | iPhone/Watch Widgetをtap、fresh/empty/staleで比較 | 対応app/地点へ遷移。無関係な位置権限promptなし。system更新遅延を計測 | tap録画、状態、実測更新時刻 |

D05/D06の写真処理は、Lane 3が既存sanitizer/retention検証と実環境証拠を対応させる。
撮影画面を見ただけでEXIF除去・削除完了・App Attest成功を認定しない。

## 2. ストア素材：撮る順序とファイル名

iPhone 16 Proのnative portrait **1206×2622**。Appleのmedium枠対応表を確認済み。
Watchは機種のnative寸法を実測して選ぶ（Series 9大ケースなら396×484）。全localeで同じWatch寸法にする。
JPEG/PNG、alphaなし。加工して別端末サイズを装わない。Widgetsは別ストア枠ではなくiPhone/Watchセット内の任意素材。
仕様：[Apple screenshot specifications](https://developer.apple.com/help/app-store-connect/reference/app-information/screenshot-specifications/)。

| 順序/ファイル名 | 撮影操作 | 選択条件・caption候補 |
| --- | --- | --- |
| I01-map.png | D03の公開mapでsheetを収納、地図creditが隠れない構図 | 「掲載地域の場所を確認」。当日公開ID/出典を記録 |
| I02-search.png | 「浅草駅 東京」の公的な目的地候補を表示 | 「目的地の周辺を検索」。候補施設そのものを喫煙所の証拠にしない |
| I03-select-directions.png | 公開地点を選択、利用条件/精度と案内actionを表示 | 「利用条件を確認して案内」。Maps別appの画面をMannerPathの画面にしない |
| I04-new-place.png | **本番有効化/規約承認後のみ**。実在・未掲載の許可された喫煙場所の申請を開き、pin/重複説明で停止 | 「場所を確認して申請」。未公開pinを公開地点と見せない。採用可否を判断する証拠がない場所は使わない |
| I05-photos.png | I04と同じ正当な申請で1〜3枚を選び、注意/審査用の説明を残す。マーケティング撮影だけの送信は不要 | 「写真は運営の審査用」。私的画像/顔/車番/ブランドなし。写真内容の利用許諾と公開素材利用の承認も必要 |
| I06-widget.png | D08成立後、専用Home ScreenでWidgetを撮影。私的icon/通知なし | 「保存済みの近くの場所を参照」。架空snapshot禁止 |
| W01-list.png | 実掲載地域のD08でWatchの受信済みlist/時刻を表示 | 「iPhoneから受信した近くの場所」。東京目的地検索だけで作らない |
| W02-detail.png | W01の同じ実公開地点detail | 鮮度・不明/目安・利用条件を残す |
| W03-widget.png | D08/D14成立後Smart Stackまたはcomplication表示 | 「保存した近くの場所をWatchでも確認」。私的活動/通知を含めない |

I04/I05の素材が揃わない間は空欄のまま。架空写真・fixture・stagingデータはストア素材に流用しない。
本番停止中のフォームをDebug overrideで開いた画像も使わない。素材未完成はG10をOPENに保つ。

iPhoneはside+volume up、Watchは設定でスクリーンショットを有効→side+Digital Crown。
元画像をprivateディレクトリへ保存し、`sips -g pixelWidth -g pixelHeight -g hasAlpha <file>` と
`shasum -a 256 <file>`でnative寸法/alpha/hashを記録。公開前にApple/provider credit、正確な日本語、
権利、個人情報、未知条件が消えていないことを運営者が確認する。iPhone16Proのraw画像はresizeしない。

既存 [capture manifest](../store-screenshots/capture-manifest.json) はbuild3の履歴で、新RCへ付け替えない。
公開地点sceneの新manifestを画像と同じprivate rootに作り、既存`validate-store-screenshots.py`で検査する。
I04/I05は公開spot IDを持たない申請画面なので**現validatorへ無関係IDを埋めて通さない**。
下の台帳で別管理し、運営者の画面/rights/privacy承認が揃うまで未承認とする。
技術PASSでも物理端末検証・権利承認・submissionReadyは付与されない。

## 3. 結果・素材記録（privateへコピーして記入）

| ID | 結果（初期値） | 実際の操作/期待との差・時刻 | 証拠ファイル/hash・公開ID/出典または申請scene | 運営者確認 |
| --- | --- | --- | --- | --- |
| D01 | NOT RUN | | | |
| D02 | NOT RUN | | | |
| D03 | NOT RUN | | | |
| D04 | NOT RUN | | | |
| D05 | NOT RUN | | | |
| D06 | NOT RUN | | | |
| D07 | NOT RUN | | | |
| D08 | NOT RUN | | | |
| D09 | NOT RUN | | | |
| D10 | NOT RUN | | | |
| D11 | NOT RUN | | | |
| D12 | NOT RUN | | | |
| D13 | NOT RUN | | | |
| D14 | NOT RUN | | | |
| I01 | NOT CAPTURED | | | |
| I02 | NOT CAPTURED | | | |
| I03 | NOT CAPTURED | | | |
| I04 | NOT CAPTURED | | | |
| I05 | NOT CAPTURED | | | |
| I06 | NOT CAPTURED | | | |
| W01 | NOT CAPTURED | | | |
| W02 | NOT CAPTURED | | | |
| W03 | NOT CAPTURED | | | |

PASSは該当RCで全期待を観測した場合のみ。FAILは原因・再現・担当を付す。部分確認はPARTIAL、
未実施はNOT RUN、依存待ちはBLOCKED。レポートID/写真/位置を含む証拠は非公開保存し、Gitには非個人的な参照だけ。
提出前にG5/G10の最終画像選択/権利、G14–G18/G21/G23の記録をcanonical Gateへ反映する。
