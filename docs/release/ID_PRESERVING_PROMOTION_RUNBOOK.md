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

If the tool refuses, stop. A refusal means production differs from the reviewed fixtures, for example a hold,
a relocation or a refresh applied only in production. A rebuild would undo that state silently. Do not work
around the refusal: report it and decide the case.

## Then (maintainer only)

Follow §4 steps 4–7 of the release plan:
1. Create a fresh GREEN, import the plan, then readiness and smoke.
2. Switch the `DB` binding.
3. To roll back, rebind to BLUE.

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
