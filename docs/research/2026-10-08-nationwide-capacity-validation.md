# Nationwide capacity validation — 2026-10-08

現行read APIは100kの集中分布でも成立した。ただし全国対応全体を無条件にREADY NOWとは判定できない。**sparse 50k/100kはpromotionの全tile metadata上限、extreme 10kは113 parts中index 100–112がHTTP400で取得不能、extreme 50k/100kは128 parts/tile上限で拒否された。** API、production schema、Appleコード、productionデータは変更していない。

[Summary JSON](2026-10-08-nationwide-capacity-validation.json)は集約値だけを保持する。DB、SQL、corpus、Wrangler stateは一時ディレクトリに置き、Gitへ含めない。これはsynthetic spatial/capacity evidenceであり、喫煙場所のproduction evidence、実際の全国coverage、remote D1の性能保証ではない。

## 判断と最初のbottleneck

| Corpus | 分類 | 根拠 |
| --- | --- | --- |
| sparse/1k | READY NOW (local capacity) | promotion完走; max 1 parts/tile; cold 3×3 p95 9 requests |
| sparse/10k | READY NOW (local capacity) | promotion完走; max 1 parts/tile; cold 3×3 p95 9 requests |
| sparse/50k | API CHANGE REQUIRED — promotion path | compact tile declarations > 8 MiB; read API endpoint変更は不要 |
| sparse/100k | API CHANGE REQUIRED — promotion path | compact tile declarations > 8 MiB; read API endpoint変更は不要 |
| concentrated/1k | READY NOW (local capacity) | promotion完走; max 1 parts/tile; cold 3×3 p95 9 requests |
| concentrated/10k | MEASURE MORE | promotion完走; max 2 parts/tile; cold 3×3 p95 36 requests |
| concentrated/50k | MEASURE MORE | promotion完走; max 9 parts/tile; cold 3×3 p95 92 requests |
| concentrated/100k | MEASURE MORE | promotion完走; max 17 parts/tile; cold 3×3 p95 162 requests |
| extreme/1k | READY NOW (local capacity) | promotion完走; max 12 parts/tile; cold 3×3 p95 22 requests |
| extreme/10k | API CHANGE REQUIRED — part index validation | 113 parts published, but indexes 100–112 return HTTP400 invalidTilePart |
| extreme/50k | API CHANGE REQUIRED — tile delivery/publication | tile 14/14549/6451: 50000 spots need 562 parts, above tile-parts.v1 maxParts 128 |
| extreme/100k | API CHANGE REQUIRED — tile delivery/publication | tile 14/14549/6451: 100000 spots need 1124 parts, above tile-parts.v1 maxParts 128 |

この分類のAPI CHANGE REQUIREDはarchitecture全体にmandatoryな対処があることを示し、endpoint変更を一律に要求しない。疎分布で最小の変更候補はpromotion metadataのbounded transportである。READ APIは既存契約を維持できる。READY NOWもlocalでのcapacity判定であり、production activationやremote性能承認を意味しない。

全国件数だけではtriggerを決められない。①疎分布ではtile総数、②都市集中ではviewport fan-out、③極端な密度では1 tileのpart数が先に効く。以下の値はこのDTO・source数・現在のpolicyに限定した実測値である。

## Methodology / 再現範囲

- Base main: `448d6c2`。Node `v24.21.0`、Darwin arm64、8 CPU、24 GiB RAM。
- benchmark専用SourceAdapter `synthetic-capacity-not-production`を使用。productionのSOURCE_ADAPTERS / REVIEWED_SOURCESには追加しない。sourceはblockedで作成し、実際のingestRelease → observe/resolveFirstRelease → blocked publish確認 → disposable DB内だけのsimulated approval → publishTilesを通す。schema trigger / foreign key / source / provenance guardは無効化しない。
- N件のspot、N raw records、N normalized observations、8N field provenance rows、1 synthetic source / 1 current release。hours / tobacco support / accessはunknown。元のcommunity benchmarkにあった5 reports/spot、multi-source matching、更新履歴の累積はこのmatrixへ含まない。旧50k community結果とはDTO・履歴・source構成が違うため、その時間を直接比較しない。
- sparse: 24–45.5°N / 123–146°Eの一様なbounding rectangle。海域も含む幾何的stressであり、日本の陸上分布や実在スポット分布を再現したものではない。concentrated: 東京/大阪に半分ずつ、各0.12°四方。extreme: 全N件が同じz14 tile、0.006°幅のjitter。固定seed 151152、名前/IDもdeterministic。
- 各size × distribution × phaseは新規子プロセス。ingestion / publication / tile metrics / promotionのRSSが前のsizeのhigh-waterを継承しない。phase peakはstartupとそのphase内の操作を含む。拒否後のboundary/zoom診断を含む総RSSと診断前RSSは区別する。OS RSSはNodeのmaxRSS（KiB）×1024。wall timeはこの共有Macでの診断値でありdedicated-host throughputではない。
- DB sizeはcheckpoint後のpage_count × page_size。index sizeはdbstatのindex page合計で、summaryにingestion時のindex別bytesも残す。source DBとfinalized target DBを分ける。
- promotionは実際のv4 export / verify / import-plan generation+verify / fresh target initialize / 全chunk import / finalize / readiness / sourceとtargetのtile hash・件数parityを検証。chunk targetは1 MiB。refusalはTileBudgetExceededと明示されたv4 metadata capacity errorだけを記録し、その他のerrorはnonzeroで停止する。
- HTTPはactual `wrangler dev --local` / workerd。production configを読まず、temporary configにall-zero DB IDと単独DB bindingを生成。remote bindingなし。generated DBをfresh local D1 stateへコピーし、manifest JSON、各selected tileの全part SHA/count、detail ID、readinessをSQLiteと照合してから測定する。extreme 10kで発見したindex 100–127のHTTP400 invalidTilePartだけは明示的なparityIssuesとして記録し、成功partのhash検証と拒否routeの測定を続ける。その他の異常は停止する。loopback以外とredirectは拒否する。
- 全重いmatrix処理が終了した後、endpointごとに50 warmup + 500 sequential samples、full body consumptionまでの時間を測定。nearest-rank p50/p95/p99（500中495番目）/max。代表tileは最大part数、detailはsynthetic ID。cold DB / random-ID / multi-user concurrency / last-mile RTT / device測定ではない。

