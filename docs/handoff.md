# Handoff - droplet relay mon-1, Mon 12 Oct 2026 (clock ~01:15Z)

## Live (PROD)
- main = 9bed157 (svp-v2 merged 75caf5b on top of mock-nba-2 c406de2). Vercel production + poller
  head=9bed157 (poller previous 3332e73). parity-intent reset after each merge.
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
- draft-look (sun-3), held by sun-5: head 0039287, suite 6404/6404. Not done: the preview check
  and the shots. Ships after 20 Oct (ruled).

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
- neon tagged template: `interval ${'..'}` is a syntax error; write the literal.
- A Next route file must not export helpers; a card font is read with readFileSync.

## Next step
Watch the 10:41Z NBA pool rebuild (sync_runs source='nba-mock-pool'). Tue 13 Oct: items 1, 2, 4 above.
