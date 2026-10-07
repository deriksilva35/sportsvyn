# Handoff - droplet relay wed-1, 7 Oct 2026

## Live (PROD)
- main 77327ca (Vercel deploys from main): merge of tbd-everywhere. "Time TBD" now shows on every MLB
  list and card: Scores, team pages, Pick'em boards, lobby, The Run, October and the game page. There is
  one formatter, kickoffTimeLabel in lib/time/display.js, and a guard test.
- NOT YET CHECKED: Vercel production deploy of 77327ca and its runtime errors.
- Poller, daily-tick and mlb-advance are still on release d3ad0c9. `scripts/deploy-poller.sh origin/main`
  was DENIED by the auto-mode classifier, and the relay stopped there (standing rule).

## Held
- league-formats-s2 @ d85e287 (S2, DEV only). Migration 133 is applied and ledgered on DEV. Preview is Ready.
  Its earlier full run had 12 failures:
  - 1 was dark parity, fixed by moving the CSS to its own file.
  - 1 was settings.test, fixed.
  - 10 were the nba replay collision; the file passes alone.
  NEEDS before GO: merge main (77327ca) INTO the branch (no rebase), re-run the FULL suite alone, then a
  fresh preview.
- At GO: `apply-migrations.mjs --status` on PROD, then 133 on PROD, then merge.

## Queue
1. Deploy the poller release to 77327ca (needs Derik to allow, or run it himself), then prove the head.
2. S2: merge main in, full suite, preview, then HOLDING-FOR-GO.
3. 13 Oct watch: that morning's NFL/CFB boards must be REGULAR; the 20 Oct boards must be confidence.
4. ATS (S3), FCS abbreviation fill, 9 colourless CFB schools, morning email gameOfTheDay.

## Open questions for Derik
1. A TBD MLB game on a Pick'em series board still LOCKS at the midnight-ET placeholder (server lock and
   client `kicked`). Should it lock only when a real time posts?
2. S2 card copy is mine, because no mock exists on the droplet (PICK_FORMAT_COPY in lib/leagues/pickFormat.js).
   OK, or send the mock?
3. After the lock, a non-switch league is refused with "a change starts next season". Nothing queues the
   change for next season. OK?
4. The league-filtered Pick'em board (?league=) still ranks on the public scoring, not the league format. Align?

## Notes
- Settled (wed-1): a no-sheet confidence entry scores on the kickoff-order default. Do not raise it again.
- lib/nba/replay.test.mjs fails whenever two suites share DEV, because every run uses the same sentinel prefix.
  Run gates alone.
- Builder worktree: .claude/worktrees/agent-a780fc5ddc0290b35 (branch tbd-everywhere, merged).
- Detail: docs/reports/2026-10-07-wed1.md
- Scheduled: CFBD quota wiring not before 12 Oct; CFB win-prob re-score 26 Oct.

## Next step
Allow or run the poller deploy, then S2's merge-main + suite + preview, then GO.
