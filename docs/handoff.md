# Handoff - droplet relay mon-1 (clock: Sat 10 Oct late), after sat-1

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

## mon-1: items 1-3 BLOCKED ON THE CALENDAR
- The relay was briefed as Monday but the droplet clock read Sat 10 Oct 23:29Z: the 14 week-5
  boards were open (scheduled, 0 entries, none settled); the settle cron ran ok every 10 min with
  0 failed runs; app_errors since Sat 21:52Z were empty. Sunday review, the week-6 weekly Draft
  check and the S4 recon all wait for real results: re-run them on or after Tue 13 Oct.

## HOLDING-FOR-GO
- draft-game-nba (S3): NBA per-game - roster pool minus Out, last-3 once a club has a box,
  24 h boards from 20 Oct, NBA settle. Report docs/reports/2026-10-10-draft-game-nba.md.
  Code head edde16e, suite 6393/6393, preview READY. Real 20 Oct pools 30/30/26. NOTE: the switch is already ON in production, so a merge opens
  NBA boards from about Mon 19 Oct 19:00Z; say if NBA needs its own switch first.

## Watch (Sun 11 Oct)
1. Boards lock at each kickoff (13:30Z first). Settles land about kickoff + 3.5 h:
   `SELECT id, settled, meta->>'entrants', meta->>'score_line' FROM contests WHERE game_type='draft_game'`
2. An entry's score equals its best 3 (open /draft/game/<id> after FINAL).
3. Real breakage: set DRAFT_GAME_BOARDS=off on production and redeploy FIRST, then look.
   Existing boards still settle (settle is not behind the switch).

## Needs Derik
- From wed-7 (PROD writes): the 2 unclaimed guest rows; one real magic-link sign-in.
- From wed-4: Neon "ci" key, Cloudflare token, PROD crew_reader role.

## Queue
1. 13 Oct after 13:23Z and 20 Oct: docs/launch-oct20.md (PROD reads need approval).
2. Per-game: S3 NBA (from 20 Oct is ruled; pool from lib/six/pool.js incl. injuries), S4 retire
   the weekly Draft after one clean NFL week (this one), S5 CFB final-only, S6 League A, S7 B.
3. TICKET: suite tests that mutate real DEV boards (the week-5 void_all) must use own fixtures.
4. FCS abbreviation fill, 9 colourless CFB schools, morning email gameOfTheDay.

## Notes
- Vercel production env values come back EMPTY from `vercel env pull` (sensitive by default), so
  a value is proven by behaviour (the cron's summary), never by a pull.
- Test-owned prefixes: dgtest-, dgsettle(test)-, dgnba(test)-. Manual sentinels: dgshot-.
- neon tagged template: `interval ${'..'}` is a syntax error; write the literal (bit twice more).
- Headless Chromium: LD_LIBRARY_PATH=~/projects/travault/scripts/vendor/chromium-libs/usr/lib/x86_64-linux-gnu.

## Next step
Tue 13 Oct+: re-run mon-1 items 1-3 (week-5 boards + weekly Draft wk 6). Derik: GO on S3 NBA.
Scheduled: CFBD quota wiring not before 12 Oct; CFB win-prob re-score 26 Oct.
