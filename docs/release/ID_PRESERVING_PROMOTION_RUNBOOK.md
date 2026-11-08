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

**Read-only operations needed.** These are the only ones:

1. Find the database that the deployed `production` Worker's `DB` binding points at. Use the `database_id` in
   `services/api/wrangler.jsonc` `env.production` at the deployed commit. Do not assume `mannerpath-production`
   after a GREEN cut-over.
2. Run `npx wrangler d1 export <that database> --remote --output=<path outside the repo>/data-<date>.sql`. This
   reads only, but Cloudflare blocks other requests to the database while an export runs, so use a low-traffic
   window. **Never export `REPORTS_DB`** for this purpose: it is not an input.
3. Convert it locally: `sqlite3 <path>/live.sqlite < <path>/data-<date>.sql`. There is no remote call after the export.

**Secrets and sensitive files.**
- Use the maintainer's own Wrangler login, or a scoped token with D1 read permission, from the shell environment.
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
- Two runs on the same snapshot preserve the same live entries, but they give the new spots different fresh IDs, so
  the output and bundle digests differ. Build once, review that bundle's digests, and import that bundle. Never
  rebuild between the review and the import.
- **#411 (4 Kanazawa hotels) is a dependency, not part of this runbook.** Until #411 is merged, those sources are not
  in `SOURCE_ADAPTERS` or `ADDITIVE_SOURCES`, and `--add` refuses them. After #411 merges, a separate PR adds its
  4 adapters to `ADDITIVE_SOURCES`, using the existing `KKR_KANAZAWA` line as the pattern, plus a test like the
  Kanazawa one: preserved N, +4, each source once. Their command is then `--add <4 ids> --expect-added 4`, on a
  snapshot taken after the 3-source promotion. It is a separate promotion; it is not combined into the 3.

## Production procedure (maintainer only; Claude ran none of it)

Every remote step needs the maintainer's separate authorization for that release. The order is fixed. At any
**STOP**, do nothing further and keep BLUE serving.

1. **Preconditions.**
   - The production migrations are applied, so the snapshot schema equals `migrations/`.
   - The rights sign-off for every source in `--add` is recorded.
   - `make api-validate` and `make contract` pass on the commit being released.
2. **Backup.** The live database (BLUE) is never written by this procedure. A new database (GREEN) receives the
   import. Even so, before the switch, record both of these in the deployment record:
   - the export file from "Read-only operations" above, as the offline copy;
   - the Time Travel bookmark of BLUE: `npx wrangler d1 time-travel info <BLUE database>`. Time Travel is
     Cloudflare's point-in-time recovery for D1, `developers.cloudflare.com/d1/reference/time-travel/`.
3. **Dry run (local, no remote call).**
   - Run the "Local steps" commands on the snapshot.
   - Then run `apply-local` into a fresh local GREEN file.
   - Expected results: `preservedPublishedSpots` = live published, `publishedSpots` = live + `--expect-added`,
     `verify` and `verify-import-plan` are `verified`.
   - Run the local SQL check below on the local GREEN against the snapshot. **STOP** on any refusal or any non-zero count.

   ```sql
   ATTACH '<snapshot>.sqlite' AS l;
   -- 0: every live spot keeps its ID, coordinates, tile, name and lifecycle
   SELECT count(*) FROM l.spots a LEFT JOIN spots b USING (spot_id)
    WHERE b.spot_id IS NULL OR a.latitude <> b.latitude OR a.longitude <> b.longitude OR a.tile_id <> b.tile_id
       OR a.name IS NOT b.name OR a.lifecycle <> b.lifecycle;
   -- 0: live tiles change only in generatedAt
   SELECT count(*) FROM l.tile_snapshots a JOIN tile_snapshots b USING (tile_id)
    WHERE json_remove(a.body_json, '$.generatedAt') <> json_remove(b.body_json, '$.generatedAt');
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
   - One live tile is identical to BLUE's, apart from `generatedAt`.
   - **STOP** (do not switch, and delete GREEN at leisure) on any mismatch.
6. **Switch.** Rebind `DB` to GREEN with a deploy. Then re-run the public GET scan (`release:data-audit`), the
   source notices and `GET /v1/config` (release plan §4 step 7).
7. **Rollback.** On any failed check or user-visible fault after the switch:
   - rebind `DB` to BLUE, which is unchanged, and redeploy;
   - BLUE's bookmark from step 2 is needed only if BLUE itself was written by mistake;
   - keep BLUE until the release is accepted.

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
