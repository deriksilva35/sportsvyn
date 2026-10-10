# Handoff - droplet relay thu-3, 10 Oct 2026 (thu-1..thu-3)

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

## HOLDING-FOR-GO
- draft-game-s1 (per-game Draft S1), code head ca7d0e3, full suite 6372/6372, preview READY,
  shots in docs/reports/2026-10-09-draft-game-s1/. Report: docs/reports/2026-10-09-draft-game-s1.md.
  Migration 136 is on DEV only. ON GO: merge main into the branch, suite again, merge, then
  `apply-migrations.mjs --prod 136_contests_match_id.sql`, deploy, and the hourly :33 cron
  starts making NFL boards (14 for week 6). The pages are reachable by URL only until S2.
- DEV leftovers to clear after a look: board 60104 (PHI@JAX) and sentinel user 122851
  (dgshot-*@example.invalid) with its room.

## Needs Derik
- Per-game S1 nits: bots labelled by seat number ("Bot 4" beside "You"), and A.J. Brown missing
  from the PHI DEV pool (nfl_players data - check PROD before S2).
- ~/crew/secrets is gone (9 Oct), so there is no DEV sentinel creds file; the shots used a
  throwaway one.
- From wed-7, still open (PROD writes - not mine to ask for): delete the 2 unclaimed guest rows
  (7 Oct 02:48Z probe; 8 Oct ~07:20Z check); magic-link sign-in not proven end to end - sign in
  once yourself.
- From wed-4: Neon "ci" branch/key, Cloudflare token. PROD crew_reader role (crew turn).

## Queue
1. 13 Oct after 13:23Z and 20 Oct: run docs/launch-oct20.md (13 checks, each a command or URL with
   the expected result). PROD reads there need Derik's approval in-session.
2. TICKET: tests that mutate real DEV boards must use their own fixtures. Receipt: an S3-era suite
   run set a REAL DEV week-5 Pick'em board to void_all, reset by hand. Find the writer that selects
   by week/sport instead of a fixture prefix; give it a before()-made sentinel board, and assert in
   after() that no non-fixture board changed.
3. DRAFT PER GAME (ruled: 4x4, best 3, no K/DST): S1 held (above). Next S2 settle/results/lobby/
   game-page entry -> NFL live; S3 NBA; S4 retire weekly after one clean NFL week; S5 CFB
   final-only; S6 League A; S7 League B.
4. FCS abbreviation fill, 9 colourless CFB schools, morning email gameOfTheDay.

## Notes
- PROD SELECTs hit the "Production Reads" permission check here; ask Derik per read, never writes.
- neon tagged template: `interval ${'24 hours'}` is a syntax error - write the literal in SQL.
- Headless Chromium: LD_LIBRARY_PATH=~/projects/travault/scripts/vendor/chromium-libs/usr/lib/
  x86_64-linux-gnu; playwright at ~/.npm/_npx/705bc6b22212b352.
- Scheduled: CFBD quota wiring not before 12 Oct; CFB win-prob re-score 26 Oct.

## Notes (thu-3)
- My draftGame db test deletes `dgtest-%@example.invalid` users in teardown - never give a
  manual sentinel that prefix (it cost one sentinel this relay).

## Next step
Derik: GO / no-GO on draft-game-s1. 13 Oct 13:23Z+: launch-oct20.md checks 1-5.
