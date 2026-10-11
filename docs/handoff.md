# Handoff - droplet relay sat-2, 11 Oct 2026 (clock: Sun 11 Oct ~01:00Z)

## Live (PROD)
- main = b70c177 (draft-game-nba merged; tree = 7858be8, suite 6394/6394, preview READY).
  Vercel production builds from it; poller deployed head=b70c177 (previous 82279ea).
- Per-game Draft, NFL: ON (DRAFT_GAME_BOARDS=on). 14 week-5 boards (ids 58-71), settle every
  10 min, first settles about kickoff + 3.5 h on Sun 11 Oct.
- Per-game Draft, NBA: merged and switched on (DRAFT_GAME_NBA=on in production; NBA boards need
  BOTH switches, NFL ignores the NBA one). Boards open 24 h before tip, never before 20 Oct, so
  the first NBA boards appear about Mon 19 Oct 19:00Z. Pool: BDL roster minus Out; the last-3
  rule applies once a club has a box this season. Real 20 Oct pools 30/30/26.
- Production env values read back EMPTY from a pull (sensitive by default): a switch is proven
  by the cron's summary (bySport.nba disabled:true/false), never by a pull.
- The sat-2 verification of the 01:33Z cron is in the report box. Wanted: NFL unchanged, 0 NBA
  boards, bySport.nba not disabled.

## TUE 13 OCT - DO THESE (they could not run on Sat 10 Oct: the games had not been played)
1. SUNDAY REVIEW (read-only, PROD reads need approval):
   - All 14 draft_game boards settled? Entries per board, anything stuck (sync_runs
     source='draft-game-settle', summary.waiting).
   - Spot-check 3 rooms against the box: best 3 summed right, no-shows 0, a 3rd/4th tie to the
     earlier pick.
   - app_errors since Sat 10 Oct 21:52Z.
   - Verdict: clean NFL week yes/no.
2. WEEKLY RANKED DRAFT, week 6: settled cleanly, side by side with (1).
3. If (1) and (2) are clean: S4 recon only - retire the weekly Draft (see
   docs/reports/2026-10-08-draft-per-game-recon.md section 4). Build nothing.
4. docs/launch-oct20.md checks 1-5, after the 13:23Z board job: REGULAR stamp, TBD games,
   locks, pages.

## Needs Derik
- From wed-7 (PROD writes): the 2 unclaimed guest rows; one real magic-link sign-in.
- From wed-4: Neon "ci" key, Cloudflare token, PROD crew_reader role.

## Queue
1. 20 Oct: launch-oct20.md checks 6-13 (NBA opening night, CONFIDENCE, ATS, guest play), plus
   the first NBA per-game boards: about 19 Oct 19:00Z onward, one per game, pools of 20 or more.
2. Per-game: S4 retire the weekly Draft (after the Tue verdict), S5 CFB final-only,
   S6 League A, S7 League B.
3. TICKET: suite tests that mutate real DEV boards (the week-5 void_all) must use own fixtures.
4. FCS abbreviation fill, 9 colourless CFB schools, morning email gameOfTheDay.

## Notes
- Test-owned prefixes: dgtest-, dgsettle(test)-, dgnba(test)-. Manual sentinels: dgshot-.
- PROD SELECTs hit the "Production Reads" check; ask Derik per read, never writes.
- neon tagged template: `interval ${'..'}` is a syntax error; write the literal.
- apply-migrations targets PROD via DATABASE_URL="$PROD_DATABASE_URL".
- Headless Chromium: LD_LIBRARY_PATH=~/projects/travault/scripts/vendor/chromium-libs/usr/lib/x86_64-linux-gnu.
- Scheduled: CFBD quota wiring not before 12 Oct; CFB win-prob re-score 26 Oct.

## Next step
Tue 13 Oct: items 1-4 above. 19-20 Oct: the first NBA boards and launch checks 6-13.
