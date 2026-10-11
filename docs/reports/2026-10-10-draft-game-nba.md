# Per-game Draft S3 (NBA) - mon-1, branch draft-game-nba (DEV only, HOLDING-FOR-GO)

## Items 1-3 could not run: the games have not been played
The droplet clock read Sat 10 Oct 23:29Z at the start of mon-1. The PROD state then:
- The 14 week-5 boards are open: status scheduled, 0 entries, none settled.
- The settle cron runs every 10 min, ok, with 0 failed runs. app_errors since Sat 21:52Z: none.

So there is no Sunday to review, no week-6 weekly Draft to compare, and no "clean week" verdict
yet. S4 recon is gated on that verdict and was not started. Re-run items 1-3 on or after Tue
13 Oct, once the week-5 boards and the weekly Draft's week 6 have settled.

## S3 built
- lib/draftGame/nbaPool.js. The pool is:
  - on either club's BDL active roster;
  - minus Out / Out For Season (BDL NBA injuries are structured, unlike NFL's);
  - with a season line (this season, else last): FP/G through lib/nba/fantasyPoints.js
    seasonFppg, the same numbers Tonight's Six ranks by;
  - THE LAST-3 RULE: played (dnp = false) in one of the club's last 3 boxed games, applied
    only once the club has a boxed game this season. On opening night nobody has one; until
    then the roster, the injuries and the season line decide.
  - Floor 0.5, cap 30, refused under 20.
  - Real 20 Oct pools from live BDL rosters: BOS@DET 30, PHI@NYK 30, OKC@SAS 26.
- create.js SPORTS:
  - nfl: 72 h before kickoff.
  - nba: 24 h before tip, never before 2026-10-20.
  - NBA rows store week 0, because contests_key_shape needs a week and NBA matches have none;
    match-keyed rows sit outside idx_contests_week.
  - Each sport, and each game, fails alone: a BDL outage records an error and the other sport's
    boards are still made.
- settle.js SCORERS:
  - NBA uses linePoints on the nba_player_game_stats row. A DNP row means did not play and
    scores 0. The stat line comes from nbaLine.
  - NBA grace is 3 h; the box gate reads nba_player_game_stats.
- /draft/game lists NFL then NBA, each by ET game day ("NBA · Tuesday · 0 of 3 drafted").
- Lobby: registry row 'nba-draft-game', flagged on DRAFT_GAME_BOARDS like the NFL row.

## Tests
- nbaPool.test.mjs (pure):
  - roster, Out, no-line, other clubs;
  - last-3 only for a club with a box;
  - the cap;
  - NBA scoring: a double-double, DNP = 0, best 3.
- nba.db.test.mjs (own dgnbatest- / dgnba- fixtures):
  - due inside 24 h and not before the season's first day;
  - two boards on one night (week 0, no day-key clash);
  - last-3 from boxed games, including the DNP case and opening night with no filter;
  - an NBA settle with the 3 h grace, DNP 0 and best 3.
- how-it-works: nba-draft-game is a third flagged game.
- Full suite: 98e61f2 6391/6393 (two BDL-census guards: the pool named the key without the door; two routes newly reach BDL), fixed in edde16e: 6393/6393. Preview READY.

## AT GO - read this before saying go
- DRAFT_GAME_BOARDS is already ON in production. Merging this branch means NBA boards appear
  from Mon 19 Oct about 19:00Z, 24 h before the first 20 Oct tip.
- If NBA should wait, say so and it gets its own switch first.
- No migration.
- Board creation makes 4 BDL calls per NBA game (roster, two averages, injuries), only when the
  board is created. That is about 60 calls on a 15-game night.
