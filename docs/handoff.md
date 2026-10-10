# Handoff - droplet relay sat-1, 10 Oct 2026

## Live (PROD)
- main = f9d437f: the draft-game-s2 merge (82279ea) plus parity-intent emptied. Vercel prod READY
  at f9d437f; poller deployed head=82279ea (previous ecca1e9).
- PER-GAME DRAFT IS ON. DRAFT_GAME_BOARDS=on on Vercel production since the f9d437f deploy.
  - The 22:33Z board cron created 14 boards (ids 58-71): every week-5 Sunday game, plus SNF and
    MNF. 0 games due without a board, 0 duplicates, every locks_at = kickoff.
  - Pools 20-30 (DET@ARI is exactly 20, the minimum).
  - The settle cron runs every 10 min, ok, nothing due yet. First settles: Sun 11 Oct, about
    3.5 h after each kickoff.
  - /draft/game, the rooms and the lobby row "Game Drafts" render on sportsvyn.com.
  - +30 min: app_errors empty, Vercel runtime errors none, 0 poller error lines.
- POOL RULE: a player must have played in one of his team's last 3 finals that have a box.
  - Spot-checked on PROD: A.J. Brown (NE, last played wk 1) and Lan Larison (NE, wk 1) are out.
    The others missing from the 3 sampled pools are near-zero scorers, cut by the projection
    floor or the cap of 30.
  - There is NO per-player injury data: BDL NFL injuries reach us only as news headlines
    (lib/wire/injuries.js), so the last-3 rule stands alone.
- DEV is clean: the 15 test boards and test user 123882 are deleted (undo file in the
  scratchpad).

## Watch (Sun 11 Oct)
1. Boards lock at each kickoff (13:30Z first). Settles land about kickoff + 3.5 h:
   `SELECT id, settled, meta->>'entrants', meta->>'score_line' FROM contests WHERE game_type='draft_game'`
2. An entry's score equals its best 3 (open /draft/game/<id> after FINAL).
3. Real breakage: set DRAFT_GAME_BOARDS=off on production and redeploy FIRST, then look.
   Existing boards still settle (settle is not behind the switch).
4. Week-6 boards appear 72 h before each kickoff (TNF first), made by the :33 cron.

## Needs Derik
- From wed-7 (PROD writes): the 2 unclaimed guest rows; one real magic-link sign-in.
- From wed-4: Neon "ci" branch/key, Cloudflare token. PROD crew_reader role (crew turn).

## Queue
1. 13 Oct after 13:23Z and 20 Oct: docs/launch-oct20.md (PROD reads need approval).
2. Per-game: S3 NBA (from 20 Oct is ruled; pool from lib/six/pool.js incl. injuries), S4 retire
   the weekly Draft after one clean NFL week (this one), S5 CFB final-only, S6 League A, S7 B.
3. TICKET: suite tests that mutate real DEV boards (the week-5 void_all) must use own fixtures.
4. FCS abbreviation fill, 9 colourless CFB schools, morning email gameOfTheDay.

## Notes
- Vercel production env values come back EMPTY from `vercel env pull` (sensitive by default), so
  a value is proven by behaviour (the cron's summary), never by a pull.
- Test-owned prefixes: dgtest- (draftGame.db), dgsettle-/dgsettletest- (settle.db). Manual
  sentinels: dgshot-.
- apply-migrations targets PROD via DATABASE_URL="$PROD_DATABASE_URL" (no --prod flag).
- neon tagged template: `interval ${'..'}` is a syntax error; write the literal (bit twice more).
- Headless Chromium: LD_LIBRARY_PATH=~/projects/travault/scripts/vendor/chromium-libs/usr/lib/
  x86_64-linux-gnu; playwright at ~/.npm/_npx/705bc6b22212b352.
- Scheduled: CFBD quota wiring not before 12 Oct; CFB win-prob re-score 26 Oct.

## Next step
Sun 11 Oct: watch the first locks and settles (Watch 1-3). Then S3 NBA per-game.
