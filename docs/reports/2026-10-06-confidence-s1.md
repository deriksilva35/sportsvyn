# Confidence Pick'em S1 - build report (tue-7, 6 Oct 2026)

Branch `confidence-s1` @ 5812a90 (pushed, Vercel preview Ready for that commit). DEV only. No PROD, no merge.

## What was built
- Migration 132 (DEV, ledgered): contest_entries.ranks jsonb, contest_entries.max_score numeric. Both nullable.
- lib/pickem/confidence.js (pure): isConfidence, stampsConfidence (sport in nfl/cfb/nba AND opens_at >= 2026-10-20T04:00Z),
  defaultRanks (latest kickoff = 1), effectiveRanks, scoreConfidence, validateSheet (lock freeze), moveRank.
- Stamp: contests.meta.scoring = 'confidence' written at creation (create.js, dayPickem.js). Open boards never change.
  The 13 Oct NFL/CFB boards stay REGULAR; the 20 Oct NFL/CFB boards and the NBA opener are the first confidence boards.
- NBA: from the start, a night with < 3 games gets no board ('thin-slate'); before it, unchanged.
- Save: entry.js saveSheet + app/actions/pickem.js saveSheetAction (age-gated). One call, whole sheet. Server checks the
  per-game lock against the match row's current kickoff/status; a locked game's pick and number are frozen; the open
  games permute among the remaining numbers (so a swap across a locked game works and never moves the locked number).
- Settle (settle.js, dayPickem.js settleDayBoard) and re-grade (same gradePickemBoard): score = sum of ranks of right
  picks; max_score = entry's own ranks over games with a winner. Void/tie off earned AND max; unpicked stays in max.
  Late-pick strip drops the pick AND its stored rank; the freed number returns for max (game is "unpicked").
  perfect.max stays the COUNT of games with a winner (readers that print "N games" stay true).
- Readers: board view (my_rank/my_points/void per row, view.confidence summary: up/banked/points/max/record/beatPct/void),
  receiptFor, pickemCardData record {correct, played, points, max}, leaderboard + results page + lobby pane rank on
  percent of max, season table ranks on points/max (confidence boards) else wins; seasonPct avg = points/max;
  NBA strip / Play registry "Settled - 9 of 11"; My panel + lobby row "76 of 93 - 11-2".
- UI: components/pickem/ConfidenceBoard.js (header, chips, rank chip volt top 3, two pills, up/down, Locked dim,
  "Save picks"), graded card in PickemGrade.js (big points, "of max", record + beat %, void line, per-row +n/0/void),
  share caption "Pick'em Board N - 76 of 93 - 11-2". CSS in its own file app/pickem/confidence.css.
- House pickers: houseSheet() ranks by conviction (spread size), unpriced picks lowest, locked numbers held.
- Leagues: loadLeagueResults re-counts WINS for confidence boards, so REGULAR leagues score exactly as before.

## Tests (new)
confidence.test.mjs (14 pure), confidenceFlow.test.mjs (12, DEV: save, bad sheet, lock freeze, swap across locked, regular
board refuses sheet, view default sheet, settle with void + unpicked, view points/record, re-grade, regular board
unchanged, NBA late strip, NBA < 3 skip, real league query), confidenceBoard.test.mjs (6 jsdom). Updated guards: leak
WIRE_KEYS (+my_rank/my_points/void, argued), TeamMark allowlist, age-gate door count 44 -> 45.

## Gate
Full suite 6238 / 6238 green on 5812a90's tree. scripts/gridiron-backfill.mjs (untracked, not mine, not in the commit)
fails lib/cfbd/clientCensus.test.mjs (raw CFBD fetch), so it was moved out for the run and put back. Lint: no new
problems (PickemBoard.js Date.now purity error is pre-existing, file untouched).

## Decisions I made that you may want to overrule
1. Entry that never saved a sheet scores on the pre-fill (kickoff order), so its max is the default sheet's.
2. Season standings: players with any confidence board rank on points / sum of those boards' max (earlier win-count boards
   still show in W-L); players with none keep wins/played.
3. perfect.max not changed to points (it is per-entry now: contest_entries.max_score).
4. 2-game NBA nights before 20 Oct are unchanged (still a board).

## At GO (not done)
apply-migrations.mjs 132 on PROD (read-only status first), merge, deploy poller/app as usual. Reset parity-intent: nothing
declared (CSS is a new file). NFL/CFB 13 Oct boards will be REGULAR by design.
