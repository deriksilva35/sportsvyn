# Handoff - droplet relays Tue 20 Oct 2026, end of day (written 21 Oct ~05:30Z)

## Main
- main 861a08fa (#17 fx-happy, after #16 crew/register-v1). 35d65286 (#15) was green on its own
  run 39541460091. The run for 861a08fa was still PENDING (runner queue) at 05:25Z.
- wed-0: main went red after #14 (wed-1b) because its 2 parity-intent entries went stale on merge.
  Not a race. Fixed by #15 ({"changes": []}). "Up to date before merging" would not catch this,
  so it was not turned on. The gh account is admin and could turn it on if asked.
  4f8c13a5's red was a different test: lib/six/replay.test before() called fetchNbaTeams with no
  BDL key in CI. It passed on the next run. FLAKY, unfixed.

## PRs
- crew-1 #13 merged 4f8c13a5. wed-1b #14 merged 57bd3267 (prod READY). wed-0 #15 merged 35d65286.
- tue-2 #10 OPEN: CI green on bb4e7307. The builder died mid-work, so check the branch before trusting it.
- tue-4 + tue-5 #9 OPEN: CI FAILED on 2a97c5fe. The builder died; partial work is in
  .claude/worktrees/agent-a9996f541cb374d97.
- wed-1 NOT STARTED: the spec never reached this session.

## Tue 20 Oct numbers (PT day 07:00Z-07:00Z, read at 05:20Z, so the last ~1.7h is missing)
- Played anything (Daily, contest entries of any game type, survivor, puzzle):
  - A 43: 1 played (EPL Weekly 5).
  - B 253: 0 played.
- Site-wide signed-in players by game: Daily 3, Pick'em 5, Draft 5, Weekly 4, October 3, Run 3,
  Draft game 2, EPL5 2, Six 1.
- Since 15:00Z: 2 new accounts. Guest Daily: 3 starts, 0 finished, 0 claims.
- NBA room 101: settled (FINAL, 2 games). 2 humans drafted, each in their own room with 3 bots.
  - user 1 (sportsvyn_og): 4th of 4 with 93 (bots 135 / 117 / 107).
  - user 373: 2nd with 134.
- app_errors since 07:00Z: none.

## Wed 21 Oct
- 6 AM PT preview: will NOT run (tue-4 #9 not merged).
- 8 AM email: runs on the existing cron 0 15 * * * = 8 AM PDT.
- NBA room 102: opened 04:33:48Z. 11 games, 4 drafters x 3 picks (G, F, UTIL), locks 23:00Z
  (4:00 PM PT). It is in the OLD shape because wed-1 was not built.
- The email lists room 102 under free to play as "Primetime Draft" -> /draft/game, using the generic
  draft-game tile. There is no NBA Draft tile (that is wed-1).
- wed-1 blocker: stored NBA positions are G/F/C only. The 7+ PG/SG/SF/PF/C shape needs another
  positions source, or G/G/F/F/C.

## Queue
1. wed-1 once Derik re-sends the spec: room sizes, Tonight tab, game-time flag, email tile.
2. tue-4/5 (#9): fix CI, then finish rate limit + 429 retry, opened/clicked store + daily summary.
3. tue-2 (#10): verify the branch (Scores full week, Daily /wk + backfill, PR WORKFLOW rule in
   CLAUDE.md + this file), then merge on green + READY preview.
4. Flaky six/replay BDL hook. Coins + Drum still HELD (branch coins-drum). Mon 26 Oct CFB re-score.

## Rules met today
- Reset parity-intent.json right after any merge that declared entries (third time: #12, #15).
- PR into main; "SPORTSVŶN test suite" green + Vercel READY; merge commit; no bypass.

## Next step
Ask Derik for the wed-1 spec. Until it arrives, fix #9's CI.
