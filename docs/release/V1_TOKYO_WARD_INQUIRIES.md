# v1.0 Tokyo — ward terms re-check and inquiry drafts (NOT SENT)

Input to G5 and [V1_TOKYO_RIGHTS_REVIEW.md](V1_TOKYO_RIGHTS_REVIEW.md) open point 1. Nothing here was sent, and
nothing here approves publication. Sending, and deciding what a reply means, is the maintainer's job.

## 1. Terms re-check (2026-10-19T09:57Z, HTTP GET, pages kept outside the repository)

| Ward | Terms page | SHA-256 now | vs. recorded in PROVENANCE | Copyright clause (verbatim) |
| --- | --- | --- | --- | --- |
| 中央区 | [このホームページの詳細情報](https://www.city.chuo.lg.jp/kusei/kouhoukouchou/kouhou/aboutwebsite/thissite.html) | `84a2dd30…cc62c` | **unchanged** | 「区ホームページに掲載されている内容（テキスト、画像、PDFその他のデータ）の著作権は中央区に帰属します。…著作権法上認められている行為を除き、無断で転載や改変などを行うことはできません。」 |
| 渋谷区 | [サイトポリシー](https://www.city.shibuya.tokyo.jp/guide/website/list/site_policy.html) | `3a0c482e…7eada` | **raw hash differs; content unchanged** (recorded `24fdef4c…`; see notes) | 「本サイト上の情報・画像・図表などは、特に明示がない限り、その著作権を渋谷区が保有します。引用・転載・複製を希望される場合は、広報コミュニケーション課まで、ご連絡ください。転載・複製はこれを禁じます。」 |
| 豊島区 | [サイトポリシー](https://www.city.toshima.lg.jp/012/kuse/koho/homepage/sitepolicy.html) | `92d295e4…2edd0` | **unchanged** | 「当サイト上の文書や画像等は、『私的使用のための複製』や『引用』など著作権法上認められた場合を除き、無断で複製・転用することはできません。」 |

Notes:
- Shibuya, diffed 2026-10-19: the recorded fetch, this fetch and a third one have identical visible text, the
  same CMS policy body (`revisedAt` 2025-03-30) and the same rights-scope fingerprint `454d1cec…`. Only a
  per-request search-box id and CMS state change, so the raw hash differs on every fetch. Recorded in
  `shibuya-smoking-places/PROVENANCE.md`; no rights reading changes.
- None of the three pages prohibits information use, data acquisition or database incorporation. Each forbids,
  or requires contact for, reproduction (転載・複製・改変・転用) beyond what copyright law allows.
- Whether normalized facts amount to reproduction is the open legal question.

## 2. Contacts (as published, 2026-10-19)

| Ward | Rights / website | Smoking-place page owner | Form |
| --- | --- | --- | --- |
| 中央区 | 企画部広報課広報係 (代表 03-3543-0211) | 中央区保健所 生活衛生課 生活衛生事業係, 03-3546-5762 | the site's お問い合わせ page (`/kusei/kouhoukouchou/kouhou/aboutwebsite/toiawase.html`) |
| 渋谷区 | 広報コミュニケーション課 広報プロモーション係, 03-3463-1287, FAX 03-5458-4920 (named by the terms as the contact) | 環境整備課 きれいなまちづくり係 (代表 03-3463-1211) | each page's お問い合わせフォーム (external `dcp.city.shibuya.tokyo.jp`) |
| 豊島区 | 広報課 ホームページグループ, 03-4566-2535 | 環境保全課 環境美化グループ, 03-3981-2690 | — (phone; use the general inquiry route on the site) |

Recommended addressee:
- **Shibuya:** 広報コミュニケーション課, which the terms name, with a copy to 環境整備課.
- **Chuo and Toshima:** the smoking-place page owner, asking them to forward the request to 広報 if needed.

## 3. Draft (common text; fill in 【】 per ward)

```text
件名：喫煙所案内アプリでの「【ページ名】」掲載情報の利用について（ご相談）

【区名】 【課・係名】 ご担当者様

突然のご連絡失礼いたします。MannerPath 運営の【氏名】と申します。
法令上喫煙が認められている方が、指定喫煙所・公衆喫煙所を探して周囲の迷惑にならない場所で喫煙できるよう案内する、無料の iPhone/Apple Watch アプリ「MannerPath」を開発しております。たばこの販売・広告・購入案内は一切行わず、アプリ内課金や広告もありません。

貴区ホームページの「【ページ名】」（【URL】）に掲載されている喫煙場所について、以下の方法で利用させていただくことが可能か、またその際の条件をご教示いただけますでしょうか。【サイトポリシーの著作権の記載】を拝見し、無断での転載・複製に当たらないよう、事前にご相談させていただいております。

1. 利用する情報
   ・喫煙場所の名称、所在地（住所）、利用できる時間・日、注意書き（例：悪天候時休止）
   ・ページの文章・表のレイアウト・画像・地図・PDFは、複製・転載いたしません。
2. 利用の方法
   ・上記の事実情報のみを当方で項目ごとに整理（正規化）してデータベースに保存し、アプリの地図と一覧に表示します。
   ・営業時間の文言は原文のまま表示し、記載のない条件（たばこの種類、利用者の制限など）は「不明」と表示します。
3. 位置の表示
   ・ピンの位置は、デジタル庁「アドレス・ベース・レジストリ」で所在地の住所を照合した代表点とし、アプリ上で「目安」の位置である（喫煙場所そのものの位置ではない）と明示します。
4. 出典の表示
   ・各場所の詳細に「出典：【区名】ホームページ『【ページ名】』（URL、確認日）。MannerPathが事実のみを正規化して作成。【区名】による推奨・保証を意味しません。」と表示し、元のページへのリンクを設けます。表記についてご指定があれば従います。
5. 更新・停止
   ・掲載内容は貴区ページの更新を確認して反映し、閉鎖・休止が分かった場所は掲載を停止します。
   ・貴区から掲載の中止をご指示いただいた場合は、速やかに掲載を停止いたします。

お伺いしたい点
 (a) 上記の利用について、貴区の許可・届出等が必要でしょうか。必要な場合、その手続きと条件をお教えください。
 (b) 出典表示の文言や、「目安」の位置表示について、ご指定・ご要望はございますか。
 (c) 掲載にあたり、ほかにご留意すべき点はございますか。

ご多用のところ恐れ入りますが、ご確認いただけますと幸いです。
なお、貴区からご回答をいただくまで、当該情報をアプリで公開することはいたしません。

MannerPath 運営 【氏名】
連絡先：mannerpath.support@gmail.com
サポートページ：https://kounishiyuuki.github.io/MannerPath/support/
```

Per-ward fill-ins:

| Ward | 【ページ名】 / 【URL】 | 【サイトポリシーの著作権の記載】 | Spots affected |
| --- | --- | --- | --- |
| 中央区 | 中央区内指定喫煙場所一覧 / https://www.city.chuo.lg.jp/a0030/kenkouiryou/kenkou/tobacco/kitsuenbasho/kitsuenichiran.html | 「このホームページの詳細情報」の「著作権について」 | 61 (区営 14 + 民間 47) |
| 渋谷区 | 区内公共喫煙所一覧 / https://www.city.shibuya.tokyo.jp/kankyo/machi-seiso/kitsuen/smokingplace.html | 「サイトポリシー」の「著作権について」（引用・転載・複製はご連絡のこと） | 30 |
| 豊島区 | 区指定喫煙所 / https://www.city.toshima.lg.jp/152/machizukuri/sumai/bika/taisaku/025701.html | 「サイトポリシー」の「著作権について」 | 4 |

Chuo only: the pins are representative points from the ward's own open-data park list (CC BY 4.0) for the 14
区営 places, and ABR address points for the 47 民間 places. Change item 3 to say so.

Before sending, the maintainer decides:
- the sender name;
- whether to send by email or by form;
- whether the line 「回答をいただくまで公開しない」 matches the 1.0 plan. If 1.0 must not wait for replies,
  drop that ward from 1.0 instead (rights review §4).