## Ingestion / D1 / memory

| Corpus | Raw rows | Provenance rows | DB ingest MiB | DB post-publish MiB | Indexes MiB | Generate s | Ingest s | Resolve s | Ingestion peak GiB | Publish s |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| sparse/1k | 1000 | 8000 | 5.20 | 7.02 | 1.35 | 0.009 | 0.063 | 0.623 | 0.373 | 0.276 |
| sparse/10k | 10000 | 80000 | 41.89 | 60.08 | 9.70 | 0.070 | 0.648 | 6.690 | 2.467 | 2.571 |
| sparse/50k | 50000 | 400000 | 206.41 | 297.47 | 47.66 | 0.249 | 3.046 | 36.986 | 5.353 | 13.466 |
| sparse/100k | 100000 | 800000 | 413.18 | 595.24 | 95.95 | 0.710 | 6.846 | 93.005 | 5.853 | 26.817 |
| concentrated/1k | 1000 | 8000 | 5.20 | 6.16 | 1.30 | 0.008 | 0.059 | 0.656 | 0.345 | 0.176 |
| concentrated/10k | 10000 | 80000 | 41.89 | 50.25 | 9.24 | 0.053 | 0.567 | 6.874 | 2.341 | 1.617 |
| concentrated/50k | 50000 | 400000 | 206.45 | 247.45 | 45.34 | 0.233 | 3.062 | 35.629 | 5.480 | 8.305 |
| concentrated/100k | 100000 | 800000 | 413.27 | 495.14 | 91.33 | 0.494 | 7.631 | 89.557 | 5.686 | 17.010 |
| extreme/1k | 1000 | 8000 | 5.20 | 6.02 | 1.30 | 0.009 | 0.058 | 0.644 | 0.342 | 0.163 |
| extreme/10k | 10000 | 80000 | 41.91 | 50.06 | 9.27 | 0.052 | 0.575 | 6.635 | 2.482 | 1.612 |
| extreme/50k | 50000 | 400000 | 206.43 | 206.43 | 42.16 | 0.224 | 2.993 | 36.620 | 6.004 | 0.684 |
| extreme/100k | 100000 | 800000 | 413.23 | 413.23 | 84.91 | 0.432 | 6.285 | 82.252 | 5.602 | 1.453 |

8-field first-release reconciliationのlarge batchはローカルoperator toolingのメモリを数GiB使う。これを128 MB Worker isolateで実行可能とは判断しない。ingestion phase peakをAPI handlerのheapに読み替えない。適切なRAMを持つlocal runnerでの測定であり、制約の小さいCIでの完走は未検証。

## Promotion artifact / roundtrip

| Corpus | Result | Artifact MiB | Chunks | Promotion manifest B | Max statement B | Target DB MiB | Promotion peak GiB |
| --- | --- | --- | --- | --- | --- | --- | --- |
| sparse/1k | complete | 6.19 | 6 | 400512 | — | 5.87 | 0.177 |
| sparse/10k | complete | 61.91 | 59 | 3963756 | — | 48.58 | 0.389 |
| sparse/50k | REFUSED | not emitted | — | — | — | — | 0.207 |
| sparse/100k | REFUSED | not emitted | — | — | — | — | 0.232 |
| concentrated/1k | complete | 4.93 | 5 | 42270 | 18030 | 4.81 | 0.170 |
| concentrated/10k | complete | 48.29 | 49 | 67787 | 65413 | 36.56 | 0.351 |
| concentrated/50k | complete | 241.68 | 243 | 192226 | 65414 | 178.96 | 0.331 |
| concentrated/100k | complete | 483.43 | 486 | 350233 | 65417 | 358.02 | 0.416 |
| extreme/1k | complete | 4.81 | 5 | 5867 | 65409 | 4.64 | 0.219 |
| extreme/10k | complete | 48.19 | 49 | 34326 | 65417 | 36.37 | 0.355 |
| extreme/50k | publish refused | not generated | — | — | — | — | — |
| extreme/100k | publish refused | not generated | — | — | — | — | — |

