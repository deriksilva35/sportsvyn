# Launch checks - 13 Oct and 20 Oct 2026 (read-only)

Every check is one command or one URL, then the expected result. All SQL is SELECT only, on
PROD, from ~/projects/sportsvyn on the droplet. On this host a PROD read needs Derik's approval
in the session (the "Production Reads" permission check); ask for it and never ask for writes.

Set-up, once per shell (the connection string comes from the env, never the command line):

    cd ~/projects/sportsvyn && set -a && . ./.env.local && set +a
    Q() { node --input-type=module -e 'import { neon } from "@neondatabase/serverless";
      console.table(await neon(process.env.PROD_DATABASE_URL).query(process.argv[1]))' "$1"; }

Background: football boards come from the Vercel cron /api/cron/pickem-board at 13:23Z daily
(vercel.json). A board created on/after 2026-10-20T04:00Z is stamped meta.scoring='confidence'
(lib/pickem/confidence.js CONFIDENCE_START), earlier = REGULAR (no scoring key). The stamp is set at
INSERT and never changes. NBA day boards come from /api/cron/nba-schedule at :52 each hour; the first
create of a game day is the 10:52Z tick.

## Tue 13 Oct - after 13:23Z

1. Cron ran, both sports ok.
   `Q "SELECT source, kind, started_at, ok, error, summary FROM sync_runs WHERE source='pickem-board' AND started_at > '2026-10-13 13:00Z' ORDER BY started_at"`
   Expect: rows for the 13:23Z run, ok = true, no error; summary shows cfb and nfl created
   (or 'exists' for any later run that day).

2. The two boards exist and are REGULAR.
   `Q "SELECT id, sport, week, opens_at, locks_at, jsonb_array_length(board) AS games, meta->>'scoring' AS scoring, meta ? 'spread_frozen_at' AS lines_frozen FROM contests WHERE game_type='pickem' AND sport IN ('nfl','cfb') AND opens_at >= '2026-10-13 13:00Z' AND opens_at < '2026-10-14'"`
   Expect: 2 rows. nfl week 6, 14 games; cfb week 42, 15 games (the 8 Oct plan - a small
   difference means the AP filter or schedule moved, check before calling it wrong).
   opens_at 2026-10-13 13:00Z, scoring NULL (REGULAR), lines_frozen true.

3. TBD games carry the flag in the board snapshot.
   `Q "SELECT c.sport, g->>'slug' AS slug, g->>'kickoff_at' AS kickoff, g->>'kickoff_tbd' AS tbd FROM contests c, jsonb_array_elements(c.board) g WHERE c.game_type='pickem' AND c.sport='cfb' AND c.opens_at >= '2026-10-13 13:00Z' AND c.opens_at < '2026-10-14' AND (g->>'kickoff_tbd')::boolean"`
   Expect: the CFB games still at midnight ET with tbd = true (3 on the 8 Oct plan; 0 if their
   times posted). No NFL rows (every NFL wk 6 game has a real time).

4. Locks: the board's clock reads the real kickoffs, not a placeholder.
   `Q "SELECT c.sport, c.locks_at, min((g->>'kickoff_at')::timestamptz) FILTER (WHERE NOT COALESCE((g->>'kickoff_tbd')::boolean,false)) AS first_real_ko FROM contests c, jsonb_array_elements(c.board) g WHERE c.game_type='pickem' AND c.sport IN ('nfl','cfb') AND c.opens_at >= '2026-10-13 13:00Z' AND c.opens_at < '2026-10-14' GROUP BY 1,2"`
   Expect: first_real_ko = Thu 16 Oct (NFL TNF) / the first real CFB kickoff (Sat 17 Oct 16:00Z
   on the plan). locks_at is the LAST kickoff, where a TBD game counts as the end of its ET day
   (slateBounds, lib/pickem/create.js) - never 04:00Z on a game date.

5. Pages. https://sportsvyn.com/pickem/nfl and https://sportsvyn.com/pickem/cfb
   Expect: open board, straight-up copy ("Pick the winner of every game, straight up"), every game
   pickable; a TBD CFB game shows "Time TBD", not 12:00 AM.

## Tue 20 Oct

6. NBA opening night board (after 10:52Z).
   `Q "SELECT id, meta->>'day_et' AS day, meta->>'scoring' AS scoring, jsonb_array_length(board) AS games, opens_at, locks_at FROM contests WHERE game_type='pickem' AND sport='nba' AND meta->>'day_et' >= '2026-10-20' ORDER BY 2"`
   Expect: one row, day 2026-10-20, scoring 'confidence', games 3, opens_at <= first tip.
   (The 21 Oct board, 11 games, appears at 10:52Z on the 21st. No 22 Oct row ever - 2 games.)

7. NBA cron did not refuse.
   `Q "SELECT started_at, ok, error, summary FROM sync_runs WHERE source='nba-pickem' AND started_at > '2026-10-20 10:00Z' ORDER BY started_at LIMIT 5"`
   Expect: ok = true; summary shows the 20 Oct board created (later ticks say 'exists').

8. Football boards CONFIDENCE (after 13:23Z).
   `Q "SELECT id, sport, week, jsonb_array_length(board) AS games, meta->>'scoring' AS scoring, meta ? 'spread_frozen_at' AS lines_frozen FROM contests WHERE game_type='pickem' AND sport IN ('nfl','cfb') AND opens_at >= '2026-10-20 13:00Z' AND opens_at < '2026-10-21'"`
   Expect: 2 rows, nfl week 7 (14 games) and cfb week 43 (17 games), scoring 'confidence',
   lines_frozen true. The 13 Oct boards (check 2 query) still REGULAR - open boards never change.

9. TBD games rank last in the confidence pre-fill.
   Same query as check 3 with '2026-10-20 13:00Z' / '2026-10-21'. Expect: the TBD CFB games
   (15 of 17 on the 8 Oct plan, fewer if times post). Then https://sportsvyn.com/pickem/cfb
   signed in: the TBD games sit at the BOTTOM of the default ranks (1..15), with "Time TBD".

10. Confidence pages. https://sportsvyn.com/pickem/nfl , /pickem/cfb , /pickem/nba
    Expect: the rank sheet (14..1 NFL, 17..1 CFB, 3..1 NBA). 22 Oct: /pickem/nba says
    "No NBA Pick'em tonight. Fewer than 3 games."

11. ATS leagues have frozen lines to score against.
    `Q "SELECT id, name, pick_format, pick_format_from FROM player_leagues WHERE pick_format='ats'"`
    then
    `Q "SELECT c.sport, count(*) AS games, count(*) FILTER (WHERE g->>'spread_home' IS NOT NULL) AS with_line FROM contests c, jsonb_array_elements(c.board) g WHERE c.game_type='pickem' AND c.sport IN ('nfl','cfb') AND c.opens_at >= '2026-10-20 13:00Z' AND c.opens_at < '2026-10-21' GROUP BY 1"`
    Expect: with_line close to games for both sports (a game with no line is void for ATS - a
    whole board at 0 means the freeze failed: grep the Vercel logs for "[ats-freeze]").
    Page: a member opens https://sportsvyn.com/pickem/nfl?league=<id> and sees "Pick who covers
    the spread" with "AWAY +x · HOME -x" under each game.

12. Guest play still works (any day; 20 Oct is the traffic test).
    https://sportsvyn.com/daily/board in a private window -> "Start the 3:00 clock" -> fill 8 ->
    lock in. Expect: the reveal and "Sign in to keep your streak". Do not claim. Then
    `Q "SELECT count(*) AS starts, count(completed_at) AS finished, count(claimed_by) AS claimed FROM daily_guest_runs WHERE started_at > now() - interval '24 hours'"`
    Expect: finished > 0 and close to starts; the test run adds one unclaimed row.

13. Errors, +30 min after each board time.
    `Q "SELECT service, count, ts, left(message,100) AS message FROM app_errors WHERE ts > now() - interval '1 hour' ORDER BY ts DESC"`
    Expect: no rows. Plus Vercel runtime errors (dashboard or the Vercel connector
    get_runtime_errors): no new group on /api/cron/pickem-board, /api/cron/nba-schedule, /pickem/*.
