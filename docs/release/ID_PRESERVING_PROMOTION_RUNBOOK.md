# ID-preserving promotion input (v1.0 Tokyo additions)

Tool: `services/api/scripts/promotion-id-preserving.ts` (`npm run promotion:id-preserving`). It closes the spot-ID
blocker in [V1_TOKYO_RELEASE_PLAN.md §4](V1_TOKYO_RELEASE_PLAN.md). Running it, and every step below, adds no
publication approval: the 5 Tokyo sources still wait for the maintainer's rights sign-off (G5).

## Why a rebuild, not an append

The live DATA database is a promoted v4 GREEN. Its promoted state is sealed: on a v4-applied GREEN,
`ensureReviewedSource` fails with `promotion bootstrap is complete; promoted state is immutable` (observed
2026-10-19), so a copy of production cannot be extended in place. The tool therefore:

1. reads the snapshot read-only. It refuses unless all of these hold:
   - `integrity_check` and `foreign_key_check` are clean;
   - the schema equals this checkout's `migrations/`;
   - the snapshot is a completed v4;
   - every source has one current applied release and a reviewed fixture;
   - there are no merged spots;
   - every published spot links to exactly one source record.
2. builds a fresh local pipeline DB:
   - re-ingests each live source from its fixture. The fixture's content SHA-256 must equal the live release's.
   - gives each record the live spot ID of the same (source, release digest, ordinal, raw row digest), using the
     resolver's `newSpotId` hook.
3. adds the requested reviewed sources with fresh IDs. It refuses a collision with a live ID, a source already
   live, or a new spot within 25 m of a live published spot. Then it publishes the tiles.
4. keeps the output only if:
   - every live published spot is still published with the same ID, the same tile and a byte-identical public tile entry;
   - new spots come only from the requested sources;
   - the count matches `--expect-added`.

   Any refusal deletes `<out>.partial`, and the snapshot file is never opened for writing.

Spots that the live DB holds unpublished, and records that never became a spot, get fresh IDs. The v4 bundle
exports published spots only, so these do not reach GREEN.

## Before touching production (maintainer only; nothing below was run by Claude)

**Identity check, then separately authorized export.** Export is outside the strictly read-only checklist:

1. Find the database that the active production Worker version's `DB` binding actually points at, using
   [the administrator read-only procedure](PRODUCTION_ADMIN_GATE_PROCEDURE.md). Compare it with
   `services/api/wrangler.jsonc` at the deployed commit and the independent target; a local config alone is not
   live binding evidence. Do not assume `mannerpath-production` after a GREEN cut-over.
