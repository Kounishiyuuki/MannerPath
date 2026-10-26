# Kanazawa south operator intake — 2026-10-26 JST

Six actual normalized operator place records, not publisher-delivered datasets. All are internal BLOCKED candidates.
No accepted source observations, canonical spots, area anchors or public tiles are created by these inputs.
`checkedAt` is a desk page check, never a site visit. `receivedOn` is local preparation date.

## Evidence and independent rights review

`manifest.json` pins each facts file by SHA-256. Each `*-receipt.json` enters the existing `source:intake`; generated
`*-intake.json` retains rawRowCount=1, UNREVIEWED, productionApproval=false and coordinate authority unknown.
`rights-notes.json` records the URLs/observations for source-specific review, not permission or G5 sign-off.
The six have independent operator URLs; no P-WORLD, CLUB JT, OSM or map-vendor values enter normalized intake.

| Input | Existence / address source | Preserved fact and limitation |
| --- | --- | --- |
| homerun | https://homerun.co.jp/shop_nonoichi.html | Store service list says smoking booth; address is 野々市市横宮町3-6. The booth's indoor/outdoor setting is unknown. Facility opening hours never become smoking hours |
| shiawase | https://shiawasenoyu.co.jp/info.html | FAQ states smoking room on 2F; footer gives 野々市市横宮町6-3. Bath/changing room ban does not negate the separate room. Bath charges are not proof of the smoking room's access conditions |
| hikousen | https://hikaricorp.jp/karaoke/koudaimae.html and https://hikaricorp.jp/karaoke/koudai_map.html | Store page identifies Hikari as operator, smoking booth separately from nonsmoking karaoke rooms. Access page states 石川県野々市市扇が丘４－８. No map iframe coordinates used |
| kurashiki | https://www.saint-marc-hd.com/kurashiki/shop/19/ | Store-specific selected service says smoking booth and nonsmoking seats. It is not a global icon legend. Address 石川県野々市市御経塚２ー５ retained verbatim |
| hoshino | https://www.hoshinocoffee.com/shop.html | Only the Ishikawa table's 金沢押野 row is considered: smoking booth and nonsmoking seats; 石川県野々市市押野6-6. Other stores are not copied |
| manten | https://www.manten-hotel.com/michinoyado-1/room/ | Smoking rooms before 1F bath entrance and on guest floors 2/3/4. One host facility = one candidate, not four stacked pins. The footer address 石川県野々市市柳町460番地 is retained verbatim in the corrected geocoder input and source record. Guest-floor restrictions are not converted to general public access |

All six: smoking-specific hours, general/customer-only/ticket/payment access, paper/heated support remain unknown.
A booth is not automatically an outdoor designated area or an indoor room: its environment stays unknown unless
the operator states it (Shiawase/Manten rooms are indoor). No tobacco sales, gambling offers, promotions or equipment
catalogues are stored. Necessary facts, provenance and addresses only. Facility addresses never become exact pins.

The 12 HTTP receipts in `fetch-ledger.json` are HTTP200 with UTC fetch time, byte length and whole-page SHA-256.
Raw HTML remains outside git at task-specific /private/tmp paths. No article prose, photos, floor maps or logos are
committed. Copyright/privacy observations are provisional; absent information-use prohibitions do not imply approval.
Manten and Hoshino need fuller applicable-terms review. Every source remains absent from REVIEWED_SOURCES.

## P-WORLD and other restricted leads

The user-supplied Sanmarco page was checked first and displayed indoor smoking-room information. The other supplied
pages were inspected before exact terms were located. Once restrictions were read, further extraction stopped.
P-WORLD https://www.p-world.co.jp/_info/user/rules1.htm Articles6–8 and
https://www.p-world.co.jp/PWcopy.htm prohibit unpermitted data collection, secondary/business information use and
restrict deep links. Store management of a page is not a transferable licence. No P-WORLD rows, addresses, hours,
coordinates, equipment data or fixture are copied into intake. `survey.json` keeps inspection decisions and user lead
identities only; it is not a P-WORLD database. User-provided lead URLs are references for permission follow-up.
Homerun's independent operator page supplies its fact, not the hosted page.

Yuzu Arimatsu's own operator terms https://www.monogatari.co.jp/about/ and Kaikatsu's member terms
https://www.kaikatsu.jp/guide/use_002.html Article13 have information-use restrictions needing permission/scope review;
these stay discovery references, not facts/receipts. Fukufukutei's operator page was visible through Web but a direct
request returned403; no further direct fetch was made, no raw page copied and no canonical source prepared.

## Actual address-anchor attempt (not accepted positions)

The existing ADR-0018 address-anchor path was used unchanged, with the same abr-geocoder2.3.1 and Node23.3.0.
The default8-worker download failed with SQLITE_BUSY before ZIPs. A fresh directory with the CLI's supported `-t 1`
completed successfully. No tool/package patch, retry around gates, fuzzy matching or fallback map coordinates.

