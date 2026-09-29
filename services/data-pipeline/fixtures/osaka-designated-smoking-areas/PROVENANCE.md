# Osaka designated smoking locations — reviewed first release

Publisher: 大阪市. Official catalog and license offer:
https://www.city.osaka.lg.jp/toshikeikaku/page/0000250227.html (item 14).
Download:
https://www.mapnavi.city.osaka.lg.jp/osakacity/osakacity/opendatafile/map_1/CSV/opendata_1012.csv

The file is the complete, unmodified official UTF-8 CSV, fetched 2026-09-28T09:06:31Z.
242493 bytes; SHA-256 `f58b62791396bc46ceca436a7c4ad598520a5c9dd4162b37723ef519399e69ce`.
HTTP Last-Modified: `Sat, 26 Sep 2026 14:06:05 GMT`; retrieved twice with identical bytes.
The fixture-local `.gitattributes` disables text conversion and textual diff for the CSV so
Git preserves its original CRLF and embedded LF bytes on every checkout.
No record/dataset observation date is provided. `observedOn: null` is intentional.

## License evidence

The catalog explicitly applies CC-BY to its listed datasets. Its CC-BY image has the original
href `http://creativecommons.org/licenses/by/2.1/jp/`; follow this source-specific link rather
than guessing 4.0 from the general site policy or the explanatory CC Japan page. Reviewed deed:
https://creativecommons.org/licenses/by/2.1/jp/ ; binding terms:
https://creativecommons.org/licenses/by/2.1/jp/legalcode . §§3–5 permit sharing and derivation
with credit, title, original URI, license URI and unchanged notices, without conflicting access
restrictions. No share-alike requirement on the combined database. The public attribution retains
the catalog's disclaimer and marks MannerPath's extraction/normalization. Exact approved text,
review conclusion, geographic scope, update behavior and automation limits: `docs/SOURCES.md`.

## Raw and normalized mapping

All 524 raw rows are ingested unchanged with original ordinals. The header has **two** `分類`
columns (positions 5 and 15); index-based mapping preserves both. Schema, category and agreement
of those columns are checked. Only exact `大阪市指定喫煙所` classifications pass the scope rule:
344 rows. 126 `情報提供喫煙所` rows (including customer-only venues) and 54 `古紙回収協力店`
rows produce neither observations nor source entities nor canonical spots. No host-name inference.

| Output | Raw columns / reviewed rule |
|---|---|
| existence / active lifecycle | カテゴリ + both 分類 values explicitly identify a city-designated smoking location; `osaka.designatedListing.v1` |
| name | 施設名称 verbatim, empty → NULL |
| location | 経度 (position 13) / 緯度 (position 14), strict decimal degrees and geographic ranges. Catalog specifies JGD2011 map-icon positions; map-display use without inferred entrance accuracy |
| openingHours | 供用時間 subsection of 詳細情報, verbatim schedule retained as `unparsed`. Missing/empty → `none`; no holiday, overnight or open-now inference |
| tobacco support | unknown; no blanket assumption from the designation |
| physical type / access / environment / host | unknown/unresolved in this slice; physical-format text, address, commercial URLs and contact information remain raw evidence only |
| lastVerifiedAt | NULL, because the publisher states no evidence observation date |

The adapter fails closed on a different hash, URL, observation date or selected-record count.
Only one real release is reviewed: completeness is partial, cross-release matching is disabled,
and scope omission is not removal evidence. There are no external attenuations for this fixture.
The ordinary city smoking page is scope context only, not a second source of values.
