# Handoff - droplet relay sun-2, 11 Oct 2026 (clock: Sun 11 Oct ~03:00Z)

## Live (PROD)
- main = 3ca0729 (draft-game-primetime merged; tree = 307ed93, suite 6397/6397, preview READY).
  Vercel production builds from it; poller deployed head=3ca0729 (previous b70c177).
- GAME DRAFTS ARE PRIMETIME ONLY (sun-2 ruling). NFL boards are made only for games whose ET day
  is Mon-Fri: TNF, MNF and standalone weekday games. No board for the Sunday slate, SNF or late
  Saturdays.
  - PROD dry run: on Sat 17 Oct, 13 games are due and only MNF WSH@SF gets a board (12 skipped).
    TNF SEA@DEN opens Tue 13 Oct 00:15Z.
  - The cron summary carries bySport.nfl.skipped.
  - Today's 14 week-5 boards (ids 58-71, made before the rule) stay and settle normally. They
    were not deleted: no PROD write was GO'd.
- Switches: DRAFT_GAME_BOARDS=on, DRAFT_GAME_NBA=off (set off in sun-2). The NBA code is live
  but dark; NBA boards need both switches on.
- Production env values read back EMPTY from a pull: a switch is proven by the cron summary.

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
   NB: the per-game week is now primetime only (TNF/MNF), so "one clean week" means those.
4. docs/launch-oct20.md checks 1-5, after the 13:23Z board job: REGULAR stamp, TBD games,
   locks, pages.

## Needs Derik
- From wed-7 (PROD writes): the 2 unclaimed guest rows; one real magic-link sign-in.
- From wed-4: Neon "ci" key, Cloudflare token, PROD crew_reader role.

## Queue
1. 20 Oct: launch-oct20.md checks 6-13 (NBA opening night, CONFIDENCE, ATS, guest play). NBA
   Game Drafts stay OFF until Derik flips DRAFT_GAME_NBA.
2. ONE DRAFT LOOK (recon done, docs/reports/2026-10-11-one-draft-look.md): share the look, not
   the room. C-lite (shared shell/seat strip/pool row/result, used by Game Drafts + ranked room +
   results) 8-10 d; full shared room 15-25 d. Decide after S4 (retiring the weekly Draft shrinks it).
3. Per-game: S4 retire the weekly Draft (after the Tue verdict), S5 CFB final-only,
   S6 League A, S7 League B.
4. TICKET: suite tests that mutate real DEV boards (the week-5 void_all) must use own fixtures.
5. FCS abbreviation fill, 9 colourless CFB schools, morning email gameOfTheDay.

## Notes
- Test-owned prefixes: dgtest-, dgsettle(test)-, dgnba(test)-. Manual sentinels: dgshot-.
- PROD SELECTs hit the "Production Reads" check; ask Derik per read, never writes.
- neon tagged template: `interval ${'..'}` is a syntax error; write the literal.
- apply-migrations targets PROD via DATABASE_URL="$PROD_DATABASE_URL".
- Headless Chromium: LD_LIBRARY_PATH=~/projects/travault/scripts/vendor/chromium-libs/usr/lib/x86_64-linux-gnu.
- Scheduled: CFBD quota wiring not before 12 Oct; CFB win-prob re-score 26 Oct.

## Next step
Tue 13 Oct: items 1-4 above; TNF board appears 00:15Z. 20 Oct: launch checks 6-13.