| Corpus | Generation s | Verify s | Plan generation s | Plan verify s | Initialize s | Import s | Finalize s | Slowest chunk s |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| sparse/1k | 3.468 | 0.268 | 0.271 | 0.282 | 0.263 | 1.059 | 0.533 | 0.207 |
| sparse/10k | 32.310 | 2.556 | 2.881 | 2.889 | 2.651 | 13.220 | 4.779 | 1.133 |
| sparse/50k | 165.105 | not run | not run | not run | not run | not run | not run | — |
| sparse/100k | 244.848 | not run | not run | not run | not run | not run | not run | — |
| concentrated/1k | 2.927 | 0.224 | 0.226 | 0.218 | 0.210 | 0.925 | 0.365 | 0.202 |
| concentrated/10k | 27.535 | 2.078 | 2.143 | 2.106 | 2.049 | 9.337 | 3.584 | 0.824 |
| concentrated/50k | 157.472 | 11.398 | 11.643 | 11.705 | 11.176 | 58.646 | 28.100 | 1.580 |
| concentrated/100k | 279.097 | 20.726 | 22.046 | 20.976 | 20.742 | 98.261 | 37.802 | 1.305 |
| extreme/1k | 2.958 | 0.221 | 0.218 | 0.213 | 0.206 | 0.915 | 0.364 | 0.199 |
| extreme/10k | 27.598 | 2.075 | 2.114 | 2.084 | 2.072 | 9.310 | 3.525 | 0.981 |
| extreme/50k | not run | not run | not run | not run | not run | not run | not run | not run |
| extreme/100k | not run | not run | not run | not run | not run | not run | not run | not run |

Artifact bytesはchunk + finalize + promotion manifestの実サイズ。refused exporterはpartial bundleを削除し、artifact / import / finalize成功を主張しない。sparse 50k/100kのAPI測定はsource DB（readiness=503/localPipeline）であり、GREEN roundtrip成功ではない。

## Tiles / density / part budgets

| Corpus | Tiles | Parts | Parts/tile p50/p95/max | Max spots/tile | Max tile manifest B | Max part SQL-literal B | Max part gzip B | Refused tiles |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| sparse/1k | 999 | 999 | 1/1/1 | 2 | 247 | 1801 | 612 | 0 |
| sparse/10k | 9940 | 9940 | 1/1/1 | 2 | 247 | 1801 | 618 | 0 |
| sparse/50k | 48923 | 48923 | 1/1/1 | 3 | 247 | 2530 | 650 | 0 |
| sparse/100k | 95936 | 95936 | 1/1/1 | 4 | 247 | 3259 | 676 | 0 |
| concentrated/1k | 97 | 97 | 1/1/1 | 24 | 249 | 17833 | 1082 | 0 |
| concentrated/10k | 104 | 171 | 2/2/2 | 174 | 353 | 65216 | 2363 | 0 |
| concentrated/50k | 104 | 613 | 8/9/9 | 756 | 1074 | 65217 | 2382 | 0 |
| concentrated/100k | 104 | 1177 | 15/16/17 | 1464 | 1906 | 65220 | 2391 | 0 |
| extreme/1k | 1 | 12 | 12/12/12 | 1000 | 1386 | 65212 | 2157 | 0 |
| extreme/10k | 1 | 113 | 113/113/113 | 10000 | 11904 | 65219 | 2188 | 0 |
| extreme/50k | 0 published / 1 candidate | not emitted | — | — | — | — | — | 1 |
| extreme/100k | 0 published / 1 candidate | not emitted | — | — | — | — | — | 1 |

Raw part budgetはSQL literalのUTF-8 bytes（apostropheの二重化込み）で64 KiB。gzipはnode:zlib default levelで16 KiB以内。DTO shapeや長い名前・出典、gzip entropyが変われば1 partに入るspot数も変わる。今回の名前は反復性が高く、実データの圧縮率を保証しない。max 250 spots/partよりbyte packingが先に効く。

| Extreme corpus | Required parts (rejected) | Last accepted spots | First refused spots | Accepted parts | Manifest B | Max raw B | Max gzip B |
| --- | --- | --- | --- | --- | --- | --- | --- |
| extreme/50k | 562 | 11392 | 11393 | 128 | 13479 | 65219 | 2185 |
| extreme/100k | 1124 | 11392 | 11393 | 128 | 13479 | 65219 | 2185 |

Boundaryは拒否されたDBの実際のcanonical rowsをspotDtoで再構成したsorted prefixを、同じsplitter / manifest / gzip checksでbinary-searchした値。公開・promotionをboundary件数で再完走した値ではない。N=50k/100kの実publish拒否と組み合わせた、DTO-specificなserialization boundaryである。universalな「約1万件」制限として使わず、128 partsそのものをtriggerにする。

