# ABR parcel (地番) points: terms check for gate v3 (2026-11-08)

This is evidence for the maintainer's `PARCEL_TERMS_REVIEW` decision ([ADR-0018](../adr/0018-location-precision-v2-and-fact-reference-sources.md), gate v3).
It is **not** that decision: `PARCEL_TERMS_REVIEW` stays `null`, and no parcel point is adopted.

| Item | Finding | How it was read |
|---|---|---|
| Which terms apply | ABR terms: 地番マスター and 地番マスター位置参照 are also governed by the 登記所備付地図データ利用規約 (法務省, via G空間情報センター). Using them counts as agreeing to those terms too. | [デジタル庁 ABR利用規約](https://www.digital.go.jp/policies/base_registry_address_tos), read directly |
| Commercial use | Reported as allowed: anyone may reproduce, transmit publicly and adapt the data free of charge under the terms. | Web search summary only; the terms PDF was **not** read in full (the G空間 dataset page returned 404) |
| Credit (出典) | A credit is required. Example form: 「登記所備付データ○○市」（法務省）, with the page URL | Same search summary |
| Processing notice (加工) | The fact of editing or processing must be stated, and processed data must not be presented as made by the state | Same search summary |
| Precision | A lot's representative point. A large lot can sit far from the building, so a parcel point stays `areaApproximate` / facility | ADR-0011 / gate comment |

The maintainer should read the terms PDF itself (G空間情報センター 登記所備付地図データ, [法務省 案内](https://www.moj.go.jp/MINJI/minji05_00494.html)) before recording the review. A matching record would look like this:

```ts
{ termsUrl: "<the terms PDF URL as read>", reviewedBy: "<maintainer>", reviewedOn: "<date>",
  attributionText: "登記所備付データ（法務省）を加工して作成" }
```

Observed parcel candidates in Kanazawa/Nonoichi. These are local abr-geocoder 2.3.1 runs on 2026-11-08 over the registered release `abr-kanazawa-nonoichi-2026-10-26`. Coordinates are not recorded here.

| Facility | Input | Result | After the review |
|---|---|---|---|
| 倉式珈琲店 御経塚店 | 石川県野々市市御経塚2-5 | parcel, notation-only difference, no remainder | gate passes. Existence is a store-page service tag; D-R is still pending |
| 満天の湯 白山インター店 | 石川県野々市市柳町460番地 | parcel, no remainder | gate passes. The official page lacks a smoking statement, so existence must come from the hotel-site pages (D-R pending) |
| 金沢国際ホテル | 石川県金沢市大額町ル8 | parcel, score 1 | gate passes. D-R is pending |

Distance plausibility (whether each lot point sits on the facility's building) was **not** checked. No independent reviewed point is available, and map services are not used.
