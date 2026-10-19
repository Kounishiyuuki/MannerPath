# App Store Connect entry sheet — MannerPath v1.0

What to type into App Store Connect (ASC), in order, and what cannot be typed yet. Rationale, Apple references and
evidence live in [APP_STORE_SUBMISSION.md](APP_STORE_SUBMISSION.md) (§ numbers below point there); privacy
evidence classifications are owned by [PRODUCTION_PRIVACY_AUDIT.md](PRODUCTION_PRIVACY_AUDIT.md) (#178/#185).
The final conservative ASC input proposal is in [submission §2.2](APP_STORE_SUBMISSION.md),
not a claim that all proposed collection was observed. Privacy entry updated 2026-10-05 against main
`cb8de215e55897a6315a7d38a59cf4886505c5e7` (#185/#186); older build/metadata evidence remains dated below.
This sheet authorizes no submission, deployment or Cloudflare change.

Status legend:

| Status | Meaning |
| --- | --- |
| **CONFIRMED** | Final value, verified against the repository/build settings or published pages; type it as written |
| **MAINTAINER** | Personal/legal input only the maintainer can supply; nothing is invented here |
| **WAITING-PRODUCTION** | Needs release-build/provider evidence; backend deployment/runtime evidence now exists (#185), but signed-build and provider-retention checks remain |
| **BLOCKED-DEVELOPER-PROGRAM** | Needs the paid membership, signing, a signed archive, TestFlight or physical devices |

## 0. v1.0 最終入力チェック表（日本語・2026-10-15）

（2026-10-19 更新：東京重点対応へ変更。513 地点の凍結は撤回し、掲載範囲は [東京リリース計画](release/V1_TOKYO_RELEASE_PLAN.md) と G19 で決める。下の文面は本番の 513 地点に合わせたままで、掲載範囲が決まったら更新する。）旧方針：本番 6 ソース / 513 地点の掲載地域限定、日本のみ、無料、Apple 標準 EULA の方向、投稿・写真・App Attest 登録は無効。
**ASC の画面はこのリポジトリ作業では見ていません。** 下表の「状態」は入力値の準備状況であり、ASC 入力済みを意味しません。
入力済みかどうかは ASC で確認し、入力済みの項目は再入力しないでください。個人情報（氏名・電話番号）はここに書きません。

### 0.1 ASC 入力値

| 項目 | 入力値 | 状態 |
| --- | --- | --- |
| アプリ名 / サブタイトル | `MannerPath` / `喫煙可能場所と利用条件を確認` | 値確定 |
| プライマリ言語 | 日本語 | 値確定 |
| カテゴリ | ナビゲーション（主）、ユーティリティ（副） | 値確定 |
| SKU | 任意の固定文字列（例 `mannerpath-ios-1`、利用者には非表示） | **MAINTAINER 入力** |
| 著作権 | 候補 `2026 MannerPath 運営`（法的な権利者名をメンテナーが確定） | **MAINTAINER 確定** |
| サポート URL | `https://kounishiyuuki.github.io/MannerPath/support/` | 値確定（公開済み） |
| プライバシーポリシー URL | `https://kounishiyuuki.github.io/MannerPath/privacy/` | 値確定（公開済み、内容修正案は §0.3） |
| マーケティング URL | 空欄 | 値確定 |
| 使用許諾 | Apple 標準 EULA | 方針確定、ASC で既定のままか確認 |
| 価格 / 配信地域 | 無料 / 日本のみ | 方針確定 |
| 審査担当の連絡先 | 氏名・電話（国際形式）・メール | **MAINTAINER 入力（Git に記録しない）** |
| サインイン必要 | いいえ | 値確定 |
| 審査メモ | §5（英語、最終案） | **MAINTAINER 承認** |
| 公開方法 | 手動公開 | 値確定 |

### 0.2 App Privacy 推奨回答（Apple の現行定義に基づく、2026-10-15）

**メンテナー未承認の推奨案。ASC 入力は承認後。** [submission §2.2](APP_STORE_SUBMISSION.md) の「7 項目すべて申告」案を置き換える。
Apple 定義（[App privacy details](https://developer.apple.com/app-store/app-privacy-details/)、2026-10-15 取得）：

- 「収集」＝端末外に送り、リクエストをリアルタイムで処理するのに必要な時間を超えてアクセスできる状態にすること。
  「IP アドレスがサーバー呼び出しで送られても保持しない場合は申告不要」。IP を保持する場合は用途に応じて位置・デバイス ID・診断として申告。
- 正確な位置情報＝緯度経度の小数点以下 3 桁以上と同等以上の解像度。おおよその位置情報＝それ未満。
- デバイス ID＝広告識別子など端末レベルの ID。解析（Analytics）目的＝利用者の行動評価、機能効果の把握、利用者規模の測定。
- 任意開示の例外は 4 条件すべてが必要。うち「データがアプリの画面で入力され、送信フォームに利用者名が表示され、毎回送信を選ぶ」を含む。

**証拠（このリポジトリと公開 GET で確認）**

| 対象 | 確認した事実 | 根拠 |
| --- | --- | --- |
| 場所データの取得 | 送るのはタイル URL（z14〜16）と `If-None-Match`（データのハッシュ）。GPS 座標・端末 ID・アカウントは送らない | `Core/Networking/TileAPIClient.swift`。インストール ID は報告送信時のみ（`ReportModel.swift`、報告は無効） |
| タイルの解像度 | z16 のタイル幅は経度 360/2^16 ≈ 0.0055°。小数点以下 3 桁（0.001°）より粗い | 計算 |
| Worker のログ | invocation logs 無効。リクエスト処理のコードは `console.log` しない（ログは定期処理のみ、本番 crons 空）。`app.onError` は 503 を返すだけで記録しない | `wrangler.jsonc`、`services/api/src/app.ts:181`、`refresh/scheduled.ts:50` |
| Workers Logs の保持期間 | Cloudflare 文書：Free 3 日 / Paid 7 日。invocation logs 無効時は console 出力・エラー・未捕捉例外が対象 | [Workers Logs](https://developers.cloudflare.com/workers/observability/logs/workers-logs/)（2026-10-15 取得） |
| 報告・写真・App Attest | `reports.available:false`、`photoEvidenceEnabled:false` | 公開 `GET /v1/config` |
| 解析・広告・クラッシュ SDK | なし（依存は GRDB のみ） | `APP_PRIVACY_INVENTORY.md` |
| サポート | アプリ内リンクからメールアプリで Gmail 宛に送る。送信者アドレスと本文が Gmail に残る | 公開ポリシー §9 |

**Cloudflare 読み取り確認（2026-10-15、wrangler OAuth、GET のみ）**：`mannerpath-api-production` の script-settings は
`invocation_logs:false`、`logs.persist:true`、traces 無効、Worker の `logpush:false`、tail consumers なし。アカウントにゾーンは無い（`workers.dev` のみ）。

**未確認**：アカウントの Logpush ジョブと契約プラン（API 403、OAuth スコープ外）。Workers Logs に実際に残っている項目（テレメトリ照会のスコープなし）。
保持期間は文書上 Free 3 日 / Paid 7 日で、プランが読めないため最長 7 日とだけ言える。Cloudflare の基盤側（workers.dev、DDoS 対策、集計メトリクス）での IP 保持。

**推奨回答（条件 A 確認前の案。最終推奨は下の表）**

| ASC 項目 | 推奨 | 根拠 |
| --- | --- | --- |
| カスタマーサポート | **申告する**（リンク、トラッキングなし、アプリの機能） | Gmail に保持される。メールアプリ経由のため「アプリの画面で入力・利用者名表示」の例外条件を満たさない |
| メールアドレス | **申告する**（同上） | 同上 |
| 正確な位置情報 | **申告しない** | GPS は送らない。タイルは小数点 3 桁より粗い。IP からの推定もおおよそ |
| デバイス ID | **申告しない** | 端末レベルの ID を送らない。インストール ID は無効な報告機能でのみ使用。ETag はデータのハッシュ |
| 製品の操作 | **条件 A を満たせば申告しない** | リクエスト処理で記録しない設計。満たせない場合のみ申告（目的はアプリの機能） |
| 解析（目的） | **選ばない** | 行動評価・利用者規模の測定に使っていない。未確認でも用途が無い以上、目的として選ぶ根拠がない |
| おおよその位置情報 | **条件 A を満たせば申告しない** | タイル＋IP を保持しなければ「収集」に当たらない。保持があれば申告（リンク、アプリの機能） |
| その他の診断データ | **条件 A を満たせば申告しない** | エラーを記録しない設計。保持があれば申告 |
| 写真・クラッシュ・その他のユーザーコンテンツ | **申告しない** | 機能が無効、または SDK が無い |
| トラッキング | **いいえ** | 広告・データブローカーへの提供なし |

**条件 A の確認結果（メンテナー、Cloudflare ダッシュボード、2026-10-15）**

| 確認 | 結果 | 言えること / 言えないこと |
| --- | --- | --- |
| (1) 呼び出しログ | Include invocation logs **OFF**（API でも `invocation_logs:false`） | リクエストごとの自動記録は無い。**関連データがすべて保存されていないことまでは言えない** |
| (2) Workers Logs の中身 | Logs ON、Persist ON、Traces OFF、Issues OFF。過去 24 時間の Events **0 件** | 24 時間で記録は 0 件で、リクエスト処理がログを出さない設計と整合する。24 時間より前と、エラー時に例外が記録される可能性は否定できない |
| (3) Logpush | 画面は「Subscribe to Logpush」。アカウント全体でジョブ 0 件は**未証明**（API 403） | Logpush を契約していないことを示唆する（推測）。ジョブが無いことの証明ではない |
| Cloudflare 基盤側 | ゾーン無し（`workers.dev` のみ）。DDoS 対策・集計メトリクスでの IP 保持は**未確認** | 開発者が読める保持データは見当たらない。事業者内部の処理は確認できない |

**設定変更の評価（変更は実施しない）**：変更は**不要**。Logs を OFF にすれば例外ログの残る余地がさらに減るが、障害時の診断ができなくなる。
リクエスト処理はログを出さず、24 時間 0 件のため、OFF にしても申告の根拠はほとんど変わらない。変える場合はメンテナーの判断で、ポリシーの記述（「診断記録は保存される場合があります」）は OFF でも正しいまま。

**最終推奨回答（メンテナー承認待ち、ASC 未入力）**

| ASC 項目 | 推奨 | 理由 |
| --- | --- | --- |
| カスタマーサポート / メールアドレス | **申告する**（リンク、トラッキングなし、アプリの機能） | Gmail に保持される。任意開示の例外条件を満たさない |
| おおよその位置情報 | **申告しない（推奨）**。保守案では申告 | Apple の基準は「開発者または提携先が、リアルタイム処理を超えてアクセスできるか」。開発者が読める保持データは確認できず、呼び出しログは無効、Events は 0 件。リスクは基盤側の保持と Logpush が未証明であること |
| その他の診断データ | **申告しない（推奨）**。保守案では申告 | 同上。例外ログは記録されうるが 24 時間で 0 件、アプリの診断を目的とした収集はしていない |
| 製品の操作 / 解析目的 | **申告しない** | 操作の記録・計測をしておらず、保守案でも根拠がない |
| 正確な位置情報 / デバイス ID | **申告しない** | 解像度と識別子の定義に当たらない（上の証拠表） |
| 写真・クラッシュ・その他のユーザーコンテンツ | **申告しない** | 機能が無効、または SDK が無い |
| トラッキング | **いいえ** | 広告・データブローカーへの提供なし |

**保守案**：Logpush ジョブ 0 件、または基盤側の保持が無いことを証明できないことを重く見る場合は、**おおよその位置情報**と
**その他の診断データ**を加える（リンク、トラッキングなし、アプリの機能）。基盤側の保持が問題になるのはこの 2 項目だけで、ほかの項目はどちらの案でも変わらない。

### 0.3 プライバシーポリシーとの整合

#275（2026-10-15 公開）で §2 を現状に合わせた：Cloudflare Workers を利用中、呼び出しログ無効、診断記録は保存される場合あり、
Workers のログは Cloudflare の公開仕様で最長 7 日、事業者側の記録が残る場合あり。§6（解析・広告・クラッシュ SDK なし）と
§5（投稿・写真・端末登録は利用不可）は §0.2 の推奨と矛盾しない。§9 のサポートメール（Gmail）は、申告するカスタマーサポート・
メールアドレスと一致。保守案を採る場合も、ポリシーは「事業者が IP やリクエスト情報を記録する場合がある」と書いているため矛盾しない。
法的十分性の判断は MAINTAINER。

### 0.4 年齢制限の回答案

| 質問 | 回答 |
| --- | --- |
| アルコール、タバコ、ドラッグの使用または言及 | **頻繁/極端** |
| ユーザー生成コンテンツ | いいえ（投稿無効） |
| 制限のない Web アクセス | いいえ |
| メッセージ・チャット / ソーシャルメディア / 広告 | いいえ |
| ペアレンタルコントロール / 年齢確認 | いいえ |
| 暴力・性的・ホラー・下品なユーモア・医療・ギャンブル・コンテスト・ルートボックス | なし / いいえ |
| キッズ向け | いいえ |

想定結果は 18+（Apple が算出）。**MAINTAINER 判断**：アプリ独自の最低利用年齢を設けるか。アプリ内の案内は「日本では 20 歳未満は喫煙できない」という法令の説明で、年齢確認はしない。ASC に 20+ の選択肢は無いので、上書きするなら利用可能な最も高い区分を選ぶ。

### 0.5 Content Rights 確認結果

- 事実：本番の 6 ソース / 513 地点のライセンス・出典表示・リリース指紋が登録内容と一致（2026-10-05 監査）。2026-10-15 の読み取り GET で台東区タイル（14/14553/6449）が出典 `taito-public-smoking-areas`、ライセンス URL `creativecommons.org/licenses/by/4.0/legalcode.ja` を返すことを再確認（他の 5 ソースは今回再測定していない）。
- 実装済み（未実機）：台東区の加工表示、Watch のライセンスリンク（#193）。iPhone/Watch のユニット・UI テストあり。
- 未確認：配布署名ビルドの実機で出典・ライセンスリンクが開くこと、MapKit の帰属表示、スクリーンショット・アイコンの権利。
- ASC 回答案：「第三者のコンテンツを含む」。「必要な権利を有する」の申告は、実機確認とメンテナーの法務承認の後に行う。各ライセンス（CC BY 4.0 / 2.1 JP など）の条件を超える利用（ロゴ・地図画像・原文の再配布など）はしない。

### 0.6 ユーザーの判断・入力（短い一覧、2026-10-15 更新）

1. App Privacy：§0.2 の推奨案（サポート関連 2 項目）か保守案（＋おおよその位置情報・その他の診断データ）かを決め、ASC に入力。
2. 最低利用年齢を設けるか（§0.4）。
3. ASC 入力：SKU、著作権者名、審査担当の連絡先（Git に記録しない）。
4. Content Rights の法務承認（配布ビルドの実機で出典・ライセンスリンクを確認した後）。
5. 審査メモ §5 の承認、Apple 標準 EULA の確認、ポリシーの法的十分性。

## 1. Build facts (verified in the Xcode project)

| Item | Value | Status |
| --- | --- | --- |
| Bundle ID (iPhone app) | `com.kounishiyuuki.MannerPath` | CONFIRMED |
| Embedded bundles | `….widgets`, `….watchkitapp`, `….watchkitapp.widgets` | CONFIRMED |
| Version / build | `MARKETING_VERSION 1.0`, `CURRENT_PROJECT_VERSION 1` (raise the build number for each upload) | CONFIRMED |
| Display name | `MannerPath` | CONFIRMED |
| Minimum OS | iOS 18.0, watchOS 11.0 | CONFIRMED |
| Device families | iPhone app and iPhone widget `1` (iPhone only), Watch app `4`; no native iPad target. iPad users run the iPhone app in compatibility mode ([IPAD_V1_READINESS.md](IPAD_V1_READINESS.md)) | CONFIRMED (maintainer decision 2026-10-05) |
| App localizations | development region `en`; Japanese `ja` translations present | CONFIRMED |
| Public site origin in Release builds | `https://kounishiyuuki.github.io/MannerPath/` (Debug unset) | CONFIRMED (#179) |
| API origin in Release builds | `https://mannerpath-api-production.happywestyuki.workers.dev` (Debug unset); Release Info.plist and simulator production connection verified | CONFIRMED (#186); signed distribution archive remains separate |
| **App icon** | Same maintainer-selected opaque sRGB 1024 × 1024 master in iPhone and Watch AppIcon sets; unsigned archive CFBundleIcons / Assets.car / compiled AppIcon verified | **RESOLVED (technical); final signed/physical/asset-rights checks remain — see §8** |

## 2. App Information (ASC → App Information)

| Field | Enter | Status |
| --- | --- | --- |
| Primary language | Japanese | CONFIRMED |
| Name (ja) | `MannerPath` | CONFIRMED |
| Subtitle (ja) | `喫煙可能場所と利用条件を確認` (14 characters; limit 30) | CONFIRMED |
| Bundle ID | `com.kounishiyuuki.MannerPath` | CONFIRMED |
| SKU | any stable internal string, e.g. `mannerpath-ios-1` (never shown to users) | MAINTAINER |
| Primary category | Navigation | CONFIRMED |
| Secondary category | Utilities | CONFIRMED |
| Content Rights | “Yes, contains third-party content”; necessary-rights declaration only after [production corpus audit](PRODUCTION_CONTENT_RIGHTS_AUDIT.md) gates: municipal open data and Apple Maps (§5) | CONFIRMED live corpus/licenses/API attribution (513 / 6 / community 0); Taito app-side notice / Watch license Link IMPLEMENTED; signed iPhone/Watch visual/link verification, assets and MAINTAINER legal signoff pending |
| Age Rating | questionnaire answers in §4 below | CONFIRMED answers; result calculated by Apple |
| License agreement | Apple standard EULA | CONFIRMED |

## 3. Version 1.0 page (ASC → iOS App → 1.0)

| Field | Enter | Status |
| --- | --- | --- |
| Promotional text (optional) | `喫煙可能場所の位置、利用条件、情報源を確認。周囲の掲示や施設のルールを優先し、案内情報を参考にしてください。` | CONFIRMED |
| Description | block below (length checked by `scripts/test-store-copy.py`; limit 4,000). The covered-area sentence must match the production inventory at submission ([release gate](V1_APP_STORE_RELEASE_GATE.md) G8) | CONFIRMED wording; area list re-check at submission |
| Keywords | `喫煙所,灰皿設置,指定場所,利用条件,徒歩案内,位置情報` (74 bytes; limit 100) | CONFIRMED |
| Support URL | `https://kounishiyuuki.github.io/MannerPath/support/` | CONFIRMED (live, #177/#179) |
| Marketing URL | leave blank | CONFIRMED |
| Copyright | candidate `2026 MannerPath 運営` (ASC adds ©) | MAINTAINER confirms the legal rights holder |
| Build | the processed release build | BLOCKED-DEVELOPER-PROGRAM |
| Screenshots | §6 | partly BLOCKED (see §6) |
| Sign-in required | **No** (there are no accounts) | CONFIRMED |
| App Review contact | first/last name, phone (international format), email | MAINTAINER |
| App Review notes | §5 draft with tested destination steps; final maintainer approval and signed-build checks remain | MAINTAINER / BLOCKED-DEVELOPER-PROGRAM; populated-area path CONFIRMED on Release simulator |
| Version release | **Manually release this version** (allows final backend/privacy checks after approval) | CONFIRMED |

Description (paste as plain text):

```text
MannerPathは、喫煙が認められている場所の位置や利用条件を確認するための案内アプリです。たばこの販売・購入案内や広告は行いません。

・近くの喫煙可能場所を地図と一覧で確認
・利用条件、情報源、確認状況、位置の精度を確認
・徒歩経路を確認し、Appleのマップへ案内を引き継ぎ
・保存済みの場所情報は通信できないときも参照可能
・Apple Watchで近くの場所や距離・方向を確認
・ウィジェットから保存済みの近くの場所情報を参照

現在の掲載地域は、東京都の一部（台東区、港区、江東区、武蔵野市）、大阪市、京都市です。各地域でも、公的機関が公開し利用条件を確認できた場所のみを掲載しており、すべての喫煙場所を網羅するものではありません。掲載地域外では場所は表示されず、掲載がないことを表示します。営業時間や利用条件が不明な場合は、不明として表示します。施設内の目安位置は、正確な喫煙場所の位置と区別します。

掲載情報だけで、その時点の喫煙可否を保証するものではありません。現地の掲示、施設のルール、自治体の規則を優先してください。日本では20歳未満の方は喫煙できません。法令上喫煙が認められている方を対象としています。

アカウント登録は不要です。端末の現在地は近くの場所の順位や距離・方向の計算に使用します。オフラインでの徒歩経路案内には対応していません。

この初回バージョンでは、場所の報告と写真の送信は利用できません。
```

Each bullet matches behavior verified on the simulator in #176 (list/map, detail evidence and approximate
location, route preview and Maps handoff, cached offline, Watch nearby/detail). Widget display on a device is
still a device gate (§7); keep the widget bullet only if that check passes.

## 4. Age Rating questionnaire answers

| Question | Answer |
| --- | --- |
| Alcohol, Tobacco, or Drug Use or References | **Frequent** |
| User-Generated Content | No |
| Unrestricted Web Access | No |
| Messaging and Chat / Social Media / Advertising | No / No / No |
| Parental Controls / Age Assurance | No / No |
| Profanity or Crude Humor / Horror or Fear Themes | None / None |
| Medical or Treatment / Health or Wellness | None / No |
| Mature or Suggestive / Sexual Content or Nudity / Graphic Sexual Content | None / None / None |
| Cartoon or Fantasy / Realistic / Prolonged Graphic Violence; Guns or Weapons | None for each |
| Gambling / Loot Boxes / Simulated Gambling / Contests | No / No / None / None |
| Made for Kids | No |

Expected result: 18+ (current system); 17+ on older OS results. Apple calculates it. If the live form shows a
question not listed here, read its definition and record the wording before answering (§3). Whether the app
itself imposes a minimum use age above the calculated rating is a **MAINTAINER** decision (§3).

## 5. App Review notes and reviewer steps

Notes (English), final draft 2026-10-15 for maintainer approval. Steps 1–5 below were verified on the Release simulator (#191/#193); re-run them on the submitted build:

```text
MannerPath is a navigation and local-rule compliance utility for adults legally permitted to smoke. It shows places listed in published municipal open data, with access restrictions, source information and uncertainty; it does not guarantee that smoking is permitted at a place at any given time, and it instructs users to follow posted signs and local rules. It does not encourage tobacco consumption, sell tobacco, provide purchase links, promote brands or show tobacco/nicotine advertising. There are no payments, rewards, streaks or accounts. No sign-in is required.

Location permission is When In Use. MannerPath uses the device location for nearby ranking, distance and bearing; requests to our service contain geographic tile IDs, not raw device GPS coordinates. We do not intentionally retain location history. Apple MapKit search/routing and Apple Maps operate through Apple's services. Our privacy policy (https://kounishiyuuki.github.io/MannerPath/privacy/) describes how network providers may process request information.

Reports, report device registration and photo uploads are unavailable in this initial version. There is no public user-content feed. Apple Watch shows nearby cached places with distance and direction; widgets show a cached nearby place. Cached discovery works offline; offline walking routes are not provided.

Coverage depends on published open data. In version 1.0, places are published only for parts of Tokyo (Taito, Minato, Koto and Musashino), Osaka City and Kyoto City; other areas show an empty state. Our service is available during review at https://mannerpath-api-production.happywestyuki.workers.dev. To see populated results from outside Japan, search for “浅草駅 東京” in destination search and select the result, then open a published place's details and sources. This displays the selected destination's area, not your current location. Walking routes may be unavailable far from the destination; straight-line distance and bearing remain available. Please also see the age/eligibility notice, Data & Privacy (privacy policy, support and contact links), filters, the location-denied state and the cached offline state.
```

Reviewer steps (draft, not final approved Review Notes; Release simulator J/K/L and source-rights UI confirmed
by #191/#193; signed-device/Maps/Watch checks remain):

1. Fresh install → eligibility notice → 確認しました → allow location While Using.
2. Search “浅草駅 東京” → select destination → published list/map → place detail → sources. Refresh also works
   with location denied; clear the destination to return to the device area. For a distant current location, do not
   require a walking route (10 km gate); verify Apple Maps handoff separately on the signed build.
3. Filters (type, tobacco, access) and clearing them.
4. Data & Privacy → プライバシーポリシー / サポート open the published pages; メールで問い合わせ addresses mannerpath.support@gmail.com.
5. Airplane mode after loading: cached places, distance and direction remain; route unavailability is explained.
6. Paired Apple Watch: nearby list, detail, directions handoff (BLOCKED-DEVELOPER-PROGRAM to verify on hardware).

If a populated area cannot be reached remotely with the shipped UI, attach a screen recording rather than adding
any hidden reviewer feature (§7).

## 6. Screenshots

Use final-build UI only, Japanese localization, no synthetic place data. Current Apple dimensions:
[submission §9](APP_STORE_SUBMISSION.md#9-screenshots-checklist) and the
[Lane 4 production-data/capture runbook](release/V1_DATA_AND_STORE_ASSETS.md).

| Set | Size to upload | Required? | Status |
| --- | --- | --- | --- |
| iPhone Dynamic Island medium | 1206 × 2622 or 1179 × 2556 portrait | Current required set; confirm Media Manager well/scaling | Final native RC capture pending; [Lane 4 runbook](release/V1_DATA_AND_STORE_ASSETS.md) |
| iPhone Dynamic Island large (historical 6.9-inch) | 1320 × 2868 portrait; alternatives 1260 × 2736, 1290 × 2796 | Optional larger set; validate required-well scaling at upload | Production Release rehearsal exists; final selected RC captures/approval pending |
| Apple Watch | 416 × 496 (Series 10/11 46mm class), one size for all localizations | Yes for the Watch app | Final production-data captures and signed paired-device verification required; #176/#193 fixture simulator captures are not store assets. Destination corpus is not propagated to Watch |

v1 screenshot sets are **iPhone + Apple Watch only**: the app is iPhone-only, so no iPad set is required.

Suggested 5-shot iPhone sequence: covered-area map; destination search; destination-relative list/distance;
place detail with official evidence; in-app Apple Maps handoff. No approximate example is manufactured: the
2026-10-15 observed six-source corpus has zero areaApproximate spots. See the Lane 4 runbook for privacy checks. Watch: nearby list; place
detail with distance/direction. Exclude brands, smoking imagery, purchase cues and coverage/permission guarantees.

## 7. Waiting / blocked items

**REMAINING RELEASE / PRIVACY EVIDENCE** (not a pending backend launch):

- ~~Production HTTPS API origin / remote populated-area access~~ done by #186/#190/#191/#193: committed
  origin and Release simulator destination/list/map/detail/source/refresh/clear verified, including denied
  location and AX5. §5 provides tested draft steps; final Review Notes are still maintainer-owned.
- Backend gates verified by #185 and Release simulator availability by #186; community remains pending. Signed distribution/hardware browsing traffic still to confirm.
- **App Privacy:** use the recommendation in §0.2 (2026-10-15, Apple's current definitions) after the maintainer confirms condition A and approves it. The older seven-category proposal (submission §2.2) is superseded.
- ~~Content Rights final production corpus identity/license/API evidence~~ confirmed by [rights audit](PRODUCTION_CONTENT_RIGHTS_AUDIT.md). Taito app-side notice and Watch license Link implemented; final signed iPhone/Watch visual/link/asset checks and MAINTAINER legal signoff remain; do not enter the necessary-rights declaration yet.
- Store screenshots with production data (§6).

**BLOCKED-DEVELOPER-PROGRAM** (membership, signing, devices; exact steps in [APPLE_DISTRIBUTION_READINESS.md](APPLE_DISTRIBUTION_READINESS.md) §4):

- ~~Active membership, App ID / App Group provisioning, App Attest entitlement environment, distribution-signed export~~
  done 2026-10-13 ([distribution readiness](APPLE_DISTRIBUTION_READINESS.md) §1–§2); agreements in ASC remain owner-checked.
- Upload, processed build, TestFlight; Xcode Privacy Report from the archive.
- Export compliance: answer per the archive (§4): uses encryption **Yes** (OS HTTPS/hashing/App Attest);
  proprietary **No**; standard non-OS **No**; exempt **Yes** subject to the archive's linked libraries and territories;
  optional `ITSAppUsesNonExemptEncryption = NO` only after that confirmation.
- Physical-device checks: widgets (3 families), VoiceOver order, Reduce Motion/Transparency, contrast, Maps handoff
  screen, mail compose from the contact link, Watch on hardware.
  Reduce Motion simulator confirmation (#191) is complete; it does not replace physical-device checks.

**MAINTAINER** (personal or legal input; not stored in the repository):

- App Review contact: first/last name, phone, email.
- Copyright holder confirmation; SKU.
- Trader status if any EU storefront is selected (not recommended for v1, below).
- Minimum-use-age policy decision; legal sufficiency of the policy text.
- Support mailbox delivery and response owner (mannerpath.support@gmail.com).

## 8. Focused-fix candidates found while preparing this sheet

| Severity | Finding | Evidence / remaining checks |
| --- | --- | --- |
| **Resolved P0 (2026-10-06)** | App Icon artwork and technical archive inclusion, iPhone + Watch | Maintainer-approved downscaled master, CFBundleIcons / Assets.car / 1024 px AppIcon in unsigned archive ([distribution readiness §3.1](APPLE_DISTRIBUTION_READINESS.md#31-app-icon-follow-up-2026-10-06)). Signed/device/asset-rights signoff remains open; not ASC upload approval |
| Resolved | iPad decision: v1 is iPhone + Apple Watch only (`TARGETED_DEVICE_FAMILY = 1`); the iPad simulator audit found no P0/P1 ([IPAD_V1_READINESS.md](IPAD_V1_READINESS.md)) | — |

## 9. Pricing and availability

| Field | Enter | Status |
| --- | --- | --- |
| Price | Free (no in-app purchases) | CONFIRMED recommendation; MAINTAINER approves |
| Storefronts | **Japan only** for v1: data, copy and eligibility notice are Japan-specific | CONFIRMED recommendation; MAINTAINER approves |
| Mac (Apple silicon) / Apple Vision Pro availability | Off until tested | CONFIRMED recommendation |
| EU trader status | Not needed if Japan only | MAINTAINER if EU is added |

## 10. Entry order in ASC

1. Agreements and membership (BLOCKED-DEVELOPER-PROGRAM).
2. Create the app record: name, primary language Japanese, bundle ID, SKU (§2).
3. App Information: subtitle, categories, content rights, age rating, license (§2, §4).
4. Pricing and Availability: free, Japan (§9).
5. Upload the signed build; answer export compliance for it (§7).
6. Version 1.0: promotional text, description, keywords, support/marketing URL, copyright (§3).
7. Screenshots: iPhone and Apple Watch (§6).
8. App Review: sign-in No, contact, notes with the WAITING markers filled (§5).
9. App Privacy: privacy policy URL `https://kounishiyuuki.github.io/MannerPath/privacy/`, then the exact
   §0.2 recommended answers after owner approval (condition A decides the fallback). Keep UNKNOWNs documented.
10. Version release: manual. Add for Review → Submit only after every WAITING / BLOCKED / P0 item above is closed.