## Viewport 3×3 / 5×5

全spotをoriginにした分布はspot-weighted。cold clientのsingle-partはv1 1 request、multipartは最初のv1 409 + manifest +全parts = 2+parts、unpublished tileは404 1 request。/v1/configは各loadに別途+1。bytesはdata payloadだけでheaders / 404・409 problem bodiesを含まない。gzipはtransfer model、rawはHTTPのJSON payload modelであり、実ネットワークwire bytesではない。

| Corpus | 3×3 requests p50/p95/max | 5×5 requests p50/p95/max | 3×3 p95 gzip B | 5×5 p95 gzip B | 3×3 p95 raw B | 5×5 p95 raw B |
| --- | --- | --- | --- | --- | --- | --- |
| sparse/1k | 9/9/9 | 25/25/25 | 583 | 583 | 1099 | 1099 |
| sparse/10k | 9/9/9 | 25/25/25 | 1164 | 1166 | 2197 | 2198 |
| sparse/50k | 9/9/9 | 25/25/25 | 1202 | 2333 | 2925 | 4395 |
| sparse/100k | 9/9/9 | 25/25/25 | 1755 | 2952 | 3297 | 6221 |
| concentrated/1k | 9/9/9 | 25/25/25 | 8049 | 21570 | 98075 | 246833 |
| concentrated/10k | 27/36/36 | 70/100/100 | 37871 | 99305 | 926191 | 2367684 |
| concentrated/50k | 76/92/93 | 164/245/253 | 171389 | 448274 | 4595035 | 11965376 |
| concentrated/100k | 129/162/163 | 282/426/448 | 337684 | 879183 | 9131826 | 23772765 |
| extreme/1k | 22/22/22 | 38/38/38 | 25263 | 25263 | 734267 | 734267 |
| extreme/10k | 123/123/123 | 139/139/139 | 247308 | 247308 | 7338778 | 7338778 |

Probe単位のsparse-origin / Tokyo / Osaka値とz15比較はsummary JSONに保存。cacheがwarmで全revisionが不変ならtile revalidationは9/25 requests（configを足せば10/26）、data payloadは304でゼロ。既知multipartのchanged revisionなら409を省き1+partsになる。これはcache/request modelであり、deviceのlatency・電力・実際の同時接続数の実測ではない。

### Client boundary

`NearbyModel.neighborhood`は選択中心のneighborhood3x3を作り、全tileをtask groupでrefreshする。`TileAPIClient.fetchParts`も全partをtask groupで取得する。ClusteredSpotMapは表示/camera fitting側で、可視領域から全国tileを一般的にscheduleする機構はない（read-only確認、Apple変更なし）。

schedulerが必要になるtriggerは二つ。機能面では選択中心の3×3外へpan/zoomし、そのviewportのデータを表示する時点で件数に関係なく必要。負荷面では既存researchのcold 3×3 p95≈33 requestsをreview thresholdとして使うと、今回の集中分布は10k（p95 36）で既に超え、50k/100kでは92/162となる。5×5への拡張では245/426まで増えるため、全国viewport featureを提供する前にbounded concurrency、cancellation、deduplication、priority、cache revalidationを設計・device検証すべき。read API変更を先行実装する根拠ではない。

## API latency — real local Worker

50 warmup、各route 500 samples。source DBのreadinessは503/localPipeline、finalized targetは200/completed。測定前のHTTP/SQLite parity検証を必須にし、fixture-onlyのlatencyを100kへ外挿しない。extreme 50k/100kはpublicationが成立せずmanifest/part/detail 200/304を測れないため、API cellをnot applicableとして記録する。

