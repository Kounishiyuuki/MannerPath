# G23 P01〜P05 バックエンド担当への引き継ぎ（2026-11-23、未承認・未実施）

G23は**正式承認済みではない**（[PREP_1_0_8.md §7](../../release/submission-v1/text-reports/PREP_1_0_8.md#7-g23-テキスト申請規約124)）。
P0の定義は [Q2_PUBLICATION_P0.md](Q2_PUBLICATION_P0.md)、既存の手順と再利用できる証拠は [OPERATIONS.md](OPERATIONS.md) が正本。
この文書は担当の切り分けと、次に必要な許可だけをまとめる。ここに remote 実行・本番変更・送信の許可は含まれない。

## 前提（コードで確認済み、`main` `3749a56`）

- 最小化の閾値：`services/api/src/reports/create.ts:13` `REPORT_MINIMIZE_AFTER_DAYS = 90`
- NULL化する列：`services/api/src/reports/retention.ts:51-53`（`note`、`proposed_latitude/longitude`、`observed_on`、
  `submitter_hash`、`claim_host_name`、`claim_hours_note`）
- 起動条件：`services/api/src/scheduled.ts:8` `V1_RETENTION_CRON = "2-57/5 * * * *"`、`REPORT_RETENTION` の既定は `off`（`:26`）
- 配備設定：`services/api/wrangler.jsonc` は全環境 `"triggers": { "crons": [] }`（`:40`、`:67`、`:89`）。**最小化はどこでも動いていない**

## 担当の切り分け

| P0 | 決める人 | バックエンド担当の作業 | 必要な許可（未取得） | 閉じる証拠 |
| --- | --- | --- | --- | --- |
| P01 残存記録の根拠・期間 | 運営 | 台帳（[Q2_RETENTION_REGISTER.md](Q2_RETENTION_REGISTER.md)）の各区分について、期限・終了条件を実装・実行できるかの回答 | なし（読み取りのみ） | 区分ごとの「実行可能／実装が必要（範囲）」の回答 |
| P02 請求ケースの履行 | 運営 | 運営が決めたケースごとに、既存操作で履行できるかを合成DBで確認。できなければ限定修正の範囲を提示 | 修正が要る場合は別PRの承認 | ケース別の非本番リハーサル記録（OPERATIONS §0 の3ケースは実施済み、それ以外） |
| P03 実Cronの実行証拠 | 運用担当 | 隔離stagingで実Cron：期限前/後、23件超の複数pass、失敗→再実行、receipt退役、未実行検知、CPU/D1 read・write | **staging への配備と cron 有効化の承認**（[V1_RETENTION_CAPACITY.md §4](../../release/V1_RETENTION_CAPACITY.md)） | Worker SHA・環境・schema・実行時刻・集計・失敗復旧の記録。ローカルの成功では代用しない |
| P04 外部保存先の実態 | 各権限担当 | Cloudflare の実plan、console/error保持、account Logpush の有無・保存先・期限、copy/export。support mailboxは添付/転送/保管/削除のみ | 各アカウントの読み取り権限（設定変更なし） | 設定のGET結果・確認日時・責任者。403/接続不可は UNKNOWN のまま |
| P05 文面・RCの整合 | 運営＋Lane 1/4 | P01〜P04 の結論を反映した新version/hashを API config と iOS 同梱に揃える（[ACTIVATION_DIFF.md](ACTIVATION_DIFF.md)、PREP §8） | G23 正式承認後のみ | 同一bytes/hash、1.0 (9) の版、公開予定URLの照合 |

## 順序

1. P01・P02 の運営判断（バックエンドは実行可能性の回答だけ先行できる）
2. P03・P04 の証拠取得（それぞれ上の許可が出てから）
3. 結論が規約本文を変えるなら本文に反映 → G23 正式承認
4. P05：1.0 (9) の切替PR。本番の cron 有効化・デプロイ・受付開始は、さらに別の承認

## やらないこと

- production への配備、cron 有効化、`REPORT_RETENTION` の変更、受付状態の変更、課金plan の変更
- 規約・Web の公開（`site/` の merge は Pages が自動公開する）
- 本番 D1 の読み書き、ダミーの本番申請
