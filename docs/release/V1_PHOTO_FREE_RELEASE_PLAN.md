# v1.0 写真なしリリース計画と無料構成の最終NO-GO（Lane 3 / 2026-11-01）

Status: **計画（2026-11-01）。§3–§7 は 2026-11-02 の正式決定で一部置き換え済み。** この文書はコード、Cloudflare資源、
本番設定を変えない。main `615b760` 時点で調査。

> **正式決定（2026-11-02）：B案を採用。** v1.0では新規地点を写真なしで受け付け、写真1〜3枚付き申請はv1.1で追加する。
> 本文中の「推奨：A」は決定前の分析として残すが、採用されていない。承認条件は §3 の「Bの安全条件」のとおり、
> 運営者が記録した独立確認（公式情報源または現地確認）で `approvedPhotoRequired` を置き換える。実装・API契約・計測・
> 有効化手順は `V1_PHOTO_FREE_NEW_SPOT.md`（別PR）を正とする。§4 の A向けタスク（P3の入口非表示など）は実施しない。

## 1. 最終NO-GO：Workers Freeでの写真付き申請

| 構成 | 検証 | Workers Free実測（CPU/要求、合格条件 P99 ≤ 8 ms・exceededCpu 0） | 判定 |
| --- | --- | --- | --- |
| F1 現行v3（1要求でApp Attest＋写真、D1 BLOB） | PR #363 / #364 | 26–184 ms。D1バインディングのBLOB変換（`Array.from`＋`JSON.stringify`）が支配的 | NO-GO |
| 3 D1写真ストア＋hex転送 | PR #364 / #365 | 11–49 ms | NO-GO |
| A1 KV＋2段階（①intent／②upload） | PR #369 | ① P99 9–11 ms、② P99 18 ms | NO-GO |
| A1 D1往復15→7回 | PR #370 | ① P99 7 ms、② P50 10 / P99 13 ms、20回中19回が8 ms超 | **NO-GO（最終）** |

- D1往復1回 ≈ 0.6–0.7 ms CPU（`/probe/d1-trips`、n=0/4/8/16）。②に残る往復はチケット確保・フェンス再確認・
  メタデータ確認という安全上必要なもので、本番構成でも ≈ 8–9 ms と見込まれ、基準内に安定させられない。
- 同じ方向（構成3・A1）のCPU最適化はここで終了する。写真を受け付ける残りの選択肢は Workers Paid（USD 5/月、
  未承認）のみ。月額追加費用0円を守る限り、v1.0で写真は受け付けない。
- どの構成も強制終了（exceededCpu）は0件だったが、Freeの10 msを常時超える経路は本番で採用しない。

### PoCの位置づけ（誤認防止）

PoCコードはどれも本番APIにマウントされておらず、採用されていない。`src/poc/binary-photo/`（main上）と
`src/poc/kv-photo/`（#369/#370のみ）は検証専用。`V1_FREE_TIER_ARCHITECTURE.md` の「構成3を評価推奨」は評価の結果
NO-GOになった（同文書冒頭に注記）。

### PR の依存関係（2026-11-01、すべてOPEN・CI pass・main未merge）

```
main ← #363 docs: free-tier probe results ← #364 poc: stages + hex ← #365 docs: final evaluation
main ← #369 poc: A1 KV two-step ← #370 poc: A1 round trips 15→7 + measured NO-GO
```

推奨：記録として残す価値があるのは文書（#363・#365、#369/#370の `V1_KV_PHOTO_A1_POC.md`）。PoCコード（#364・#369・
#370の `src/poc/`・probeスクリプト）は main に入れず、ブランチのまま閉じるか、文書だけを抜き出したPRに置き換える。
mergeするかは運営者判断（要確認）。

### 未解決のまま記録する事項