| Corpus | Route probe | Status | n | p50 ms | p95 ms | p99 ms | max ms |
| --- | --- | --- | --- | --- | --- | --- | --- |
| sparse/1k | readiness | 200 | 500 | 2.943 | 3.775 | 4.748 | 9.355 |
| sparse/1k | config | 200 | 500 | 2.395 | 3.031 | 5.646 | 7.112 |
| sparse/1k | tileNotFound404 | 404 | 500 | 2.838 | 3.758 | 6.37 | 8.258 |
| sparse/1k | tileSinglePart200 | 200 | 500 | 3.028 | 4.344 | 6.291 | 8.197 |
| sparse/1k | tileSinglePart304 | 304 | 500 | 2.894 | 4.353 | 6.858 | 53.029 |
| sparse/1k | tileManifest200 | 200 | 500 | 2.829 | 3.431 | 7.339 | 10.653 |
| sparse/1k | tileManifest304 | 304 | 500 | 2.633 | 3.105 | 7 | 9.358 |
| sparse/1k | tilePart0_200 | 200 | 500 | 2.755 | 3.207 | 7.343 | 12.288 |
| sparse/1k | spotDetail200 | 200 | 500 | 3.097 | 4.857 | 8.212 | 19.371 |
| sparse/10k | readiness | 200 | 500 | 3.049 | 3.98 | 4.76 | 7.251 |
| sparse/10k | config | 200 | 500 | 2.456 | 3.426 | 5.077 | 6.599 |
| sparse/10k | tileNotFound404 | 404 | 500 | 2.82 | 3.483 | 5.758 | 9.619 |
| sparse/10k | tileSinglePart200 | 200 | 500 | 3.024 | 4.075 | 6.08 | 8.727 |
| sparse/10k | tileSinglePart304 | 304 | 500 | 2.942 | 3.566 | 7.126 | 8.723 |
| sparse/10k | tileManifest200 | 200 | 500 | 2.917 | 3.452 | 6.961 | 13.581 |
| sparse/10k | tileManifest304 | 304 | 500 | 2.735 | 3.323 | 7.183 | 13.391 |
| sparse/10k | tilePart0_200 | 200 | 500 | 2.835 | 3.36 | 7.827 | 11.339 |
| sparse/10k | spotDetail200 | 200 | 500 | 3.067 | 4.866 | 10.11 | 18.618 |
| sparse/50k | readiness | 503 | 500 | 3.097 | 3.941 | 4.883 | 5.899 |
| sparse/50k | config | 200 | 500 | 2.471 | 3.547 | 5.057 | 8.013 |
| sparse/50k | tileNotFound404 | 404 | 500 | 2.881 | 3.451 | 5.574 | 10.304 |
| sparse/50k | tileSinglePart200 | 200 | 500 | 2.968 | 4.041 | 5.677 | 9.045 |
| sparse/50k | tileSinglePart304 | 304 | 500 | 2.984 | 3.523 | 7.222 | 9.704 |
| sparse/50k | tileManifest200 | 200 | 500 | 2.661 | 3.65 | 6.796 | 9.78 |
| sparse/50k | tileManifest304 | 304 | 500 | 2.784 | 3.547 | 8.918 | 10.069 |
| sparse/50k | tilePart0_200 | 200 | 500 | 2.757 | 3.466 | 7.541 | 15.437 |
| sparse/50k | spotDetail200 | 200 | 500 | 3.158 | 4.836 | 7.549 | 17.841 |
| sparse/100k | readiness | 503 | 500 | 3.066 | 3.975 | 4.73 | 5.59 |
| sparse/100k | config | 200 | 500 | 2.576 | 3.42 | 5.48 | 8.555 |
| sparse/100k | tileNotFound404 | 404 | 500 | 2.814 | 3.466 | 6.057 | 7.813 |
| sparse/100k | tileSinglePart200 | 200 | 500 | 3.008 | 4.067 | 5.909 | 7.448 |
| sparse/100k | tileSinglePart304 | 304 | 500 | 3.026 | 4.036 | 7.042 | 11.375 |
| sparse/100k | tileManifest200 | 200 | 500 | 2.74 | 3.378 | 7.698 | 11.133 |
| sparse/100k | tileManifest304 | 304 | 500 | 2.681 | 3.209 | 8.002 | 9.782 |
| sparse/100k | tilePart0_200 | 200 | 500 | 2.731 | 3.425 | 7.313 | 11.327 |
| sparse/100k | spotDetail200 | 200 | 500 | 3.042 | 4.845 | 7.198 | 17.83 |
| concentrated/1k | readiness | 200 | 500 | 2.976 | 4.059 | 5.299 | 6.873 |
| concentrated/1k | config | 200 | 500 | 2.398 | 3.839 | 5.264 | 5.901 |
| concentrated/1k | tileNotFound404 | 404 | 500 | 2.777 | 3.78 | 5.677 | 8.798 |
| concentrated/1k | tileSinglePart200 | 200 | 500 | 2.963 | 4.03 | 5.678 | 10.037 |
| concentrated/1k | tileSinglePart304 | 304 | 500 | 2.927 | 3.79 | 7.009 | 12.444 |
| concentrated/1k | tileManifest200 | 200 | 500 | 2.629 | 3.523 | 6.933 | 9.267 |
| concentrated/1k | tileManifest304 | 304 | 500 | 2.661 | 3.09 | 8.937 | 11.08 |
| concentrated/1k | tilePart0_200 | 200 | 500 | 2.69 | 3.271 | 7.464 | 12.367 |
| concentrated/1k | spotDetail200 | 200 | 500 | 3.038 | 4.552 | 7.833 | 18.379 |
| concentrated/10k | readiness | 200 | 500 | 3.032 | 4.064 | 5.786 | 8.288 |
| concentrated/10k | config | 200 | 500 | 2.492 | 3.845 | 4.84 | 7.129 |
| concentrated/10k | tileNotFound404 | 404 | 500 | 2.698 | 3.645 | 5.425 | 7.825 |
| concentrated/10k | tileSinglePart200 | 200 | 500 | 3.014 | 3.915 | 5.744 | 9.772 |
| concentrated/10k | tileSinglePart304 | 304 | 500 | 2.897 | 3.5 | 6.703 | 9.216 |
| concentrated/10k | tileManifest200 | 200 | 500 | 2.507 | 3.831 | 9.559 | 18.665 |
| concentrated/10k | tileManifest304 | 304 | 500 | 2.714 | 3.375 | 7.248 | 12.564 |
| concentrated/10k | tilePart0_200 | 200 | 500 | 2.815 | 4.946 | 7.202 | 18.45 |
| concentrated/10k | tileRequiresParts409 | 409 | 500 | 2.753 | 3.269 | 7.355 | 21.069 |
| concentrated/10k | spotDetail200 | 200 | 500 | 3.107 | 4.038 | 6.918 | 12.254 |
| concentrated/50k | readiness | 200 | 500 | 2.992 | 3.861 | 4.873 | 7.299 |
| concentrated/50k | config | 200 | 500 | 2.4 | 3.496 | 5.496 | 11.745 |
| concentrated/50k | tileNotFound404 | 404 | 500 | 2.832 | 3.969 | 5.968 | 8.339 |
| concentrated/50k | tileSinglePart200 | 200 | 500 | 3.054 | 3.939 | 5.97 | 12.652 |
| concentrated/50k | tileSinglePart304 | 304 | 500 | 3.032 | 3.605 | 6.35 | 10.302 |
| concentrated/50k | tileManifest200 | 200 | 500 | 2.706 | 3.553 | 6.824 | 9.87 |
| concentrated/50k | tileManifest304 | 304 | 500 | 2.776 | 3.37 | 8.747 | 10.111 |
| concentrated/50k | tilePart0_200 | 200 | 500 | 2.864 | 4.473 | 7.523 | 14.106 |
| concentrated/50k | tileRequiresParts409 | 409 | 500 | 2.768 | 3.288 | 7.206 | 19.245 |
| concentrated/50k | spotDetail200 | 200 | 500 | 3.101 | 4.61 | 6.815 | 16.559 |
| concentrated/100k | readiness | 200 | 500 | 3.116 | 4.207 | 5.552 | 9.681 |
| concentrated/100k | config | 200 | 500 | 2.684 | 3.91 | 5.45 | 6.156 |
| concentrated/100k | tileNotFound404 | 404 | 500 | 2.733 | 3.777 | 5.876 | 7.527 |
| concentrated/100k | tileSinglePart200 | 200 | 500 | 3.167 | 4.632 | 6.287 | 13.891 |
| concentrated/100k | tileSinglePart304 | 304 | 500 | 3.207 | 3.655 | 6.606 | 9.487 |
| concentrated/100k | tileManifest200 | 200 | 500 | 2.711 | 3.422 | 7.697 | 10.278 |
| concentrated/100k | tileManifest304 | 304 | 500 | 2.754 | 3.371 | 7.114 | 11.357 |
| concentrated/100k | tilePart0_200 | 200 | 500 | 2.856 | 4.814 | 6.794 | 11.171 |
| concentrated/100k | tileRequiresParts409 | 409 | 500 | 2.698 | 3.44 | 6.118 | 19.556 |
| concentrated/100k | spotDetail200 | 200 | 500 | 3.206 | 4.758 | 8.55 | 16.545 |
| extreme/1k | readiness | 200 | 500 | 3.026 | 3.973 | 5.026 | 7.954 |
| extreme/1k | config | 200 | 500 | 2.445 | 3.299 | 4.698 | 6.503 |
| extreme/1k | tileNotFound404 | 404 | 500 | 2.781 | 3.332 | 5.018 | 6.144 |
| extreme/1k | tileManifest200 | 200 | 500 | 2.718 | 3.696 | 5.723 | 6.338 |
| extreme/1k | tileManifest304 | 304 | 500 | 2.791 | 3.129 | 6.972 | 13.349 |
| extreme/1k | tilePart0_200 | 200 | 500 | 2.862 | 5.023 | 6.775 | 9.322 |
| extreme/1k | tileRequiresParts409 | 409 | 500 | 2.783 | 3.413 | 6.361 | 9.646 |
| extreme/1k | spotDetail200 | 200 | 500 | 3.18 | 4.638 | 7.04 | 10.509 |
| extreme/10k | readiness | 200 | 500 | 3.012 | 4.227 | 5.507 | 7.442 |
| extreme/10k | config | 200 | 500 | 2.597 | 3.76 | 4.906 | 8.022 |
| extreme/10k | tileNotFound404 | 404 | 500 | 2.637 | 4.1 | 6.028 | 10.474 |
| extreme/10k | tileManifest200 | 200 | 500 | 2.731 | 4.01 | 5.912 | 7.8 |
| extreme/10k | tileManifest304 | 304 | 500 | 2.893 | 4.169 | 7.528 | 10.152 |
| extreme/10k | tilePart0_200 | 200 | 500 | 2.861 | 5.104 | 7.479 | 12.018 |
| extreme/10k | tileRequiresParts409 | 409 | 500 | 2.834 | 3.608 | 7.309 | 10.695 |
| extreme/10k | refusedPart100_400 | 400 | 500 | 2.518 | 3.607 | 7.55 | 13.779 |
| extreme/10k | spotDetail200 | 200 | 500 | 3.127 | 4.624 | 7.39 | 16.143 |

