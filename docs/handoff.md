# Handoff - droplet relays sun-3 / sun-4 / sun-5, Sun 11 Oct 2026 (clock ~17:30Z)

## Live (PROD) - unchanged this relay
- main = 3ca0729 + docs. Game Drafts are primetime only (TNF/MNF/weekday games); switches
  DRAFT_GAME_BOARDS=on, DRAFT_GAME_NBA=off. The 14 week-5 boards (ids 58-71) settle normally.

## HOLDING-FOR-GO
1. mock-nba (sun-5, PRIORITY, target ship Thu 15 - Fri 16 Oct). /mock/nba is a public,
   indexable NBA mock draft, playable signed out.
   - Code head 9a11c8c, suite 6408/6408, preview READY. Shots and report:
     docs/reports/2026-10-11-mock-nba.md.
   - ON GO: apply 137 on PROD (DATABASE_URL="$PROD_DATABASE_URL" scripts/apply-migrations.mjs
     137_nba_mock_pool.sql), merge, deploy, then build the pool once (the cron, or wait for
     10:41Z).
2. draft-look (sun-3) - HELD by sun-5.
   - Head 0039287, suite 6404/6404, pushed.
   - Not done: the preview check and the shots.
   - Shared header / seat strip / pool row / result; the weekly room in the new look
     (components/draft/RankedRoom.js); weekly results on the shared result screen.
   - Ships after 20 Oct (ruled).

## Findings
- The NFL mock share card (app/sim/draft/[id]/card/route.js:28) loads its font with
  fetch(new URL(..., import.meta.url)). That is "not implemented" on Vercel's Node runtime
  (seen on the NBA card's preview), so it is very likely 500ing on PROD now. One-line fix:
  readFileSync, as app/daily/[date]/card does. Not touched.

## TUE 13 OCT - still owed (the games had not been played when tue-1 ran)
1. Sunday review of the 14 Game Draft boards: all settled? spot-check 3 rooms (best 3, no-shows
   0); app_errors since Sat 10 Oct 21:52Z.
2. Weekly Draft week 6 settled clean.
3. (done) League formats - superseded by sun-4: docs/reports/2026-10-11-leagues-phased.md.
4. docs/launch-oct20.md checks 1-5 after the 13:23Z board job.

## Needs Derik
- GO on mock-nba.
- Leagues (sun-4 report):
  - P1 total points: every drafted player, or the best N per week?
  - Bots in 4-7 team leagues?
  - LIVE sync: polling or SSE?
  - K/DST in the presets?
  - Sizes: P1 22-28 d; P2 25-35 d; P3 12-18 d.
- From wed-7 (PROD writes): the 2 unclaimed guest rows; one real magic-link sign-in.
- From wed-4: Neon "ci" key, Cloudflare token, PROD crew_reader role.

## Queue
1. 20 Oct: launch-oct20.md checks 6-13. NBA Game Drafts stay OFF until DRAFT_GAME_NBA flips.
2. After 20 Oct: draft-look (above), then leagues P1 (slow draft first).
3. Per-game S5 CFB final-only.
4. TICKET: suite tests that mutate real DEV boards (the week-5 void_all) must use own fixtures.
5. FCS abbreviation fill, 9 colourless CFB schools, morning email gameOfTheDay.

## Notes
- Test-owned prefixes: dgtest-, dgsettle(test)-, dgnba(test)-. Manual sentinels: dgshot-.
- PROD SELECTs hit the "Production Reads" check; ask Derik per read, never writes.
- neon tagged template: `interval ${'..'}` is a syntax error; write the literal.
- A Next route file must not export helpers; a card font is read with readFileSync.
- Scheduled: CFBD quota wiring not before 12 Oct; CFB win-prob re-score 26 Oct.

## Next step
Derik: GO on mock-nba. Tue 13 Oct: items 1, 2, 4 above.
