# footballdb corpus work — session summary (2026-09-04)

SCOPE: fixed the footballdb (1980-2001) historical stat corpus feeding
The Daily v2's season-roster board game — position inference, identity
resolution, team-key duplication, and a stray test-data cleanup.
Branches: footballdb-2000-2001, positions-unk. Merged to main in two
GO'd steps; PROD updated via migrations only (no PROD ingest yet).

## What changed

1. **Ambiguous identities are now stored, never attached**
   - migrations/092: matched_by CHECK widened to add 'created-ambiguous'
   - A footballdb name colliding with 2+ existing players now mints its
     own new player row instead of being silently dropped
   - lib/footballdb/identity.js: resolveAndPersistIdentity() consolidates
     resolve+write in one place

2. **Position law amended twice this session**
   - RB vs WR decided by touches (rushAtt vs rec), not scoring points
   - No touches at all + a real pass attempt still means QB, regardless
     of the old 100-attempt floor (fixes backup QBs who went 0-for-1)
   - lib/daily/inferPosition.js

3. **Retroactive position recompute** (the served board reads a STORED
   column, never recomputes live — every law change needed its own pass)
   - migrations/093 + migrations/094, scripts/footballdb-position-recompute.mjs
   - Scope: footballdb rows where the linked player has no BDL id, OR
     that player's own stored position is UNK/null/empty
   - Fixed Harvey Williams 1995 (was QB, now correctly RB) — DEV and PROD
   - Fixed Jerry Rice **on DEV only**: DEV's copy of his linked BDL
     record carried position='UNK' — BDL had a row for him but never
     tracked what he played — silently excluding him from every board
     since the corpus existed. Recomputed to WR on DEV, confirmed as
     SF's standout (412pts). **PROD's own copy of Jerry Rice already
     read WR before any of this session's writes** — this specific
     defect never existed on PROD, confirmed by reading his row
     directly (same bdl_player_id, different position, on the two
     databases) before writing anything. Applying 094 to PROD changed
     0 rows, exactly as expected once that was known — PROD's Jerry
     Rice was never broken, so there was nothing there to fix.
   - Deleted 17 rows on DEV and 17 on PROD that had zero real
     production in any tracked stat (leftover from an older, broken
     law) — not season lines, artifacts
   - Explicitly did NOT touch rows joining a REAL non-skill position
     (DE, CB, G, LS, etc.) — 345 such PROD rows are very likely a wrong
     identity (a modern same-name player), not a stale position. Left
     alone, sized and reported, held for a future relay.

4. **team_key duplication bug found and fixed**
   - Root cause: the ingest always wrote the raw team name; a separate
     one-off script abbreviated it afterward; every re-ingest since then
     inserted a fresh duplicate instead of updating in place
   - lib/footballdb/teamKey.js: canonicalTeamKey(), the one function that
     now decides team_key's stored form, wired in before the ingest's
     conflict key is built
   - Collapsed 8,482 same-team duplicate rows on DEV (confirmed byte-
     identical stats before deleting any of them); PROD never had this
     defect (confirmed independently, read-only)
   - New regression test: no (player, season) pair may resolve two rows
     to the same canonical team

5. **2000 and 2001 seasons ingested** (DEV only — held on PROD until the
   Sep 8 edition exists there)

## Result

- DEV corpus: 33 eligible seasons (was 31), clean of duplicates,
  positions current under the latest law
- Generator completability: 100% (200/200) on 1982, 1995, 2000, 2001,
  with real ceiling ranges reported for each
- PROD: migrations 092–094 applied; 1980-1999 board draws are now
  safe (Harvey Williams and similar defects fixed live on PROD too).
  2000/2001 ingest and the ambiguous/dedup work remain DEV-only, held
  for the Sep 8 gate.

## Deploys

- c41a58c → 014d052 → a20e31e (each merged --no-ff, pushed, verified
  Ready on Vercel, confirmed by commit SHA in the build logs)
- sportsvyn.com/daily/board?season=1995 verified 200 after each deploy

## Cleanup

- Deleted a stray leftover test-fixture row on DEV (leagues id=902,
  'pickemtest2-cfb') that a network-interrupted test run left behind
  mid-session — confirmed zero dependents before deleting.
  lib/pickem/entryFlow.test.mjs now passes clean, 9/9, twice.

## Still held

- The 2000/2001 (+ ambiguous-identity + dedup) ingest to PROD — waits
  for the Sep 8 edition to exist there
- The 345-row non-skill-position identity leak on PROD — sized, not
  fixed, its own future relay
- sportsvyn-daily-tick.timer — confirmed disabled/inactive throughout