**実HTTPで見つかった先行制約:** `src/app.ts`のpart index正規表現は0–99だけを許可する。extreme 10kのmanifestは113 partsを宣言し、index 100–112の13 requestsが400 / invalidTilePartになる。publication・promotion成功でもcomplete tile deliveryは成立しない。summaryのparityIssuesに全拒否を保存し、refusedPart100_400も500 samples測定した。今回production APIは修正していない。real canonical sorted prefixの再現診断では8,900件が100 parts、8,901件が101 parts（manifest 10,538→10,642 B、max raw 65,219 B / gzip 2,186 B）。これはこのDTOのserialization境界であり、その件数のHTTP roundtripを再実行した値ではない。`--phase tiles`のextreme診断で再現でき、summaryのhttpAddressabilityBoundaryに保存する。

readiness / config / manifest / part / detail / 304 / 404を各published size/distributionで実測した。manifestとpartはsingle-part sparse corpusでも測定した。cold-start、concurrent request load、remote SQL time、Workers CPU/heap、HTTP/2や携帯回線は未測定。locally fastであることはremote QPSやp99 SLOの証明にならない。

## Numeric triggers / 現行architectureで進められる範囲

| Concern | READY NOW範囲 / soft review | Hard trigger / classification |
| --- | --- | --- |
| Promotion metadata | 今回10k sparseはfull roundtrip。compact declarations 6 MiBで事前review（運用提案） | compact tile declarations >8 MiB or complete manifest >16 MiB → promotion architecture対処。今回first refused tile ordinal 30,284（50k/100k sparse） |
| HTTP part delivery | 現行routeでfetch可能なのはindexes0–99 / <=100 parts。96 parts以上でreview | 101 parts以上はHTTP400でcomplete delivery不可 → API CHANGE REQUIRED。今回extreme10k113partsで実測 |
| Tile density | <=128 parts、manifest<=16 KiB、raw<=64 KiB、gzip<=16 KiB。96 parts以上で実DTOとdeviceを追加測定（運用提案） | 129 parts又はpart/manifest hard budget違反 → delivery/publication architecture対処。今回extreme 50k/100k拒否 |
| Viewport | selected 3×3 / cache revalidation。cold p95<=33 requestsをreview screen（既存research） | p95>33又は全国pan/zoomで3×3外へ取得 → bounded viewport schedulerを検討。今回concentrated 10kから |
| D1 storage | Paid 10 GBと比較する実際のsource/target DB bytesを測る | quota接近時にpartition/storageを検討。今回sparse source100k=624,152,576 BはFree500 MBを超えるがPaid10 GBから遠い |
| Memory | 今回phase別processで実測。local runnerの空きRAMにheadroomを確保 | source ingestion/publishは数GiB。128 MB Workerへ移せるとは判断しない。Worker concurrent heapはMEASURE MORE |
| Latency | local route matrixのp50/p95/p99/maxは上表 | production SLO / remote concurrency / CPU / query durationが未測定なのでMEASURE MORE。local wall timeとremote30秒制限を同一視しない |