| 項目 | 状態 |
| --- | --- |
| KV削除 | 削除直後・約25秒後に同一拠点で値なしを確認。他拠点への伝搬時間はCloudflare文書に記載なし。物理消去は約束できない |
| Time Travel | D1を巻き戻すと5分以内の未使用チケットが復活し得る。`VOID_ISSUED_TICKETS_AFTER_RESTORE` を復元直後に実行する手順が必要（ローカル検証のみ、実復元は未実施） |
| KV書き込み計数 | KV.put成功後にD1が失敗して再試行すると、実書き込みが日次カウント（800）を超え得る |
| 秘密情報管理 | probe Secretは毎回再生成し、値を表示せずファイル経由で登録・削除した。最初のA1実行分は、削除前に値の全体検索をしていない（漏えいの証拠もない）。probe Workerはすべて削除済み |
| 検証用資源 | probe D1 2つとKV namespace `mannerpath-free-tier-probe-photo-kv`（合成データ、90日で失効）が残存。削除は運営者判断 |

## 2. 現在のmainの挙動（写真が無効のとき）

- API: `photoIntakePolicy` が無効なら `/v1/reports/{id}/photos` は503、`/v1/config` は `photoEvidenceEnabled:false`。
  本番は `reports.available:false`、App Attestの鍵登録は `REPORT_REGISTRATION: paused`（`wrangler.jsonc`）。
- 審査: `admin-review.ts:91` が、承認済み写真のない新規地点（`report_type='missing'`）の accept を拒否する
  （`approvedPhotoRequired`）。写真なしの新規地点は**承認できない**設計。
- iPhone: `ReportModel.acceptsNewSpotProposals` が写真受付とレビュー済み写真規約の両方を要求し、満たさないと
  新規地点を送信しない（`ReportModel.swift:76–108, 318–327`）。ただし地図の「＋ 喫煙所を追加」ボタンは常に表示され、
  無効時は「New place submissions paused」と表示する（`ContentView.swift:373`）。

つまり、写真なしで出すと「常に一時停止中の機能」が画面に残る。App Reviewでは未完成機能（Guideline 2.1）と
見られるおそれがある（推測、未確認）。

## 3. 比較：写真なし申請を受け付けるか、地点申請を延期するか

| 観点 | A. 新規地点申請をv1.0では延期（推奨） | B. 写真なしで新規地点申請を受け付ける |
| --- | --- | --- |
| iPhone UI | 「＋」ボタンと空状態の誘導を、受付不可の間は表示しない | 写真ステップを外す。「写真が必要」の文言と検証を変更 |
| 入力バリデーション | 変更なし（送信経路に到達しない） | 写真必須チェックを外し、代わりの必須項目が必要 |
| 審査基準 | 変更なし | `approvedPhotoRequired` を外す必要がある。代わりに、公式ソースまたは運営者の現地確認を承認の必須条件にしなければ、審査品質が下がる |
| API受付 | 変更なし（本番は reports off のまま） | reports を本番で有効化（鍵登録再開、レート制限、日次上限） |
| App Attest | 使わない（受付なし） | 必須。ただし edge のIPレート制限ルールにはカスタムドメインのzoneが必要（未確認） |
| 運営者レビュー | 不要 | 写真なしの主張を検証する手順と人手が必要 |
| Privacy Policy | 現行（2026-10-15）のまま | 申請データ・端末鍵由来IDの記載を追加 |
| App Privacy | 「無効時の構成」（入口シート §0.2）で回答 | Other User Content＋Device ID（linked）＋Precise Location を追加 |
| 利用規約 | 申請規約は不要 | 申請規約の法務承認（#124 の写真以外の部分）が必要 |
| App Store審査説明 | 「申請機能なし」で簡潔 | UGCのモデレーション説明、年齢区分の再評価 |
| 新たなP0 | なし。G23は「v1.0対象外」で閉じられる | 規約・審査手順・プライバシー表示・本番有効化・実機E2E |
| セキュリティ／品質 | 弱めない | 写真という証拠がなくなる分を、別の検証で補わない限り弱まる |

**決定前の推奨：A。運営者は 2026-11-02 に B を正式採用した（冒頭の注記）。**
理由：月額0円・コード変更最小・審査品質を弱めない・P0が増えない。Bは「写真の代わりの証拠」を承認条件に入れない限り
`approvedPhotoRequired` を外すことになり、今回の禁止事項（審査品質を弱めない）に反する。

Bを将来採る場合の安全条件（すべて必須）：
1. 写真なしの新規地点は「情報提供（tip）」として保存し、承認には運営者が記録した独立の根拠（公式ソースURLの確認、
   または現地確認）を必須にする。`approvedPhotoRequired` の代替ガードをサーバー側に置いてから外す。
