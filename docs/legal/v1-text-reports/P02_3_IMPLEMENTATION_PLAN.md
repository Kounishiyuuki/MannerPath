# P02-3 期限前最小化の実装計画（2026-11-23、**保留：法的確認の完了まで着手しない**）

対象は [P01_P02_DECISIONS.md §3](P01_P02_DECISIONS.md#3-p02-3-追加実装が必要な場合の最小修正案未実装法的確認の後に着手)。
技術調査（§3.1）はローカル合成DBでのみ確認した。**G23はOPEN。**
この計画は実装の承認ではない。§6 の相談結果によっては、範囲を変えるか、実装しないこともある。

## 1. 専用の追記型監査テーブル（REPORTS_DB migration 0012）

- `report_early_minimizations(operation_id PK, report_id, reason, decided_by, decided_at)`
  - `reason` は固定の区分（CHECK で `thirdPartyPersonalData` など、相談の結果で決める）。自由記述・本文・位置・hash は持たない。
  - `decided_by` の形式は `admin_review_audit` と同じ CHECK にする。
  - `report_id` は `reports` への外部キー（ON DELETE なし）。1件につき1行にする（UNIQUE）。
- `admin_review_audit` と同じ追記専用の trigger：INSERT OR REPLACE、UPDATE、DELETE をすべて ABORT する。
- rollback 用 SQL（`migrations-reports-rollback/0012_…`）を用意する。
  - 行がある場合は、記録を失わないよう rollback を拒否する。
- 既存の `admin_review_audit` は変更しない。

## 2. 最小化とreceipt退役の原子性

- `minimizeReportEarly(db, { reportId, reason, decidedBy, operationId, now })` を `src/reports/retention.ts` に追加する。
- 1つの `db.batch` に次の3つを入れる：
  1. 既存のNULL化 UPDATE（`WHERE report_id = ? AND redacted_at IS NULL`）
  2. `retireReceiptStatement`
  3. 監査表への INSERT
- 実行前に `redacted_at IS NULL` を読み、すでに最小化済みなら何もせず `alreadyMinimized` を返す（冪等）。
  - 同時に2回実行された場合は、2つ目の UPDATE が trigger で ABORT して batch 全体が戻る。この経路もテストする。
- 確認済み：SQLite アダプタ上での原子性（§3.1 Q3）。
- 未確認：Cloudflare D1 の batch がトランザクションであること。隔離 staging で確認する（P03 と同じ承認枠）。

## 3. 二重報告防止への影響

- 同じ下書きの再送は、receipt が `retired` になるため受付されない（§3.1 Q4 で確認）。既存の90日最小化と同じ挙動。
- 重複候補の検出からは外れる（`community-evidence.ts` `duplicateCandidates` の `redacted_at IS NULL`）。同じ場所への新しい申請は、この件との重複として示されなくなる。
  - 対応案は2つで、相談結果で選ぶ。
    - (a) 仕様として受け入れる：位置を消す以上、照合はできない。
    - (b) 最小化の前に、運営者が近くの未審査の申請を `erasure-impact` と triage で確認し、台帳に記録する。
  - コードは変えない。
- 送信回数の制限（`report_rate_windows`）は別の表で、影響しない（コード読み。実装時にテストで固定する）。

## 4. 独立報告者数への影響

- `spotEvidenceStates` は `submitter_hash` がNULLの申請を、独立した申請者として数えない。
  - 最小化した件は「申請としては数えるが、独立した申請者には数えない」状態になる。90日後と同じ扱い。
- 影響が出るのは、その件が鮮度期間内の根拠だった場合。地点の状態（矛盾の検出・掲載の判断）が変わり得る。
- 実装時のテスト：最小化の前後で `spotEvidenceStates` の結果がどう変わるかを固定する。
- 運営手順：変化がある場合は、公開中の地点を既存の事実再確認に回す。
- export 済みの根拠（DATA_DB）は変わらない。撤回は option 3 の範囲で、v1.0 では扱わない。

## 5. 失敗時の rollback とアクセス権限

| 場面 | 扱い |
| --- | --- |
| batch の途中で失敗 | 3つすべてが戻る。CLI はエラーを表示し、成功とは書かない（台帳にも未実施と記録） |
| 実行後に誤りに気づいた | **戻せない**（NULL化した内容は復元しない）。そのため実行前に `erasureImpact` の結果を表示し、report ID を再入力して確認する |
| migration 0012 の取り消し | 監査行がなければ rollback SQL。行があれば rollback しない |
| バックアップからの復元 | 古い履歴を戻すと最小化が取り消され得る（OPERATIONS §1-5）。復元後に監査表と `redacted_at` を照合する |

- **アクセス権限：** HTTP の入口は作らない。
  - 既存の `reports:moderate` CLI（`scripts/report-queue.ts`）に `minimize-early` を追加するだけにする。
  - remote の実行は既存の規則どおり：`--remote --env --database-id`、本番では確認文字列の入力、対話端末のみ、CI とエージェントは拒否。
  - これは `src/reports/moderation-target.ts` で担保する。
- **記録：**
  - DB：監査表に ID・区分・担当・日時だけを残す。
  - 台帳：問い合わせとの対応を残す（アクセス制限あり）。
  - Git・Issue・ログには本文や連絡先を書かない。

## 6. 専門家への相談事項（着手の前提）

相談先に渡す資料は [LEGAL_CONSULTATION_P02.md](LEGAL_CONSULTATION_P02.md)。

1. P02-2：アカウントがないため本人との関係を安全に確認できない。これを理由に開示・削除を断り、90日後の最小化を案内する対応でよいか。回答に何を書けばよいか。
2. P02-2：report ID や申請内容を知っていることを本人確認とみなさず、身分証も集めない方針でよいか。
3. P02-3：第三者の個人情報が含まれる申請を、請求者の確認なしに、運営者が内容に基づいて期限前に最小化する対応は適切か。
4. P02-3：実装が完了するまでの間、「利用を止め、準備ができたら消去する」という対応で足りるか。
5. 共通：最小化した後も、受付ID・分類・審査記録・バックアップが残ることは許されるか。規約での説明は必要か。
6. 共通：回答期限と、記録として残すべき内容は何か。

## 7. 着手の条件と PR の分け方（着手は保留）

着手の条件：§6 の 3・4・5 の回答、G23 の判断、P03 の staging 承認（D1 の原子性の確認用）。

実装開始時の必須確認事項：migration 0012 の rollback で「監査行があれば中止する」を、どの仕組みで保証するか（SQLファイル単体では条件付きで止められないため、例：rollback前に行数を確認する手順またはスクリプト）。決まるまで PR 1 を作らない。

| PR | 内容 | 検証 |
| --- | --- | --- |
| 1 | migration 0012 と rollback、`minimizeReportEarly`、テスト（§2〜4 の固定） | `make api-validate`、ローカルの migration 適用と rollback |
| 2 | `minimize-early` CLI、`erasureImpact` の事前表示 | ローカル合成DBでのリハーサル |
| 3 | 規約・P01_P02 §5 テンプレートD・OPERATIONS への反映 | P05 の整合確認 |

本番の migration 適用と実行は、それぞれ別の承認で行う。