2. Run `npx wrangler d1 export <that database> --remote --output=<path outside the repo>/data-<date>.sql`. This
   preserves application data, but locks the database and requires D1 Write permission according to
   [Cloudflare's export permission guidance](https://developers.cloudflare.com/d1/observability/debug-d1/#error-10000-and-token-permissions).
   It needs explicit export/impact-window approval and a low-traffic window. **Never export `REPORTS_DB`** for this
   purpose: it is not an input. A D1 Read token failing here is not permission to broaden its scope automatically.
3. Convert it locally: `sqlite3 <path>/live.sqlite < <path>/data-<date>.sql`. There is no remote call after the export.

**Secrets and sensitive files.**
- Use the maintainer's approved Wrangler session, or an approved scoped token, from the shell environment.
  Metadata/SELECT uses D1 Read; export requires a separately approved D1 Write-capable session as above.
  Never write a token into a file, a command saved in the repo, a log, a PR or a chat.
- Do not share the `wrangler whoami` output or the account ID.
- Keep the `.sql` and `.sqlite` exports outside the repository (the scratch directory, not `services/`).
- Do not commit, attach or upload the exports. Delete them once the release is accepted or abandoned.
- DATA_DB holds no reports, but treat the export as internal: it is the complete canonical store.

## Local steps (Claude can run these once the snapshot file exists)

```sh
cd services/api   # Node >= 24
npm run promotion:id-preserving -- --snapshot <path>/live.sqlite --out <path>/v1-input.sqlite \
  --add chiyoda-smoking-places,chuo-park-smoking-places,chuo-private-smoking-places,shibuya-smoking-places,toshima-smoking-places \
  --expect-added 125
npm run promotion:v4:build -- --database <path>/v1-input.sqlite --dir <path>/bundle --chunk-bytes 4000000
npm run promotion:v4:verify -- --dir <path>/bundle --expected-digest <wholeBundleSha256>
npm run promotion:v4:apply-local -- --database <path>/green-rehearsal.sqlite --dir <path>/bundle --expected-digest <digest>
npm run promotion:v4:prepare-import -- --dir <path>/bundle --out <path>/plan --expected-digest <digest>
npm run promotion:v4:verify-import-plan -- --dir <path>/plan --expected-digest <digest> --expected-plan-digest <wholePlanSha256>
```

For the three reviewed Kanazawa facility sources only (割鮮のむら, 金沢市民芸術村, KKRホテル金沢 from #404) (nothing else rides along; `--add` is the whole addition):

```sh
npm run promotion:id-preserving -- --snapshot <path>/live.sqlite --out <path>/kanazawa-input.sqlite \
  --add kassen-nomura-smoking-places,kanazawa-artvillage-smoking-places,kkr-kanazawa-smoking-places --expect-added 3
```

Then build, verify, apply-local, prepare-import and verify-import-plan as above. The snapshot must be exported after
the production migrations are applied: its schema must equal this checkout's `migrations/`, so the data addition
is a separate step after the migration release, never combined with it.

If the tool refuses, stop. A refusal means production differs from the reviewed fixtures, for example a hold,
a relocation or a refresh applied only in production. A rebuild would undo that state silently. Do not work
around the refusal: report it and decide the case.

## Repeated runs and later additions

- A source that an earlier run promoted is live from then on. The next snapshot carries it, and the tool rebuilds
  it from its `ADDITIVE_SOURCES` fixture under its live IDs, like the six original sources. Requesting it again in
  `--add` is refused (`already exists in the snapshot`).
- A source ID in both `LIVE_SOURCES` and `ADDITIVE_SOURCES` is refused before anything is read (`is in both the live and the additive sources`), so neither fixture silently wins.
- Two runs on the same snapshot preserve the same live entries, but they give the new spots different fresh IDs, so
  the output and bundle digests differ. Build once, review that bundle's digests, and import that bundle. Never
  rebuild between the review and the import.
- **The six Kanazawa hotels (#411 and #417) are a second, separate promotion.** It runs on a snapshot taken after the
  3-source Kanazawa promotion is live, and it is never combined into that one:

  ```sh
  npm run promotion:id-preserving -- --snapshot <path>/live-after-kanazawa.sqlite --out <path>/hotels-input.sqlite \
    --add hotel-sanraku-kanazawa-smoking-places,hotel-vista-kanazawa-smoking-places,manten-kanazawa-ekimae-smoking-places,route-inn-kanazawa-ekimae-smoking-places,dormy-inn-kanazawa-smoking-places,smile-hotel-kanazawa-nishiguchi-smoking-places \
    --expect-added <the count from the local dry run>
  ```

  Take `--expect-added` from the dry run on the real snapshot, not from this document. On the synthetic snapshot
  it was 6, one per source. Two existing Kanazawa tiles receive hotel spots. Their earlier entries must stay
  byte-identical, and the tool checks this.

### Publication approval (G5): not recorded, so no production publication

Listing a source in `ADDITIVE_SOURCES`, or rehearsing it, is not approval. Before any remote step for a source,
the maintainer records these items for that source, in that source's PR or in the release record:
1. **Rights:** the `rightsBasis.termsReading` and `PROVENANCE.md` are accepted as factReference use (ADR-0018 D-R).
   - Dormy Inn: its terms limit works provided through the "本サービス" to private use (Art. 12) and forbid
     for-profit acts through it without consent (Art. 11). The review records both clauses as context only;
     the maintainer decides whether they apply.
   - Hotel Vista: only the public facilities page is referenced, never the reservation system.
2. **Location:** the ABR `residential_detail` anchor, with the pin at the facility's representative point
   (`areaApproximate`). The attribution names the ABR and the 公共データ利用規約. No unreviewed parcel anchor is used
   (`PARCEL_TERMS_REVIEW` is `null`).
3. **Listing:** the facility-level listing (ADR-0018 / #407) is accepted. Rooms and guest-room smoking floors are not
   listed, and guest-only areas are labelled as the pages state.
4. **Re-check:** the page is re-checked within the release window. Source health must not be red for the source.
   An objection or a new restriction from the operator moves the source to hold or withdrawal review.
5. **Release:** the digests of the dry-run bundle and plan are recorded, and that same bundle is imported.

## Production procedure (maintainer only; Claude ran none of it)

Every remote step needs the maintainer's separate authorization for that release. The order is fixed. At any
**STOP**, do nothing further and keep BLUE serving.

1. **Preconditions.**
   - The production migrations are applied, so the snapshot schema equals `migrations/`.
   - The rights sign-off for every source in `--add` is recorded.
   - `make api-validate` and `make contract` pass on the commit being released.
2. **Backup.** The live database (BLUE) is never written by this procedure. A new database (GREEN) receives the
   import. Even so, before the switch, record both of these in the deployment record:
   - the export file from the separately authorized export above, as the offline copy;
   - the Time Travel bookmark of BLUE: `npx wrangler d1 time-travel info <BLUE database>`. Time Travel is
     Cloudflare's point-in-time recovery for D1, `developers.cloudflare.com/d1/reference/time-travel/`.
3. **Dry run (local, no remote call).**
   - Run the "Local steps" commands on the snapshot.
   - Then run `apply-local` into a fresh local GREEN file.
   - Expected results: `preservedPublishedSpots` = live published, `publishedSpots` = live + `--expect-added`,
     `verify` and `verify-import-plan` are `verified`.
   - Run the local SQL checks below and the full public DTO comparison in the next section on the final local
     GREEN against the snapshot. **STOP** on any refusal, non-zero SQL count or comparison failure.

   ```sql
   ATTACH '<snapshot>.sqlite' AS l;
   -- 0: every live spot keeps its ID, coordinates, tile, name and lifecycle
   SELECT count(*) FROM l.spots a LEFT JOIN spots b USING (spot_id)
    WHERE b.spot_id IS NULL OR a.latitude <> b.latitude OR a.longitude <> b.longitude OR a.tile_id <> b.tile_id
       OR a.name IS NOT b.name OR a.lifecycle <> b.lifecycle;
   -- 0: no old tile disappears (including an empty tile)
   SELECT count(*) FROM l.tile_snapshots a LEFT JOIN tile_snapshots b USING (tile_id)
    WHERE b.tile_id IS NULL;
   -- 0: no spot ID published twice
   SELECT count(*) - count(DISTINCT spot_id) FROM tile_snapshot_spots;
   ```

4. **Apply.** Follow the release plan §4 steps 4–5:
   - create a fresh GREEN D1, migrate it, import the verified plan in order, and finalize;
   - point a staging Worker or a readiness check at GREEN.
   - BLUE and REPORTS_DB are not touched.
5. **Verify after the apply, before the switch.**
   - `GET /v1/readiness` reports a completed v4.
   - The tiles of the new spots return the new spots.
   - Obtain the actual GREEN's HTTP manifests/parts and detail DTOs through the separately authorized check
     endpoint; correlate its binding/version and completed import receipts with the fixed bundle/plan digests.
     Compare all earlier public spot DTOs and source notices, including in tiles receiving additions, using
     the same equality criteria as below. The local SQLite snippet is **pre-apply local evidence only**:
     re-reading it does not verify the remote import. Missing remote full-comparison evidence is UNVERIFIED/STOP.
     Check an unaffected live tile through HTTP too. If every old tile receives additions, record that fact
     and compare the old entries instead of inventing an unaffected tile.
   - **STOP** (do not switch, and delete GREEN at leisure) on any mismatch.
6. **Switch.** Rebind `DB` to GREEN with a deploy. Then re-run the public GET scan (`release:data-audit`), the
   source notices and `GET /v1/config` (release plan §4 step 7).
7. **Rollback.** On any failed check or user-visible fault after the switch:
   - rebind `DB` to BLUE, which is unchanged, and redeploy;
   - BLUE's bookmark from step 2 is needed only if BLUE itself was written by mistake;
   - keep BLUE until the release is accepted.

### Comparing tiles that receive additions (all checks are required)

The former `json_remove(tile_snapshots.body_json, '$.generatedAt')` equality was incorrect for additions to
an existing tile. Since migration0028 that column is a v2 **manifest**; public spots and source notices live
in `tile_snapshot_parts`. A hotel may add an entry to an existing tile, changing its count, parts and hashes.
The two changed tiles in the evidence below are synthetic results, not a prediction for production.

Use `readPublishedTiles()` to reconstruct either v1 or v2, and compare **every** earlier entry, not just names,
coordinates, a sample or a count. The id-preserving builder already compares `{tile, spot}` in full; this extra
final-GREEN check also covers missing/empty tiles, duplicate IDs, attribution and separately computed detail
DTO/provenance. Existing build/verify/apply-local/import-plan verification and the SQL checks above remain mandatory.

Run from `services/api`, Node>=24. Set `MP_SNAPSHOT`, `MP_GREEN` to the private original snapshot and **final
apply-local GREEN**, `MP_ADD` to the exact comma-separated `--add` list, and `MP_EXPECTED_ADDED` to the reviewed
integer from that snapshot's dry-run report. These are local file paths/source IDs/counts, never credentials.
Both DBs are opened read-only; only summary counts or a fixed STOP message are printed.

```sh
node --experimental-strip-types --experimental-sqlite --no-warnings --input-type=module <<'JS'
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readPublishedTiles } from './src/tiles/parts.ts';
import { readPublishedSpot } from './src/spots/detail.ts';
import { SqliteD1 } from './test/support/sqlite-d1.ts';
const opened = [];
try {
  const allowed = new Set((process.env.MP_ADD ?? '').split(',').filter(Boolean));
  const expected = Number(process.env.MP_EXPECTED_ADDED);
  assert.ok(allowed.size && process.env.MP_EXPECTED_ADDED && Number.isSafeInteger(expected) && expected > 0);
  const load = async path => {
    assert.ok(path);
    const raw = new DatabaseSync(path, { readOnly: true }); opened.push(raw);
    const db = new SqliteD1(raw), tiles = await readPublishedTiles(db);
    const byTile = new Map(), bySpot = new Map();
    for (const t of tiles) {
      assert.ok(!byTile.has(t.tile)); byTile.set(t.tile, t);
      const notices = new Map();
      for (const s of t.sources) { assert.ok(!notices.has(s.id)); notices.set(s.id, s); }
      const cited = new Set();
      for (const s of t.spots) {
        assert.ok(!bySpot.has(s.id) && s.sourceIds.length);
        bySpot.set(s.id, { tile: t.tile, spot: s });
        for (const id of s.sourceIds) { assert.ok(notices.has(id)); cited.add(id); }
      }
      assert.deepEqual([...notices.keys()].sort(), [...cited].sort());
    }
    return { db, byTile, bySpot };
  };
  const old = await load(process.env.MP_SNAPSHOT), next = await load(process.env.MP_GREEN);
  assert.ok(old.bySpot.size);
  for (const [id, entry] of old.bySpot) {
    assert.equal(JSON.stringify(next.bySpot.get(id)), JSON.stringify(entry));
    const before = await readPublishedSpot(old.db, id), after = await readPublishedSpot(next.db, id);
    assert.ok(before && after); assert.deepEqual(after, before);
    const { tile, ...detailSpot } = after.spot;
    assert.equal(tile, entry.tile); assert.deepEqual(detailSpot, entry.spot);
  }
  const addedBySource = {};
  for (const [id, entry] of next.bySpot) if (!old.bySpot.has(id)) {
    assert.ok(entry.spot.sourceIds.every(s => allowed.has(s)));
    for (const s of new Set(entry.spot.sourceIds)) addedBySource[s] = (addedBySource[s] ?? 0) + 1;
  }
  assert.equal(next.bySpot.size, old.bySpot.size + expected);
  assert.deepEqual(Object.keys(addedBySource).sort(), [...allowed].sort());
  for (const [id, t] of old.byTile) {
    const n = next.byTile.get(id); assert.ok(n);
    assert.equal(n.schemaVersion, t.schemaVersion);
    const notices = new Map(n.sources.map(s => [s.id, s]));
    for (const s of t.sources) assert.equal(JSON.stringify(notices.get(s.id)), JSON.stringify(s));
    const oldSources = new Set(t.sources.map(s => s.id));
    for (const s of n.sources) if (!oldSources.has(s.id)) assert.ok(allowed.has(s.id));
    const changed = n.spots.some(s => !old.bySpot.has(s.id));
    // ADR-0005: content changes must increase revision; rebuilding cannot silently reset it.
    assert.ok(changed ? n.revision > t.revision : n.revision === t.revision);
    if (!changed) {
      const { generatedAt: a, ...before } = t, { generatedAt: b, ...after } = n;
      assert.deepEqual(after, before);
    }
  }
  for (const [id, t] of next.byTile) if (!old.byTile.has(id)) {
    assert.ok(t.spots.length);
    assert.ok(t.sources.every(s => allowed.has(s.id)));
  }
  console.log(JSON.stringify({ preserved: old.bySpot.size, added: expected, addedBySource, comparison: 'verified' }));
} catch {
  console.error('STOP: local public DTO, notice, membership or revision comparison failed'); process.exitCode = 1;
} finally { for (const db of opened) db.close(); }
JS
```

Compare `addedBySource` with the exact per-source dry-run counts too; a total alone does not authorize a
different allocation. Manifest/part integrity, schema version, part policy and capacity are checked by the existing
v4 verifiers. `generatedAt`, hashes/ETags and part boundaries may change with a new release; old DTOs/notices may
not. ADR-0005's revision rule remains a separate required gate. The current fresh rebuild starts revisions at1;
therefore the synthetic hotel addition can pass the old entry tests yet **fail this revision gate**. Do not edit
sealed GREEN SQL, lower the assertion, or treat that as release-ready. STOP for a separately reviewed solution
if the real snapshot comparison fails. This documentation change does not implement a revision repair.

### Without a production copy

If the export cannot be taken, nothing above step 3 has been checked against production. The synthetic rehearsal
does not show any of these:
- that the live fixtures' digests equal the live releases;
- that the live corpus has no hold, relocation or merge outside the fixtures;
- the live published count, which the evidence of 2026-10-15 puts at 513;
- the live schema.

The tool refuses each of these cases on a real snapshot. Without one, the promotion is not ready.

## Evidence (synthetic, 2026-10-19)

The synthetic live DB is a sealed v4 GREEN promoted from the 6 production fixtures with random IDs: 513 published.

- `promotion:id-preserving` gave `preservedPublishedSpots 513`, `publishedSpots 638`, `tiles 94`, and added
  30/14/47/30/4. The snapshot SHA-256 was unchanged.
- build, verify, apply-local, prepare-import and verify-import-plan all passed, ending `verified`, `files 4`.
- GREEN had 638 spots / 638 published / 94 tiles / 11 sources / 1 completion.
- All 513 live IDs are in the same tile. All 125 new spots have an areaApproximate anchor.
- Tests: `test/promotion-id-preserving.test.ts`, 6 tests.
- Mutation checks were run on the guards: ID reuse, tile-entry comparison, release-digest check and the duplicate
  radius. Each mutation was killed.

## Evidence (synthetic, 2026-11-08, Kanazawa 3 and a repeated run)

The synthetic live DB is a sealed v4 GREEN from the 6 production fixtures: 513 published, 81 tiles.
- `id-preserving --add <3 Kanazawa> --expect-added 3`: `preservedPublishedSpots 513`, `publishedSpots 516`, `tiles 84`.
- build, verify, apply-local, prepare-import and verify-import-plan: `verified`, `completed`, `verified`, `files 4`.
- The GREEN had 516 spots / 516 published / 84 tiles / 9 sources / 1 completion / 1 KKR spot.
- The SQL checks in step 3 gave 0 / 0 / 0. The snapshot SHA-256 was unchanged.
- That GREEN as the next snapshot:
  - `--add kkr-kanazawa-smoking-places` was refused (`already exists in the snapshot`), with no output;
  - `--add chiyoda-smoking-places --expect-added 30` gave `preservedPublishedSpots 516`, `publishedSpots 546`.
- Before this change, the second run was refused: the snapshot carried `kanazawa-artvillage-smoking-places`, which
  had no reviewed fixture to rebuild from. The new test fails on that code.

## Evidence (synthetic, 2026-11-08, 513 → Kanazawa 3 → hotels 6)

Each stage was run through the CLI: id-preserving, then build, verify, apply-local, prepare-import and
verify-import-plan. Every stage ended `verified` / `completed` / `verified`, with `files 4`.

| Stage | preserved | published | tiles | sources | duplicate IDs | earlier spots changed | earlier tile entries changed |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| live (synthetic) | — | 513 | 81 | 6 | 0 | — | — |
| + Kanazawa 3 | 513 | 516 | 84 | 9 | 0 | 0 | 0 |
| + hotels 6 | 516 | 522 | 86 | 15 | 0 | 0 | 0 of 516 |

- Earlier spots are compared on ID, coordinates, tile, name and lifecycle.
- In the hotel stage, the 2 tile bodies that changed are the Kanazawa tiles `14/14410/6401` and `14/14411/6401`,
  which gained hotel spots. None of their earlier spot entries or source notices changed.
- The original 513 are unchanged in the final GREEN. Neither snapshot's SHA-256 changed.
- Refusals on the final GREEN:
  - re-adding KKR or Dormy Inn: `already exists in the snapshot`;
  - a live source: `not a reviewed additive source`;
  - the output equal to the snapshot: `must differ`.
- This is synthetic only. No production copy was used, so it is not production verification.
