# Handoff - droplet relay wed-2, 7 Oct 2026

## Live (PROD)
- main 7d7caf3 = merge of tbd-locks: a TBD MLB game never locks at its midnight-ET placeholder on any
  board (Pick'em incl. series, day boards, The Run, lobby, settle). One rule: isGameLocked() in
  lib/mlb/kickoffTbd.js. Vercel prod READY; 0 runtime errors.
- Poller, daily-tick, mlb-advance on release 7d7caf3 (deploy-poller.sh proof 05:17:25Z); 0 errors.
- 77327ca (Time TBD everywhere) verified: poller + Vercel, 0 errors.

## Held - HOLDING-FOR-GO
- league-formats-s2 @ b75fcfe (S2). Mock copy exact; after the lock a change queues
  (pick_format_pending, migration 134) with "Switches to <Format> next season" + Undo; applied on read
  at the first board of the next season (lib/leagues/rollover.js). Main merged in, full suite alone
  6315/6315, preview READY.
- PROD --status: 133 and 134 pending, CHANGED 0.
- At GO: `DATABASE_URL="$PROD_DATABASE_URL" node scripts/apply-migrations.mjs 133_league_pick_format.sql`
  then 134, then `--status`, then merge league-formats-s2 into main (no rebase) and push.

## Queue
1. S2 GO (above).
2. 13 Oct watch: that morning's NFL/CFB boards must be REGULAR; 20 Oct boards confidence.
3. ATS (S3), FCS abbreviation fill, 9 colourless CFB schools, morning email gameOfTheDay.
4. Pre-existing eslint error on main: react-hooks/purity at components/pickem/PickemBoard.js:150.

## Open questions for Derik
1. S2's rollover applies on the first READ of the league after the next season's first board exists
   (there is no season job). OK, or want it on a cron?
2. The league-filtered Pick'em board (?league=) still ranks on the public scoring, not the league format.
   Align?

## Notes
- Worktrees: ../sv-tbd-locks (merged), ../sv-s2 (held).
- entryFlow.test's two DEV tests flake only when lib/pickem/* files run in parallel by hand.
- lib/nba/replay.test.mjs collides when two suites share DEV: run gates alone.
- Detail: docs/reports/2026-10-07-wed2.md
- Scheduled: CFBD quota wiring not before 12 Oct; CFB win-prob re-score 26 Oct.

## Next step
On Derik's GO: migrations 133+134 on PROD, then merge S2.