```sh
abrg download -d /private/tmp/kanazawa-south-abr-serial -c 172014 172120 --keep -t 1 --silent
abrg /private/tmp/kanazawa-south-abrg-input.txt -d /private/tmp/kanazawa-south-abr-serial -f json
```

Actual download:15 ZIPs for Kanazawa172014 and Nonoichi172120. `abr-manifest.txt` is the name-sorted list of each
ZIP SHA-256; its own SHA-256 is `7be5d250d29e1fb3befc00b5578b10406b4ba225ade172eb5b1148626a77014d`.
New release registered append-only in address-anchor.ts:
`abr-kanazawa-nonoichi-2026-10-26:sha256:7be5d250d29e1fb3befc00b5578b10406b4ba225ade172eb5b1148626a77014d`.
Tokyo's existing release and points are untouched. ZIP/CSV/SQLite caches are not committed.
This registration pins dataset identity/scope, not source approval or new coordinate levels.

`address-candidates.json` gives the exact geocoder input and jurisdiction. `abrg-output.json` is the six genuine
responses in that order; `abrg-residential-output.json` is a separate explicit-residential run used to check whether
default parcel ranking hid eligible points. Neither run has an eligible residential_detail/block result.
The facts' exact position is unknown/null; raw rejected geocodes are separate research evidence and never anchors.

| Input | Actual coordinate level | Existing gate result |
| --- | --- | --- |
| homerun | parcel | precisionTooLow + unmatchedRemainder |
| shiawase | parcel | precisionTooLow + unmatchedRemainder |
| hikousen | machiaza | precisionTooLow + unmatchedRemainder |
| kurashiki | parcel | precisionTooLow |
| hoshino | machiaza_detail (match=parcel) | precisionTooLow + coordinateCoarserThanMatch |
| manten | parcel | precisionTooLow |

`anchor-review.json` was generated by existing `address:anchors evaluate ... --dataset ... --release ...`, which verified
the real ZIP count/digest and then refused all six. The explicit residential run also remains reviewPending.
No parcel, town point or coarse result is relabelled areaApproximate. Exact pins cannot be generated from addresses.

Research geocode attribution: 「アドレス・ベース・レジストリ」（デジタル庁）を abr-geocoder2.3.1 で加工して作成。
https://www.digital.go.jp/policies/base_registry_address_tos applies PDL1.0 and requires source/processing indication;
its §1.3 additionally identifies 法務省「登記所備付地図データ」 for parcel data. Existing ADR-0011 records both sets of
conditions; underlying G空間 terms could not be re-fetched this session (403), and these parcel results are not used
for publication. abr-geocoder is MIT; no new production dependency or new licence approval is introduced.

Government host-point fallback was also checked: Nonoichi's official tourism CSV (8 rows) and AED CSV (59 rows),
linked from https://www.city.nonoichi.lg.jp/soshiki/10/155.html , plus its official CKAN tourism resource. None lists
these six hosts. No nearest unrelated POI or AED point was substituted. The tourism resource is
https://catalog-data.city.kanazawa.ishikawa.jp/dataset/172120-tourist . The municipal CC BY4.0 grant does not create
missing points or smoking evidence.

## What unblocks each record

Keep source rights and position separate. For every record, obtain either (a) a publisher-stated numeric facility
point with reviewed reusable provenance, (b) a legitimate reviewed government host reference point, or (c) an
eligible address geocode. A smoking room's own point would instead require explicit smoking-point semantics.
Only then implement a source-specific adapter/immutable fact fixture and registry/quality review. G5 legal/shipping
approval remains the maintainer's decision; no agent grants it here. Unknown access/tobacco/hours remain unknown.
The existing station/museum/castle four are distinct by name, source, host and address, with no merge/ID edits.

`survey.json` separates28 investigated hosts,12 equipment observations (9 independent operator+3 restricted hosted
listings),12 unconfirmed hosts and4 explicit nonsmoking exclusions. Investigation count is not a smoking-place
count. The20-new-equipment-candidate target was not reached; no negative/legend/old listing is added to reach it.

## Reproduce intake and tests

Node>=24 from services/api, replace LABEL with homerun/shiawase/hikousen/kurashiki/hoshino/manten:

```sh
npm run source:intake -- --metadata ../data-pipeline/research/official-source-intake/kanazawa-south/LABEL-receipt.json \
  --file ../data-pipeline/research/official-source-intake/kanazawa-south/LABEL-facts.json --format json \
  --out /private/tmp/LABEL-new-intake.json
```

Use fresh output paths. `kanazawa-south-intake.test.ts` checks actual data/digests, six gate refusals, no source registry
mutation and unchanged existing fixture-corpus IDs/full tile bytes. Source intake is receipt preparation, not raw
canonical ingestion; no test-only adapter is misreported as a production importer. No Cloudflare/D1/promotion command
or external inquiry was run. Full test commands/results are in the linked research report and PR.
