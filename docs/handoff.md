# Handoff - droplet relays mon-2 + mon-3, Mon 12 Oct 2026 (clock ~07:00Z)

## Live (PROD)
- main = 4e96909 (mock-presets merged d609d56: saved NBA league setups, migration 139 on PROD,
  verified with a throwaway PROD user, deleted; app_errors clean 30 min). Vercel + poller at 4e96909.
- NBA MOCK DRAFT v2 at sportsvyn.com/mock/nba (public, signed out):
  - Setup dropdowns (8-14 teams, slot, clock), ESPN-style / Yahoo-style points or custom,
    ESPN / Yahoo standard roster or custom; settings saved (account or browser) + Reset.
  - ADP (default) / SVP sort, player card, Out badge, Auto-draft (picks like the bots) + Restart,
    grade = rank by projected season points. Finished mocks recorded anonymously.
  - SVP = projected FP/G (age <=25 last season only; 26+ 70/30) x age curve x 75 games.
  - Migration 138 on PROD + DEV (ledgered). PROD pool rebuilt 01:08Z (531, 18 Out); ADP imported
    (426 of 500 matched). MOCK_ADP_SOURCE unset = on; set it to off to hide ADP (no redeploy needed
    beyond the env change). Cron rebuilds the pool daily 10:41Z (re-reads injuries).
  - SV ADP: accrue nba_mock_drafts to ~300, then build (plan in docs/reports/2026-10-11-mock-nba-2.md).
- NFL mock card fixed (readFileSync font; guard lib/brand/cardFont.test.mjs).
- Game Drafts primetime only (BOARDS on, NBA off). Test prefixes dgtest-, dgnba(test)-; shots dgshot-.

## HOLDING-FOR-GO
- mock-nfl-2 (mon-3) @ 45f99f0, suite 6434/6434, preview READY, shots sent. /mock/nfl on the NBA
  engine. Report docs/reports/2026-10-12-mock-nfl-2.md (on the branch).
  - DEV has migrations 140 + 141 (nfl_mock_pool; sport columns; nba_mock_settings restored to one row
    per user by 141 - 140 alone broke main's NBA save on DEV). DEV nfl pool built from PROD data.
  - AT GO: apply 140 + 141 on PROD together; merge; reset parity-intent; deploy Vercel + poller;
    build the PROD pool once (lib/mockNfl/pool.js); verify /mock/nfl signed out.
  - Open: /sim itself not redirected (doors re-pointed); ADP is the 9 Sep board (boards shrink in season).
- draft-look @ d8d65ee (main merged), suite 6430/6430 on 7d2bf4e, preview READY, shots sent.
  Report docs/reports/2026-10-12-draft-look.md: 5 look differences vs the mock for Derik to rule.
  Ship window: before week 7 drafting gets busy.

## TUE 13 OCT - still owed (the games had not been played when tue-1 ran)
1. Sunday review of the 14 Game Draft boards: all settled? spot-check 3 rooms (best 3, no-shows
   0); app_errors since Sat 10 Oct 21:52Z.
2. Weekly Draft week 6 settled clean.
4. docs/launch-oct20.md checks 1-5 after the 13:23Z board job.

## Needs Derik
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
- PROD SELECTs hit the "Production Reads" check; ask Derik per read, never writes.
- neon: `interval ${'..'}` is a syntax error; route files export no helpers; card fonts via readFileSync.
- DEV: draft contest id 55759 (week 99, made 7 Oct by a test) shadows the current weekly contest;
  the orphan sweep lists 3,779 old test users. Listed only, nothing deleted (list + undo first).

## Next step
Derik's GO on mock-nfl-2 and draft-look (steps above). Tue 13 Oct: items 1, 2, 4 above.
