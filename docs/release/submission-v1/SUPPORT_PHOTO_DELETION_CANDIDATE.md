# 写真の削除依頼・再インストール：support回答候補

**未承認・未公開。** ADR-0021の本人確認/早期最小化endpointは未実装。
新機能、受付期限、完全削除や法的権利の充足を約束しない。運営者/法務が最終手順を決める。

## 利用者へ案内する候補（日本語）

写真や申請内容の取扱いについては、サポート窓口へお問い合わせください。
受付時の報告IDが分かる場合は、問い合わせに添えてください。報告IDは公開SNSに載せないでください。
報告IDだけでは、ご本人の申請であることを確認できない場合があります。申請した端末でアプリを引き続き
利用できるか、再インストールや機種変更をしたかもお知らせください。

アプリの削除・再インストールや機種変更は、送信済み情報の削除や送信取消にはなりません。
元のinstallの認証情報を利用できなくなることがあり、以前の申請への写真追加、受付情報の復元、
本人確認を伴う操作ができない場合があります。新しいinstallから同じ申請を送り直さず、まずお問い合わせください。
報告IDがあっても、必ず復元・写真再送・削除ができるとは限りません。

鍵や認証データ、本人確認書類、問題の写真そのものをメールで送る必要はありません。
運営者が必要な確認と実施可能な対応を案内します。個人情報が写っている懸念は、その内容を写真を再添付せずに
説明してください。確認の結果と、通常利用の停止・削除/最小化・復号不能化のどの処理を行ったかは区別してお伝えします。
過去の履歴やバックアップ、公開済みの場所情報への影響は、採用された方式と審査状況により異なります。
この問い合わせを送っただけで、即時の物理消去や公開情報の撤回が完了したことにはなりません。

## English candidate

Contact support about the handling of your photos or report. Include the received report ID if available, but do
not post it publicly. A report ID alone may not establish that the report is yours. Tell us whether you still have
the submitting app install, or have reinstalled, restored or changed devices.

Uninstalling, reinstalling or changing devices does not delete or withdraw information already submitted.
The original install's authentication material may no longer be available. Adding photos to an old report,
restoring its receipt or proving ownership may then be unavailable. Please contact support before sending the
same proposal again. Knowing a report ID does not guarantee restoration, photo retry or deletion.

Do not email keys, authentication material, identity documents or the photo itself. Describe a privacy concern
without reattaching the image. We will explain the necessary checks and available action, distinguishing stopped
access, deletion/minimization and verified cryptographic erasure. Effects on history, backups and published place
facts depend on the adopted implementation and review state. Sending an inquiry is not confirmation of immediate
physical erasure or withdrawal of published information.

## 運営者が処理前に確認する項目

1. 正式な窓口と担当・回答期限を承認する。問い合わせはGmailに保持されるためsupportのPrivacy回答も対象。
2. report IDだけで所有権を認めない。元installのApp Attest等の確認方法はLane 3の方式/承認/実装待ち。
   メール本人確認だけでinstall所有者と結び付けない。新しいinstallのkeyを元installの証明としない。
3. 本人確認不能を理由に法的な請求や第三者のprivacyリスクを一律に拒否する文面にしない。
   利用停止/審査保留などの安全対応と、所有者としての削除権行使を分け、運営者/法務へエスカレーション。
4. 実行したデータ範囲・処理種別・時刻/結果を確認して回答する。SQL成功を「全履歴/全媒体消去済み」としない。
   本文/pin・写真・認証登録・audit・公開済みfactの各影響を分ける。削除証拠そのものに平文/鍵を残さない。
5. 未提供のアプリ内削除ボタン、即時完全削除、再インストール後の復旧、90日の物理消去を案内しない。
   期限は最終承認policyのものだけを使う。現在の候補ではまだ数値を確定していない。
