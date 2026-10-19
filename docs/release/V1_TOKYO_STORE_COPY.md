# v1.0 store copy — 638-spot candidate (準備中 / NOT LIVE)

> **Status: 準備中.** Do not enter this text in App Store Connect, the Review Notes or the support page until
> production serves the 11-source / 638-spot corpus. That requires the promotion in
> [V1_TOKYO_RELEASE_PLAN.md §4](V1_TOKYO_RELEASE_PLAN.md) and readiness on the switched GREEN.
>
> Until then, the text to submit is the 513-spot version in [APP_STORE_CONNECT_ENTRY.md §3/§5](../APP_STORE_CONNECT_ENTRY.md).
> Two other preconditions are not met by this document:
> - the Tokyo rights questions in [V1_TOKYO_RIGHTS_REVIEW.md](V1_TOKYO_RIGHTS_REVIEW.md) must be resolved by the maintainer (G5);
> - the corpus switch itself must happen.
>
> `scripts/test-store-copy.py` checks this candidate against the 638 areas, and still checks the live sheet against the 513 areas.

## 1. Fields

Subtitle and keywords are the same as the 513 version. They name no area, so they stay valid for both corpora.

| Field | Candidate | Note |
| --- | --- | --- |
| Subtitle (ja) | `喫煙可能場所と利用条件を確認` | unchanged |
| Keywords | `喫煙所,灰皿設置,指定場所,利用条件,徒歩案内,位置情報` | unchanged. No area names, which could read as full coverage of 東京/渋谷/池袋 |
| Promotional text | `喫煙可能場所の位置、利用条件、情報源を確認。周囲の掲示や施設のルールを優先し、案内情報を参考にしてください。` | unchanged |

## 2. Description (638 candidate)

Description (paste as plain text):

```text
MannerPathは、喫煙が認められている場所の位置や利用条件を確認するための案内アプリです。たばこの販売・購入案内や広告は行いません。

・近くの喫煙可能場所を地図と一覧で確認
・利用条件、情報源、確認状況、位置の精度を確認
・徒歩経路を確認し、Appleのマップへ案内を引き継ぎ
・保存済みの場所情報は通信できないときも参照可能
・Apple Watchで近くの場所や距離・方向を確認
・ウィジェットから保存済みの近くの場所情報を参照

現在の掲載地域は、東京都の一部（千代田区、中央区、港区、台東区、渋谷区、豊島区、江東区、武蔵野市）、大阪市、京都市です。掲載しているのは、自治体がオープンデータや公式ウェブサイトで公開している情報のうち、利用条件を確認できた場所のみで、各地域でもすべての喫煙場所を網羅するものではありません。東京都のほかの区市町村など、掲載地域外では場所は表示されず、掲載がないことを表示します。

一部の場所は、自治体が公開する住所や施設名をもとにした「目安の位置」で表示します。目安の位置は建物や公園などの代表的な地点で、喫煙場所そのものの位置ではありません。場所の詳細などで「目安」であることを表示し、正確な位置の場所と区別します。営業時間や利用条件、たばこの種類が不明な場合は、不明として表示します。

掲載情報だけで、その時点の喫煙可否を保証するものではありません。現地の掲示、施設のルール、自治体の規則を優先してください。日本では20歳未満の方は喫煙できません。法令上喫煙が認められている方を対象としています。

アカウント登録は不要です。端末の現在地は近くの場所の順位や距離・方向の計算に使用します。オフラインでの徒歩経路案内には対応していません。

この初回バージョンでは、場所の報告と写真の送信は利用できません。
```

Wording decisions:
- **東京都の一部** is followed by the full list, and the text adds that the rest of Tokyo is outside the covered area. A reader cannot take "東京" to mean the whole of Tokyo.
- **目安の位置** explains what the pin is (a representative point of the building or park, not the place) and says
  how the app marks it. Do not use 「概略位置」 in user-facing copy. The app's label is 「目安」, so the store text
  uses the same word.
- **オープンデータや公式ウェブサイトで公開している情報**: true for both kinds of source, the CC BY open data and the
  5 factReference pages. The text does not claim a licence for either.
- The widget bullet is kept only if the device check passes (G14), the same as in the 513 version.

## 3. App Review notes (638 candidate, English)

Change from the 513 notes: the first sentence and the coverage paragraph. The 513 sheet's "published municipal
open data" is replaced in both versions. In the 638 version, 5 of the 11 sources are municipal web pages, not
open-data files.