この変更でaccepted ADR / API contract / schemaは変えていない。soft review値はcapacity研究の運用提案であり、accepted product SLOではない。D1の30秒query/batch制限はremoteで別途検証が必要。local chunkの短さやfinalize完走はremote importer全体の完走を保証しない。

**安全に進められる規模:** extremeは1kがlast successful HTTP delivery、10kはAPI index制約で不可。canonical APIとv4のlocal full roundtripは100k concentratedまで検証済み（104 tiles、最大17 parts）。ただし全国viewportのclient負荷、remote deployment capacityはMEASURE MORE。全国疎分布については10kが最後の検証済みfull roundtripで、50k/100kは現在のpromotionで不可。tile数とmetadata bytesを満たす分布なら総件数100kだけを理由にread APIを変更しない。

## Limitに当たった場合の候補比較（実装しない）

| Extreme corpus | Alternative zoom | Candidate tiles | Max spots/tile | Refused tiles |
| --- | --- | --- | --- | --- |
| extreme/50k | 15 | 4 | 12596 | 4 |
| extreme/50k | 16 | 4 | 12596 | 4 |
| extreme/100k | 15 | 4 | 25146 | 4 |
| extreme/100k | 16 | 4 | 25146 | 4 |

| Candidate | 効く対象 | 今回の判断 / cost |
| --- | --- | --- |
| z15 | 地理的に広がった密度 / 小さなviewportのfan-out | extremeは上表の通り拒否が残る。sparse tile数を増やしmetadata問題を悪化させる。schema z14 CHECK migration / cache namespace / coverage trade-offが必要。採用しない |
| Bounded viewport scheduler | client concurrency / pan/zoom / cancellation / cache | request総数や128-part capを消すものではない。集中10k以上・一般viewport featureで先に検討。Appleは変更しない |
| Partitioning / bounded promotion metadata | 全tile declarationがsingle promotion artifact上限へ集中する問題 | 最小候補はmetadataの分割・streaming format/ledger。現行bundleはfresh GREEN専用なので複数bundleを同じDBへ重ねればよいとは言えない。DB shardならrouting・atomic publication・rollback設計が必要 |
| Alternate blob storage (e.g. R2) | D1 payload volume / serving throughput | tile blobをD1外へ出す候補。現行128-part manifestとrequest modelを維持するだけならdensity/fan-outは解消しない。hash/revision atomicity・cache・cost・operational比較をremoteで測るまで採用しない |

