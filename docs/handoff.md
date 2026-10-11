# Handoff - droplet relay sun-6, Sun 11 Oct 2026 (clock ~18:00Z)

## Live (PROD)
- main = 3d6eb60 (mock-nba merged; code tree 93a2fbb, suite 6409/6409, preview READY). Vercel
  production at 3d6eb60; poller head=3d6eb60 (previous 3ca0729).
- NBA MOCK DRAFT LIVE: sportsvyn.com/mock/nba, public, in the sitemap (static-0.xml), title
  "NBA Mock Draft 2026 - Sportsvyn", plays signed out.
  - ESPN standard roster: PG SG SF PF C G F UTIL UTIL UTIL + 3 BN.
  - Migration 137 is on PROD (ledgered); the PROD pool was built at 17:52Z (260 players), and the
    cron rebuilds it daily at 10:41Z.
  - Verified signed out: a draft to its result, and the share card 200. +30 min: app_errors
    empty, Vercel runtime errors none on production, poller clean.
- NFL MOCK CARD FIXED (readFileSync font). Preview: 200 for the owner, 401 signed out (it 500'd
  before). PROD: 401 signed out as designed. A PROD 200 needs an owner's session.
  Guard: lib/brand/cardFont.test.mjs.
- Game Drafts primetime only; DRAFT_GAME_BOARDS=on, DRAFT_GAME_NBA=off.

## HOLDING-FOR-GO
- draft-look (sun-3), held by sun-5: head 0039287, suite 6404/6404. Not done: the preview check
  and the shots. Ships after 20 Oct (ruled).

## TUE 13 OCT - still owed (the games had not been played when tue-1 ran)
1. Sunday review of the 14 Game Draft boards: all settled? spot-check 3 rooms (best 3, no-shows
   0); app_errors since Sat 10 Oct 21:52Z.
2. Weekly Draft week 6 settled clean.
3. (done) League formats - superseded by sun-4: docs/reports/2026-10-11-leagues-phased.md.
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
- Test-owned prefixes: dgtest-, dgsettle(test)-, dgnba(test)-. Manual sentinels: dgshot-.
- PROD SELECTs hit the "Production Reads" check; ask Derik per read, never writes.
- neon tagged template: `interval ${'..'}` is a syntax error; write the literal.
- A Next route file must not export helpers; a card font is read with readFileSync.
- Scheduled: CFBD quota wiring not before 12 Oct; CFB win-prob re-score 26 Oct.

## Next step
Tue 13 Oct: items 1, 2, 4 above. Watch the NBA mock's 10:41Z pool rebuild (sync_runs source='nba-mock-pool').