```text
MannerPath is a navigation and local-rule compliance utility for adults legally permitted to smoke. It shows places published by Japanese local governments (open-data files and official web pages), with access restrictions, source information and uncertainty; it does not guarantee that smoking is permitted at a place at any given time, and it instructs users to follow posted signs and local rules. It does not encourage tobacco consumption, sell tobacco, provide purchase links, promote brands or show tobacco/nicotine advertising. There are no payments, rewards, streaks or accounts. No sign-in is required.

Location permission is When In Use. MannerPath uses the device location for nearby ranking, distance and bearing; requests to our service contain geographic tile IDs, not raw device GPS coordinates. We do not intentionally retain location history. Apple MapKit search/routing and Apple Maps operate through Apple's services. Our privacy policy (https://kounishiyuuki.github.io/MannerPath/privacy/) describes how network providers may process request information.

Reports, report device registration and photo uploads are unavailable in this initial version. There is no public user-content feed. Apple Watch shows nearby cached places with distance and direction; widgets show a cached nearby place. Cached discovery works offline; offline walking routes are not provided.

Coverage is limited to places that local governments publish. In version 1.0, places are published only for parts of Tokyo (Chiyoda, Chuo, Minato, Taito, Shibuya, Toshima, Koto and Musashino), Osaka City and Kyoto City; other areas show an empty state. Some places are shown at an approximate position (the representative point of the published address, building or park, not the smoking area itself); their details state that the position is approximate ("目安"). Our service is available during review at https://mannerpath-api-production.happywestyuki.workers.dev. To see populated results from outside Japan, search for "浅草駅 東京" in destination search and select the result, then open a published place's details and sources. This displays the selected destination's area, not your current location. Walking routes may be unavailable far from the destination; straight-line distance and bearing remain available. Please also see the age/eligibility notice, Data & Privacy (privacy policy, support and contact links), filters, the location-denied state and the cached offline state.
```

Reviewer steps are unchanged (APP_STORE_CONNECT_ENTRY §5). Optionally add step 2b on the signed build:
search 「渋谷駅 東京」, open an approximate place, and confirm the 「目安」 label and the source page. Only
record step 2b once it has been verified on the build.

## 4. Support page — coverage section update (draft; not published)

Target: `site/support/index.html`, section 「場所が表示されない地域」. Not edited in this change, because Pages
publishes `site/` from `main` and the live page must keep describing the live 513 corpus. Apply it in the same
change that follows the production switch.

Replace the first list item:

```html
<li>MannerPath は、地方公共団体がオープンデータや公式ウェブサイトで公開している情報のうち、利用条件を確認できた場所だけを表示します。現在の掲載地域は、東京都の一部（千代田区、中央区、港区、台東区、渋谷区、豊島区、江東区、武蔵野市）、大阪市、京都市です。掲載地域内でも、すべての喫煙場所を掲載しているわけではありません。</li>
<li>一部の場所は、公開された住所や施設名から求めた「目安」の位置で表示します。目安の位置は建物や公園などの代表的な地点で、喫煙場所そのものの位置ではありません。現地では案内表示に従ってください。</li>
```

The second existing item (「この周辺に掲載中の場所はありません」…) stays. The correction and removal paragraph
already covers source objections. One more sentence is suggested there for factReference publishers:
「自治体から掲載内容についてご指摘があった場合は、確認のうえ速やかに掲載を停止します。」 This matches the fail-closed
rule of ADR-0018 D-R.

## 5. `scripts/test-store-copy.py` policy

| Check | Now (513 live) | At the production switch (638) |
| --- | --- | --- |
| `APP_STORE_CONNECT_ENTRY.md` description names | `AREAS` = 6 areas (unchanged) | replace the description in the entry sheet with §2 above. Then set `AREAS` to `TOKYO_AREAS` and delete the candidate check |
| This file's description | `TOKYO_AREAS` (10 areas) + limits + banned claims + 「準備中」 banner present | — |
| Banned claims | 全国, どこでも, 日本中, すべての喫煙所, 全ての喫煙所 | add 「東京都全域」, 「東京全域」 for both |

Do the switch in one PR. It updates the entry sheet, `AREAS`, the support page and gate G8/G9/G12 together.
Merge it only after the GREEN cut-over is confirmed by `GET /v1/readiness` and the public GET scan, never before.
