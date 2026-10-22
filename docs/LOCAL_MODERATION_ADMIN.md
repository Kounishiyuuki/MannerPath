# MannerPath Admin (local operator tool)

This is a loopback-only review tool, not a deployed admin service. Approval never publishes a
spot or photograph. Production operation and the staging end-to-end launch gate remain unverified.

## Start with synthetic data

Use Node 24 or later. From `services/api`:

```sh
npm ci --ignore-scripts
npm run reports:admin -- --demo
```

Enter a 24–256 character passphrase at the hidden terminal prompt, then open
`http://127.0.0.1:4318`. Enter the same passphrase in the login form. Demo mode creates three
synthetic reports and two generated PNGs in memory; stopping the process discards them. No
Cloudflare connection, real report, or real photo is used. `--port 4319` changes the loopback port;
there is deliberately no host option. Do not reverse-proxy, tunnel, or expose this service.

`MANNERPATH_ADMIN_TOKEN` can supply the passphrase for a controlled launcher; it is removed from
the environment before Cloudflare tooling starts. Do not put it in shell history, a URL, or a file.
Login sessions expire after eight hours. Restarting invalidates every session and confirmation.

## Review workflow

1. Choose a queue and a report. The detail includes the proposed location, conditions, hours,
   description, duplicate candidates, photo states, and this tool's decision history.
2. Photos are private authenticated previews, not public URLs. Missing, unfinished, rejected,
   expired, deleted, and unavailable photos are distinguished. Check faces, plates and other
   sensitive content before approving each pending photo. Approval is not an automatic redaction.
3. The map is loaded **only** after checking the disclosure consent and clicking its display button.
   This sends the proposed coordinates and the browser's IP to OpenStreetMap. Do not load it if
   this disclosure is inappropriate. Photos and notes are not sent to the map service.
4. Choose the existing bounded reason code, then approve, hold, reject, or mark duplicate. Review
   the confirmation dialog before applying. A report without an approved available photo cannot
   be approved here. Version checks reject stale decisions; repeated clicks do not duplicate history.
5. Reload to verify the state. Accepted reports awaiting reconciliation appear in publication waiting.
   `applied` means an artifact has been exported, **not** that a release is publicly active. Published
   status is shown as unverified: this tool does not query production tiles or assert publication.

History is append-only bounded metadata (migration `0008_admin_review_audit.sql`), without notes,
coordinates, photo keys, or submitter identifiers. Existing CLI decisions are not retroactively
invented as history. Retention/minimization and the photo deletion queue remain authoritative.

## Macでの画面受入確認（ブラウザー未確認）

現在の自動検証はHTTP・審査ロジック・日本語メッセージの検証です。実ブラウザーでのクリック、
ライト／ダーク／狭いウィンドウの表示、スクリーンショット確認は未完了です。CSS対応を追加しても
視覚検証済みとは扱いません。P0公開ゲート修正はLane 3の別作業で、この手順では公開しません。

1. MacのターミナルでNode 24以上を選択し、次を実行します。`--demo`を必ず付けます。

   ```sh
   cd /private/tmp/mannerpath-report-moderation-admin/services/api
   npm run reports:admin -- --demo
   ```

   起動できない場合は`node --version`を確認してください。依存が未導入なら同じディレクトリで
   `npm ci --ignore-scripts`を実行します。24〜256文字の任意のパスフレーズを非表示プロンプトへ
   入力します。URLにパスフレーズを書かず、本番用のものを流用しません。
2. Safariまたは普段使うブラウザーで`http://127.0.0.1:4318`を開き、同じパスフレーズでログイン。
   別のプライベートウィンドウで`http://127.0.0.1:4318/api/reports`を開くと、未認証で拒否される
   ことも確認します。ポート使用中なら`--port 4319`を追加し、URLのポートも変更します。
3. 「審査待ち」が3件で、新しい順に並ぶことを確認。「駅前の指定喫煙所」を選び、位置・条件・
   説明と合成写真が同じ詳細画面にあることを確認します。写真は実在地点の証拠ではありません。
   外部地図は位置送信への同意チェックと表示ボタンを押すまで読み込まれません。
4. 写真の確認欄をチェックし、「写真を承認」→日本語の確認ダイアログ→「確認して保存」。
   次に投稿の確認欄をチェックして「承認」→確認して保存。「承認済み」「公開待ち」が各1件に
   なり、履歴が残ることを確認します。公開済みとは表示されず、公開操作もありません。
5. 「施設内の喫煙室」を「保留」、「写真アップロード未完了」を「却下」にし、それぞれ確認して
   保存します。「再読み込み」後も状態・件数・履歴が一致することを確認します。
6. 投稿または写真の未チェック承認、確認ダイアログのキャンセル、パスフレーズの入力間違いも
   試し、日本語の説明が分かり、意図しない操作が保存されないことを確認します。
7. macOSの外観をライト／ダークに切り替え、両方で文字・選択状態・ボタン・確認ダイアログが
   読めるか確認します。ウィンドウ幅を390px程度、可能なら320px程度まで狭め、縦スクロールで
   すべての操作へ到達できるか、入力欄や長いIDで全体が横にはみ出さないか確認します。
   状態タブ列だけの横スクロールは意図した動作です。Tabキーでも各操作へ移動してください。