最初の対処を「全国N件だからPostGIS」に固定しない。sparseの現在の失敗はpromotion metadata transport、extremeの現在の失敗はpublication/delivery capである。part index validationの0–99 / max128不一致は別途API修正が必要であり、今回実装しない。今回のread API latencyやPaid D1 sizeには100kを理由にstorage architectureを変更する実測根拠がない。

## Reproduce

Node >=24をPATHに置き、`services/api`からfresh temporary directoryを指定する。macOSでworkerdを実行可能な環境と十分なRAM/diskが必要。成果物は数GB以上になり得る。通常のlocal D1 state / production config / remote DBは使わない。

```sh
export PATH="/opt/homebrew/opt/node@24/bin:$PATH"
npm run capacity:run -- --output /private/tmp/mannerpath-capacity-new-run
```

全12 cellsのpipelineを順番に実行してから、published cellsのactual Worker測定を行い、`summary.json`を生成する。期待されたhard-limit refusalは結果として記録する。unexpected failureはnonzeroで止まる。途中で失敗した場合は新しいoutputで全再実行するか、失敗したphaseを明示して再測定できる。

```sh
# 小さなend-to-end smoke / サイズ・分布を限定
npm run capacity:run -- --sizes 1k --distribution sparse --output /private/tmp/capacity-smoke-new
# pipelineだけ
npm run capacity:matrix -- --sizes 1k,10k,50k,100k --distribution concentrated --output /private/tmp/capacity-matrix-new
# 既存の生成DBでtile集計phaseのみ再実行（DBは変更しない）
npm run capacity:matrix -- --sizes 100k --distribution concentrated --output /private/tmp/capacity-matrix-new --phase tiles
# 生成DBに対する独立Worker測定（fresh output）
npm run capacity:worker -- --db /private/tmp/capacity-matrix-new/100k-concentrated/target.sqlite --output /private/tmp/capacity-http-new
```

本測定ではmatrixをdistributionごとに実行し、100k sparseの集計で見つかった`Math.max(...largeArrays)`の引数stack overflowを逐次max計算へ修正して、そのtile phaseを再測定した。raw bytes model追加後の既存sparse / concentrated / extreme tile metricsも再集計した。benchmark tooling errorをAPI capacity refusalに数えない。小さなfull-runの再実行とhash一致確認はvalidation欄に記す。

## Validation / scope

- `make api-validate`: PASS (exit 0); typecheck + API 893/893 + data-pipeline 78/78 tests
- `make contract`: PASS (exit 0); contract files present
- `git diff --check`: PASS (exit 0)
- `npm run typecheck`: PASS after final benchmark diagnostic edit
- `capacity:matrix`: 12/12 pipeline cells recorded; 8 full promotion roundtrips; 2 promotion refusals; 2 publication refusals
- `capacity:worker`: 10/10 published cells measured with 50 warmup + 500 samples/route; extreme10k also records 13 known HTTP400 part refusals
- `capacity:run -- --sizes 1k --distribution sparse`: PASS in fresh temp; corpusSha256 and promotion digest match primary run
- Changed: benchmark-only scripts / npm scripts、synthetic distribution config、viewport metrics / large-array accounting、focused safety/quantile/DB parity/refusal tests、this research report + summary JSON。
- API endpoint / production schema / source registry / Appleコード / production mutation: none。commit/push/Draft PRのみ。mainへmergeしない。
- Claude Session `31e42423-2b0b-45da-b3ab-26cca5dada83`で調査・初期実装を開始。session quota到達後、Codexがscope correction・レビュー修正・全matrix実行・validation・成果物を完了した。

## Primary limit references

2026-10-08確認。D1: Paid DB 10 GB / Free 500 MB、row 2 MB、statement 100,000 B、bound parameters 100、query/batch 30 seconds、file import 5 GB。[Cloudflare D1 limits](https://developers.cloudflare.com/d1/platform/limits/)

Workers: isolate memory 128 MB、HTTP CPU Free 10 ms / Paid default 30 s（configurable maximum 5 min）。HTTP wall durationとCPUは別。[Cloudflare Workers limits](https://developers.cloudflare.com/workers/platform/limits/)

Node RSS unit: resourceUsage().maxRSS is KiB。[Node 24 process.resourceUsage](https://nodejs.org/docs/latest-v24.x/api/process.html#processresourceusage)