2. App Attest必須、鍵ごと・日ごとの申請上限、鍵登録の上限を維持する。
3. 申請規約とプライバシー表示（G2/G3/G6/G23相当）の承認を、有効化より前に得る。
4. 本番有効化は別承認。staging E2E と実機の Release build での証拠を取ってから行う。

## 4. 実装タスク（A：延期）とPR分割 — B採用により不採用（記録として残す）

| # | 範囲 | 内容 | 担当 | 状態 |
| --- | --- | --- | --- | --- |
| P1 | 文書 | この計画と、無料構成NO-GOの記録（本PR） | Lane 3 | 本PR |
| P2 | 文書（運営者決定後） | `V1_APP_STORE_RELEASE_GATE.md` §1 のスコープを変更（写真P0→v1.1）、G23を「v1.0対象外」で閉じる、G2/G3/G6/G8/G12を「申請なし」の構成で確定 | Lane 3/4 | 運営者決定待ち |
| P3 | iOS（Lane 1） | 受付不可（`acceptsNewSpotProposals == false`）の間は「＋」地図ボタン・シートのバー・空状態の誘導を表示しない。既存の fail-closed（送信しない）はそのまま。UIテストで非表示を固定 | Lane 1 | **未着手（Lane 1の編集範囲）** |
| P4 | API | コード変更なし。本番が `reports.available:false`・`photoEvidenceEnabled:false` のままであることを提出日に読み取りで記録（G16） | 運営者 | 提出日 |
| P5 | ストア文言 | 説明・Review Notes・スクリーンショットから申請機能の記述を除く（「無効時」の文言は final-assets にある） | Lane 4 | P2の後 |

本番コードの写真必須仕様、`approvedPhotoRequired`、`REVIEWED_PHOTO_TERMS`、Worker設定は変更しない。

## 5. 残すPoCの範囲

- main上：`src/poc/binary-photo/`（未マウント）と `V1_BINARY_PHOTO_D1_POC.md`・`V1_FREE_TIER_ARCHITECTURE.md` は残す
  （NO-GOの根拠として）。
- ブランチのみ：`src/poc/free-tier-probe/` の段階計測（#364）、`src/poc/kv-photo/`（#369/#370）。v1.1で写真を再検討する
  ときの参照用。main には入れない（推奨）。
- 写真の本番経路（R2アダプター、v3ルート、iOSの写真UI）は main にあり、無効のまま残す。v1.1で再利用できる。

## 6. App Store提出までの残りP0（A採用時の分析。B採用後は `V1_PHOTO_FREE_NEW_SPOT.md` §6 を参照）

`V1_APP_STORE_RELEASE_GATE.md` の G1–G23 はすべてOPEN。A採用で変わるのは次の点：

- G23（写真規約）：v1.0対象外として閉じられる（運営者のスコープ決定が前提）。
- G2/G3/G6/G8/G12：「申請・写真なし」の構成で確定できる。写真有効版の回答案は使わない。
- G16/G17：写真有効時のRC証拠は不要になり、無効時の実行時設定の記録と、P3の非表示の実機確認が必要になる。

変わらず残るP0：G1 ASC項目、G5 コンテンツ権利、G7 輸出規制、G10 スクリーンショット、G11 連絡先、G14 署名とApp
Group、G15 Watch/ウィジェット実機、G19 公開データ品質、G21 提出ビルド。

## 7. Lane 1への引き継ぎ（A案向け。B採用により `V1_PHOTO_FREE_NEW_SPOT.md` §7 に置き換え）

- 依頼（P3）：受付不可の間、「＋ 喫煙所を追加」（`mapReportButton`・`sheetReportButton`）と空状態の誘導を出さない。
  文言「New place submissions paused」は表示しない方向。送信側の fail-closed（`ReportModel.swift:318–327`）は残す。
- 触らないこと：写真UI・`ReportPhotos.swift` の規約リスト・App Attestのアップローダー（v1.1で再利用）。
- 確認：変更後の build で、地図・シート・空状態のどこにも申請入口がないことを実機で確認し、G17の行に記録。
- 開始条件：運営者がスコープ変更（写真P0→v1.1）を決定してから。Lane 3からはiOSを変更していない。