8. ダミーデータだけを使い、ライト／ダークの詳細、狭い表示、確認ダイアログ、状態更新後を
   スクリーンショットに記録し、欠け・重なり・読めない文字がないか確認します。パスフレーズは
   撮影せず、実投稿の写真は撮影・共有しません。確認後はターミナルでCtrl+Cを押して終了します。

demoを再起動すると操作結果は消えて3件の初期状態に戻ります。見た目・操作結果を確認して初めて
この受入確認を完了にできます。現時点ではDraft解除・mainへのmergeを行いません。

## Preparing a real store (maintainer only; not performed by development)

The real reader targets the existing `REPORTS_DB` and an explicitly named existing **private** R2
bucket. No resource is created and no Worker is deployed. Confirm Lane 4 / PR #316 integration and
its private bucket, upload path, deletion job, and recovery fences before enabling production use.
PR #316 and #317 are merged, but merging alone does not prove the deployed infrastructure is ready.

Apply the report migration stream through the existing maintainer procedure, including migration
0008 (admin audit) and 0009 (new-spot photo export gate), to the report store only. Never apply
this stream to canonical `DB`. Run retention and resolve outstanding deletion work before review.
The launcher fails closed on missing report-store identity or audit schema.

Local store inspection uses `npm run reports:admin` after the existing local migration commands.
It is read-only without a private photo reader. Remote startup requires a real interactive terminal,
outside CI, and all existing `moderationTarget` acknowledgements. For example, substituting actual
existing staging identifiers (do not copy placeholders as real values):

```sh
npm run reports:admin -- --remote --env staging --database-id EXISTING_REPORTS_DB_UUID --private-photo-bucket EXISTING_PRIVATE_BUCKET --actor operator
```

This is read-only by default. `--enable-decisions` explicitly authorizes moderation writes for that
session, and requires a photo reader. Production additionally requires
`--confirm-production mannerpath-production-reports`. These flags do not waive any operational
approval, credential, retention, or publication gate. Do not run remote commands as a development test.
Only `REPORTS_DB` and the optional private photo binding are remote; duplicate lookup uses a local
canonical snapshot and is labeled unavailable when that snapshot is absent.

Photo reads use bounded R2 streams, validate PNG signature, size and digest, and recheck expiry,
parent retention and deletion fences after the read. Photos stay in server/browser memory only;
responses are no-store and previews are revoked on selection/session/expiry changes. No raw image,
photo key, passphrase, token, request body, or unfiltered exception is logged. This does not protect
against a compromised operator Mac, browser extensions, or manually saving a displayed image.

### PR #322 integration and early-erasure finding

The merged photo gate is preserved at review proposal/export and by migration 0009. Approving a photo
or report in Admin does not run any of these operations, change canonical data, or publish a place.
Admin viewing and approval stop at `delete_after - 24 hours`, exactly when R2 access stops and cleanup
starts; the UI labels that viewing/review deadline separately from the 90-day retention ceiling.
Checks run before and after the private read and inside the decision transaction, even if cleanup
has not run. Zero/pending/rejected/expired photos cannot satisfy Admin's new-report approval check.

**Integration HOLD:** the merged `newSpotPhotoGate` and SQL trigger 0009 still compare against
`delete_after`, not its 24-hour early-erasure boundary. Before cleanup, a ready approved photo can
therefore pass the manual publication gate during a window when R2 already refuses it. They also
omit the queued-deletion fence. Admin's stricter checks do not fix a previously accepted report used
later by the CLI. A separate publication-gate fix PR is required before enabling that workflow:
align proposal/export with early erasure and deletion fences, add a new additive migration to replace
the trigger (never rewrite applied 0009), and test the exact boundary, delayed cleanup, direct SQL export
and mixed-photo cases. This Admin PR deliberately does not change the merged publication policy/trigger.

## Manual publication remains separate

Use the existing `reports:moderate` CLI and the reviewed steps in
[OPERATIONS](OPERATIONS.md), [ADR-0014](adr/0014-durable-community-report-store.md), and the
[community launch checklist](COMMUNITY_LAUNCH_CHECKLIST.md): inspect duplicates and evidence,
queue accepted findings, create/review the reconciliation proposal, export its sanitized artifact,
import that artifact into the **local** canonical pipeline, run quality and release verification,
then use the existing gated promotion procedure. Consult the command documentation at the top of
`services/api/scripts/report-queue.ts` and the API README for exact command arguments.
The community activation/legal decision remains required. No direct canonical D1 INSERT is allowed.
Raw photos, submitter information and private notes never belong in the artifact or public tiles.

## Safety and validation

The server binds only `127.0.0.1`, checks peer/Host/Origin, requires a same-site HttpOnly login cookie
and CSRF token, validates strict bounded JSON, and uses short-lived single-use decision confirmations.
Do not treat loopback as a replacement for these controls. Keep the process stopped when not reviewing.

Development tests use real SQLite migrations with dummy data and in-memory PNGs. Run
`make api-validate`, `make contract`, and `make security-validate` with Node 24. Real R2 connectivity,
real staging E2E, retention scheduling and production readiness require separate maintainer evidence.
