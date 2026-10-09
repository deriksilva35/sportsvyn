# Handoff - droplet relay thu-2, 9 Oct 2026 (thu-1 + thu-2)

## Live (PROD)
- main = ecca1e9 (guest-secret + ats-s3) + docs. Vercel prod and droplet services at ecca1e9
  (previous d1d39f3). Guest play works; AUTH_SECRET rotated; S3 ATS live. Nothing deployed thu-1.
- app_errors, last 24h (PROD, read-only, approved by Derik): 1 row - daily-tick 05:05Z "Error
  connecting to database: fetch failed", on d1d39f3, before ecca1e9; later ticks ran fine.
  Nothing since ecca1e9 (07:19Z).

## Crew cleanup (thu-1 item 1)
- REMOVED: mini-watcher + mini-fixer keys from ~/.ssh/authorized_keys (derik-considered kept, only
  line left); private halves shredded from ~/crew/secrets/mini-keys.
- LEFT, for the crew-sportsvyn rebuild: ~/crew/bin (app-errors, cf-top, cost-watch, dispatch,
  latest-deploy, provider-health, retention-status, vercel-errors), ~/crew/lib (common.sh, q.mjs,
  rules.mjs), ~/crew/worktrees (empty), ~/crew/secrets: crew-reader-dev.env/.url, dev-sentinel.env,
  mini-keys/*.pub. DEV: role crew_reader (can login), sentinel user 117499 with 1 live session.
  No crew cron or systemd units.

## Needs Derik
- From wed-7, still open (PROD writes - not mine to ask for): delete the 2 unclaimed guest rows
  (7 Oct 02:48Z probe; 8 Oct ~07:20Z check); magic-link sign-in not proven end to end - sign in
  once yourself.
- DRAFT PER GAME (ruled thu-2; recon docs/reports/2026-10-08-draft-per-game-recon.md). Decide:
  (a) room shape - proposed 4 seats x 5 picks, slot-free, best 4 count (NBA 4x4, best 3);
  (b) K/DST in the NFL pool; (c) CFB final-only scoring OK (~35 min after final);
  (d) retire the weekly ranked Draft after the first clean per-game week.
- From wed-4: Neon "ci" branch/key, Cloudflare token. PROD crew_reader role (crew turn).

## Queue
1. 13 Oct after 13:23Z and 20 Oct: run docs/launch-oct20.md (13 checks, each a command or URL with
   the expected result). PROD reads there need Derik's approval in-session.
2. TICKET: tests that mutate real DEV boards must use their own fixtures. Receipt: an S3-era suite
   run set a REAL DEV week-5 Pick'em board to void_all, reset by hand. Find the writer that selects
   by week/sport instead of a fixture prefix; give it a before()-made sentinel board, and assert in
   after() that no non-fixture board changed.
3. DRAFT PER GAME build, after Derik's (a)-(d): slice 1 schema (contests.match_id + unique
   (game_type, match_id)), 'draft_game', NFL board cron, 2-team pool, small room (4-5 d); slice 2
   settle/results/lobby/game-page entry -> NFL live (4-5 d); 3 NBA (4-6 d); 4 retire weekly Draft
   (2-3 d); 5 CFB final-only (3-4 d); 6 League A (4-6 d); 7 League B (3-5 wk).
4. FCS abbreviation fill, 9 colourless CFB schools, morning email gameOfTheDay.

## Notes
- PROD SELECTs hit the "Production Reads" permission check here; ask Derik per read, never writes.
- neon tagged template: `interval ${'24 hours'}` is a syntax error - write the literal in SQL.
- Headless Chromium: LD_LIBRARY_PATH=~/projects/travault/scripts/vendor/chromium-libs/usr/lib/
  x86_64-linux-gnu; playwright at ~/.npm/_npx/705bc6b22212b352.
- Scheduled: CFBD quota wiring not before 12 Oct; CFB win-prob re-score 26 Oct.

## Next step
Derik: per-game (a)-(d). 13 Oct 13:23Z+: launch-oct20.md checks 1-5. Then per-game slice 1.
