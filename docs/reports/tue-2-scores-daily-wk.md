# tue-2 - scores full week, Daily /wk on the site, PR workflow

## 1. Scores
- Cause: lib/gridiron/scoresV2.js windowGames fetched only today +/- 3 (SQL bounds and a JS filter),
  and dayStripDays drew the same seven chips. A ?date= beyond that was never read, so it said "No games".
- Fix: railSpan(today) in scoresV2Shape.js = today-3 .. max(today+7, coming Sunday). windowGames reads the rail
  span PLUS the picked day (any ?date=) and every live game. Chips carry counts for all sports (dayCounts).
- Tests: scoresV2Shape.test.mjs (every weekday, relative to an injected today), scoresWindow.test.mjs.
- Not possible here: a 390px visual check (no headless Chrome on this host); checked markup only.

## 2. Daily /wk
- games (and xp for PK) stored on each best_roster entry and board card player (boardShape.extrasOf), written
  for new boards by seasonBoardEditions (select now includes games). No migration: both live inside existing jsonb.
- ONE formatter: lib/daily/cardLine.js; morningModules re-exports it; result screen (GradeBox), Results page
  (lib/results/daily.js) and the grader rows use it. Email loadDay uses stored values; the render-time lookup stays
  only for entries lacking games.
- Backfill: scripts/daily-backfill-games.mjs (dry run default, --prod, --apply). Match = season + raw_name +
  team_key + position, exactly one; whole entries rewritten, whole array written back (no jsonb ||).

## 3. PR workflow
- CLAUDE.md "PR WORKFLOW (tue-2, standing)" + docs/handoff.md; reconciled with THE SUITE IS THE WHOLE SUITE.
