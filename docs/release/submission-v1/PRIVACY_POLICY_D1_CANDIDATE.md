# 写真申請：D1を採用する場合のprivacy policy候補（日英）

**未承認・非公開・本番実装を表さない。** [方式別評価](D1_PHOTO_PRIVACY.md)と一緒に審査する。
写真有効化時の説明候補。共通段落と削除variantのいずれかを最終実装に合わせて承認する。
未決の期限・鍵管理・法務判断が残る間は、公開site/規約/アプリに転記しない。
旧R2候補の「受信から90日以内に削除」をD1へ無条件で引き継ぐものではない。

## 日本語：共通段落候補

新しい喫煙場所の申請には、地図上で確認・確定した位置、申請内容、写真1〜3枚を送信します。
現在地を申請位置に使う場合も、自分で選択・確定します。写真のGPSなどのメタデータを除去しても、
確定した地図上の位置は申請と一緒に送信されます。人の顔や車のナンバーは自動で消えません。
写さないようにしてください。

写真は運営者の審査に使用し、一般の利用者向けのアプリ、Web、公開API、地図タイル、配布データでは公開しません。
写真の承認や申請受付だけで場所が地図に掲載されることはありません。確認された場所の情報が、別の審査と公開手続きを
通った場合に掲載されます。写真の保管・処理にはCloudflareのサービスを利用します。D1を採用する場合は、
写真データを非公開のデータベースに保存します。サービス提供・安全対策に伴う処理は委託先でも行われます。
「一般公開しない」ことは、保存・通信の委託先にも送信しないという意味ではありません。

申請と写真の送信にはAppleのApp Attestを利用します。アカウントはありませんが、端末のアプリinstallに
由来する認証情報と、そこから作る識別値を扱います。申請の個人情報を最小化するまで、同じinstallからの
申請と写真を関連付けることができます。申請内容の保持期間と認証鍵登録・不正対策記録の保持は別です。

写真、申請本文、選択した位置の通常利用を終了する期限、バックアップの扱い、必要な最小限の監査記録は、
採用方式に応じた下記説明を適用します。アプリを削除・再インストールしても、送信済みの情報の削除を
サーバーへ依頼したことにはなりません。端末内の送信待ち写真はアプリが永続保存しないため、再起動後は再選択が必要です。
端末の写真ライブラリの元画像をMannerPathが削除するものではありません。

## 日本語：削除variant（いずれも採用・期限承認前）

### A. SQL削除・最小化を使う場合

期限に達した写真は現在のデータベースから削除または利用できない状態にし、申請本文や位置などの個人情報は
削除・最小化します。これは通常のアプリや審査で使うデータへの処理です。Cloudflare D1の復元用履歴や、
別途管理するバックアップには、処理前の情報が一定期間残る場合があります。履歴がある間は過去状態を復元できる
可能性があるため、SQL上の削除を、直ちに全コピーが復元不能になることや媒体からの物理的消去とは説明しません。

**公開前の必須確定値（利用者向け本文ではない）**：report受信を起点とした写真/本文/pin別の通常利用終了期限、
最小化完了期限、Free/Paidに応じた復元窓、operator exports/preview/copiesの上限とrestore時の再適用手順。
D1公式窓はFree 7日/Paid 30日だが、実配備のplan確認が必要。期限が決まるまでこのvariantを公開しない。

### B. 追加暗号化と鍵破棄を使う場合

写真を追加の暗号化で保存する方式を採用した場合、期限には通常の閲覧を停止し、復号に必要な秘密情報を破棄して、
対象の暗号文を復号できない状態にします。この説明は、復号に必要なすべての鍵のコピーや再導出経路を対象にした
処理が検証された範囲に限ります。暗号文がデータベース履歴に残ることと、内容を復号できることは別です。
鍵破棄は、暗号文がすべての物理媒体から消去されたという意味ではありません。暗号化されていない本文・位置や
別途保存した平文には、この説明は適用されません。

**公開前の必須証拠（利用者向け本文ではない）**：対象データ/鍵単位、全秘密情報copy・backup・再導出経路の破棄、
report期限とepoch期限/late uploadの整合、失敗時の回復と監視、復元しても再び読めないこと。
Workerで平文を受信する案をE2EEや「Cloudflareが一切平文を受信しない」と説明しない。
この証拠と期限が揃うまで「復号できない状態にします」を公開しない。

## English: common candidate

A new-place proposal includes a map position you choose and confirm, report details and 1–3 photos.
Using your current location as the proposal pin also requires your explicit selection and confirmation.
Removing GPS metadata from a photo does not remove the confirmed map pin sent with the report.
Faces and vehicle plates are not automatically removed. Please keep them out of your photos.

Photos are private review evidence. They are not published in the public app, website, API, map tiles or data
exports. Receiving a report or approving a photo does not publish a place. Only reviewed place facts may proceed
through the separate publication checks. We use Cloudflare services to process and store submissions. If D1 is
adopted, photo data is stored in a private database. Our service providers also process information to provide
and secure these services. Keeping photos out of public view does not mean they are never sent to processors.

Submission uses Apple App Attest. There is no account, but we handle app-install-derived authentication information
and derived identifiers. Reports and photos from the same install can be associated until the report's personal
content is minimized. Authentication registrations and abuse-prevention records have separate retention rules.

The adopted deletion explanation below governs operational access deadlines, backup handling and the minimal
audit records retained. Uninstalling or reinstalling the app does not request server-side deletion of previously
submitted information. The app does not persist pending photo bytes, so photos must be selected again after a
restart. MannerPath does not delete the original images in your device's photo library.

## English: deletion variants — neither approved for publication

### A. SQL deletion and minimization

At the applicable deadline, photos are removed or made unavailable in the current database, and personal report
fields such as notes and the chosen pin are deleted or minimized. This affects the operational data used by the
app and reviewers. Pre-deletion information may remain for a period in Cloudflare D1 recovery history or separately
managed backups. While history exists, restoring an older state may be possible. SQL deletion does not mean every
copy immediately becomes unrecoverable or is physically erased from storage media.

Before publication, the owner must set separate access/minimization deadlines for photos, notes and pins,
confirm the deployed recovery window and copy/export retention, and approve restore safeguards. No final
retention period is chosen by this candidate.

### B. Additional encryption and key destruction

If additional photo encryption is adopted, we stop normal access at the deadline and destroy the secret material
needed to decrypt the affected ciphertext. This description applies only to the scope where destruction of all
required key copies and re-derivation paths has been verified. Ciphertext remaining in database history is separate
from whether it can be decrypted. Key destruction does not mean all ciphertext has been physically erased from
all media. This statement does not cover unencrypted report notes, pins or separately saved plaintext.

Before publication, prove key scope, destruction of every necessary secret copy and backup, report/epoch deadline
alignment, late-upload handling, failure monitoring and inability to decrypt after a restore. A design that receives
plaintext in a Worker must not be described as end-to-end encrypted or as never exposing plaintext to Cloudflare.
Do not publish the key-destruction promise until these conditions and deadlines are verified and approved.
