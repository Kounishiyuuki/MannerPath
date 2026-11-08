# 地番原規約の確認記録 — 正式承認ではない

原文取得と運営者によるcanonical採用承認を分離する。`PARCEL_TERMS_REVIEW`はnullのまま。

- ABR適用関係: https://www.digital.go.jp/policies/base_registry_address_tos
- 公開元: https://www.tellusxdp.com/ja/catalog/data/terrestrial-data/aigid-moj.html
- 同ページのAIGID提供データ「利用規約」から直接たどった原文: https://www.tellusxdp.com/docs/api-service/aigid-moj/tos.pdf
- 取得2026-11-08T05:00:34Z、HTTP200、2頁、141,976 bytes、原文の制定日2023-01-23。
- SHA-256: `275914c735b19cc7a274a13aac22e0c08378269d9d80f26f6b285aca32367b99`。
- Last-Modified 2026-10-27は配信更新日時で、本文の制定日・最新版の証明ではない。

取得した原文の冒頭は商用利用、複製、公衆送信、翻訳・変形等を許容する。
第1項は出典表示と、加工時の加工・主体表示、国が加工版を作成したとの誤認防止を要求する。
再配布には複製・公衆送信許容の根拠があるが、その他の条項を含めて従う必要がある。
ODbL型のshare-alike義務はこの原文に見つからず、一部準拠する政府標準利用規約とCC BYを同一のライセンス名として転記しない。
第2–3項には利用制限の裁量、法令違反・不正目的・提供妨害・個人情報収集や照合による特定個人の識別・財産/privacy侵害等の禁止がある。
第4–6項は準拠法・管轄、免責・変更削除、データ時点・精度の違い等を定める。筆界、入口、喫煙室の正確な位置を保証する資料ではない。

GSpatial・法務省の正本ページは今回403で取得できず、取得した公開原文と現在の正本の完全同一性は未確認。
アクセス制限を回避していない。正式な採否・適用範囲・最終creditの判断は運営者に残す。

候補データの公開研究用保存は、上記の複製・公衆送信・加工条項を技術的に確認し、出典・加工表示を付けた範囲。
法的保証や運営者の正式承認ではない。候補の数値はcandidate列に置き、承認済みanchorとして使わない。
規約条件、データ版、元出力、所在地付近という意味を保持し、個人を識別する照合・用途には使わない。

詳細の機械可読根拠とcredit案は`terms-evidence.json`。
承認者・正式確認日・承認済みcreditを仮入力せず、registry・共通adapter・公開タイル・production/stagingへ接続しない。


## Followup: canonical identity and distribution lineage (2026-11-08)

The earlier 403 is a historical observation, superseded by a successful ordinary public CKAN metadata/resource GET. The canonical GSpatial PDF is byte-identical to the Tellus copy (141,976 bytes; checksum in canonical-terms-receipt.json). Tellus/AIGID hosted the corroborating terms copy, not the coordinates used here. The actual provider is Digital Agency ABR. All four current official master/position ZIP downloads match the cached ZIP checksums (data-lineage.json).

The local snapshot label, acquisition date and catalog update dates are NOT the original MOJ XML map edition or survey date; the latter remain unknown. ABRG projects the ABR EPSG:6668 representative point to WGS84; it does not survey an entrance/smoking room or compute a new centroid. rep_scale is not an error radius; efct_date is not survey vintage. Legal parcel extents remain unconfirmed. Kurashiki still has weaker spatial context and needs an explicit location decision.

The retrieved terms conditionally support commercial use and address matching/projection (processing), coordinate storage (reproduction), and API/tile/offline/Watch distribution (public transmission/copies). Source and processing/processor credit, no governmental endorsement, and prohibitions on identifying-person combinations and rights/privacy infringement remain applicable. Catalog CC BY metadata does not replace ABR PDL and additional MOJ conditions. The terms-document catalog gfdl field is not the coordinate license. The corrected credit draft in terms-evidence.json supersedes earlier non-executable credit drafts; all executable fixtures and reviews must be regenerated after approval. This is an engineering reading, not owner approval.

All 13 facility documents were refetched HTTP200 with unchanged bytes (facility-followup*.json). Kurashiki has a smoking booth; noncustomer/purchase-only access remains unknown. Manten: distinguish the first-floor room from floors2-4, where nonguests cannot enter guest floors; first-floor daybath/smoking-only permission remains unknown. Kokusai: smoking facilities are documented; shuttle-bus nonguest restrictions must not be treated as smoking-room restrictions. Paper/heated support and smoking-room hours remain unknown for all three. No onsite operating-status verification was performed.

The #409 common adapter is merged. Adoption still requires owner license-scope/credit approval plus independent source fact/rights/location approval, candidate-to-anchor column conversion, regenerated hashes and reviewed fixtures. No factory instantiation or source registration occurs here. PARCEL_TERMS_REVIEW remains null: approved anchors 0, production additions 0.
