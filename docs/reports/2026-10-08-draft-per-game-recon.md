# Draft per game + league draft formats: recon (thu-2, read-only, nothing built)

Rulings: the public Draft becomes ONE DRAFT PER REAL GAME. The pool is both teams' players, it is
scored on that game only, and it locks at kickoff. It covers every NFL game, the AP-filtered CFB
games, and every NBA game from 20 Oct. Leagues get a draft format: A (season best ball) or B (full
league). Order: per-game, then A, then B. Sources: code and migrations only, no DB reads. Pool sizes
are estimates; measure them on DEV before fixing a roster.

## 1. Today's Draft, and what a 2-team pool changes
- CONTEST: contests.game_type='draft', sport='nfl', keyed by week (idx_contests_week, 067:48).
  - It is created with the Weekly in one transaction (lib/weekly/create.js ensureWeek).
  - It opens Tue 9 ET, locks at the week's first kickoff, and settles the next Tuesday.
- ROOM: DRAFT_CONFIG (lib/draft/contest.js:55) is 12 seats, PPR, a 30 s clock, and slots
  QB1 RB2 WR3 TE1 FLEX1, which is 8 rounds. The reader picks a seat (components/draft/SeatSelect.js).
  - The 11 other seats are bots: lib/fantasy/engine.js aiPick is a softmax over par minus ADP plus
    need. Bot dice are seeded per (contest, seat, pick) in lib/draft/roomSeed.js.
  - House personas fill rooms through the house-entries cron.
  - The room UI is the shared sim room: app/sim/draft/[id], components/sim/DraftRoom.js.
- POOL: lib/draft/ourBoard.js gives VOR from 2025 and 2026 finals blended with the FFC prior. That
  is about 304 rows, 249 draftable. It is frozen per contest in draft_contest_boards (125) by the
  draft-bridge cron. Its identity is limited to players with an FFC sim_player_pool row.
- SCORING: lib/draft/bestball.js counts the best QB, RB, WR, TE plus 2 FLEX, PPR, from the Weekly
  board.
  - Rosters are bridged into contest_entries.meta.roster: draft-bridge runs hourly; bridgeRoster is
    at entry.js:138.
  - Settle is weekly: settleDue('draft') in lib/weekly/settle.js, from the draft-settle cron, which
    runs only on Tuesdays 10-21Z.
- RESULTS: /draft (5 states), app/results/[game]/[contest], lib/results/draft.js, the share card
  route, the seat leaderboards in lib/games/leaderboard.js, and leagues (gameTypes 'draft' nfl,
  period 'week').
- A 2-TEAM POOL BREAKS THE SHAPE:
  - NFL two teams give about 20-26 fantasy-relevant players: QB 2, RB 4-5, WR 6-8, TE 3-4, plus
    K and DST if allowed.
  - 12 seats x 8 rounds = 96 picks, so `pool_too_small` fires (drafts.js:829).
  - TEAMS_MIN = 8 is enforced in lib/fantasy/config.js:32,123.
  - There are only 2 QBs, so a fixed QB slot works for at most 2 seats.
  - The engine constants are tuned for deep boards: CANDIDATE_N 15, ADP_REF 120, K/DST round 13.
  - ourBoard's VOR replacement level degenerates with few seats.
- PROPOSED SHAPE (to test on DEV): 4 seats (you + 3 bots), 5 picks each, NO position slots (any
  player, K and DST included), the best 4 of 5 count. That is 20 picks from about 24 players.
  - Best ball absorbs QB scarcity: a QB is a pick, not a requirement.
  - NBA: two teams give about 16-20 rotation players with flexible G/F/C positions, so scarcity is
    mild. Proposed: 4 seats x 4 picks, best 3 count, no position slots.
  - The NFL engine's position vocabulary (POS_TO_SLOT) does not cover NBA. Either a slot-free bot
    (best available by projection plus jitter) or an NBA vocabulary is needed.
  - CFB per-game is new: college rows are bench-only in canRoster today.

## 2. Per-game stats (live and final)
- NFL: complete.
  - nfl_player_game_stats (049) is UNIQUE(match_id, nfl_player_id) with team_id.
  - The live poller syncs box scores every ~5 min while live and once at final (services/live-poller
    index.mjs:356, lib/live/statsCadence.js). The nfl-stats-sweep on Tuesday backfills.
  - fantasyPoints (lib/fantasy/scoring.js) has every input. K is a flat 3 per FG and DST has no
    points-allowed tiers; both are approximate.
  - The pool comes from nfl_players.team_id, refreshed weekly on Tuesday.
- NBA: complete for scoring.
  - nba_player_game_stats (119) is UNIQUE(match_id, bdl_player_id). It has seconds and dnp, and is
    synced on the same poller cadence. lib/nba/fantasyPoints.js linePoints has every input.
  - There is no NBA players table. The pool comes from lib/six/pool.js (BDL active players,
    averages and injuries, as Tonight's Six does).
- CFB: the gap.
  - Final stats are cfb_player_game_stats (078, CFBD), about 35 min after the final, for carried
    games only.
  - Live stats are a separate table, cfb_live_player_lines (080, BDL ids, every 5 min). It has no
    kicking or fumbles and no id bridge to players.id.
  - The roster import (importCfbRoster) has no scheduled caller.
  - So CFB per-game is FINAL-ONLY at first, with a pool from players.current_team_id once the
    roster import is scheduled.
- Templates: lib/weekly/live.js (NFL live totals) and lib/six/score.js plus settle.js (NBA, scored
  per slot live, settled when every box is in).

## 3. Board creation, poller, lobby
- Nothing keys a contest by match today.
  - contests_key_shape (112) allows puzzle_date + season_year, but idx_contests_date is one row per
    (game_type, sport, day), and idx_contests_week is one per week.
  - So ONE MIGRATION is needed: contests.match_id (FK matches), UNIQUE (game_type, match_id) WHERE
    match_id IS NOT NULL, and the two old partial indexes recreated with AND match_id IS NULL.
  - Use a NEW game_type ('draft_game'). currentDraftContest, settleDue('draft'), the lobby
    readers, the seat tables and leagues all key on game_type='draft', and would mix with it.
- CREATE in a cron, the ensurePickemBoard pattern: an advisory lock, INSERT ON CONFLICT DO NOTHING,
  recordRun, alerts.
  - Hourly, it creates a board for each game opening within the window (e.g. 48 h before kickoff).
  - Volume: about 15-35 contests a day (16 on an NFL Sunday, 10-15 CFB Saturday, up to 15 NBA
    nightly). That is small for Postgres.
  - The cost is the pool freeze per board (rankedWeekBoard-style work x 16). Build the per-game
    pool as a filter of one frozen weekly board, not 16 fresh builds.
- LOCK is read-time (locks_at = kickoff), like Pick'em. There is no job.
- SETTLE: add a */10 cron that settles each per-game contest whose match is final and whose box
  is in. Optionally the poller fires a throttled kick on turnedFinal, like lib/cfb/finalKick.js.
  - Do not put scoring inside the poller: it is capped at MemoryMax 512M and peaks at 93 MB today.
  - Do not reuse the Tuesday-only draft-settle.
  - Batch the settle push, one per user per slate, not one per game.
- LOBBY: PLAY_REGISTRY (lib/games/playRegistry.js) is one row per game type per sport. 16 rows
  would flood it, and YOUR MOVE is capped at 4.
  - Copy nbaPickemItem: ONE row per sport per slate ("Game Drafts - 3 of 16 drafted", next lock).
  - The per-game entry point is a "Draft this game" button on the game pages (app/nfl/game/[slug],
    app/nba/game/[slug], the CFB game page) plus a /draft/game/[slug] route.

## 4. The current weekly ranked Draft
- About 60 files reference it.
  - Crons: draft-bridge, draft-settle, house-entries, football-regrade.
  - ensureWeek ("both rows or neither"), lib/draft/*, the results page, push copy, the lobby, the
    shell, widgets, rankings and the seat leaderboards.
  - Leagues: gameTypes 'draft'.
  - Tests: about 20 files.
- RECOMMEND COEXIST, then retire.
  - Ship per-game NFL as 'draft_game'. Keep the weekly Draft until per-game has run a full NFL week
    cleanly.
  - Then stop creating weekly 'draft' rows: edit ensureWeek, remove the 2 crons and the lobby row.
    Existing results pages and history stay readable.
- The sim room (/sim mocks) shares the engine and UI and stays.
- Leagues with game 'draft' keep reading old weeks. New weeks need 'draft_game' registered in
  gameTypes, with a per-week sum of a member's per-game scores as the league unit.
- The 12-seat "by seat" season tables do not translate. Replace them with a per-game record
  (wins, average place), or drop them.

## 5. League formats A and B
- A, SEASON BEST BALL (the bridge recon, 2026-10-08-draft-season-bridge.md): a full-pool snake
  draft among league members, then a frozen roster, with the best N counting each NFL week.
  - From per-game it reuses: the slot-free / best-of-N scorer, match-keyed scoring from
    nfl_player_game_stats summed per week, and the settle cron pattern.
  - From the earlier recon: bridgeRoster, bestball, the sim room with real members (12 seats, ADP
    pool, as today's sim).
  - Migration: draft_season_entries (or player_league_games gets a 'draft_season' game, with
    rosters in contest_entries.meta).
  - Size: 4-6 days once per-game exists; 6-8 days if done first.
- B, FULL LEAGUE: A plus ownership, weekly lineups with locks per kickoff, add/drop and waivers, a
  free-agent pool, per-league scoring settings and byes/injuries.
  - Migrations: season_rosters, season_lineups, season_transactions, season_settings.
  - Size: 3-5 weeks.
  - Risks: lineup and waiver races, BDL stat gaps in season, scope against Pick'em and the Weekly.

## 6. Sizes and ship split (nothing before 20 Oct)
| # | Slice | Size |
|---|---|---|
| 1 | Schema (contests.match_id + indexes), 'draft_game' type, per-game board cron (NFL), pool = frozen weekly board filtered to 2 teams, small-room config (4 seats, slot-free, TEAMS_MIN exception for ranked per-game), slot-free bot | 4-5 d |
| 2 | Per-game scorer + */10 settle (+ poller kick), results page, game-page entry, lobby aggregate row, batched push -> NFL per-game LIVE | 4-5 d |
| 3 | NBA per-game: pool from lib/six/pool.js, linePoints scorer, NBA rooms nightly | 4-6 d |
| 4 | Retire the weekly ranked Draft (ensureWeek, 2 crons, lobby row, seat tables), leagues -> 'draft_game' | 2-3 d |
| 5 | CFB per-game, FINAL-ONLY: schedule importCfbRoster, AP-filtered boards, CFBD scoring | 3-4 d |
| 6 | League format A (season best ball) | 4-6 d |
| 7 | League format B (full league) | 3-5 wk |
Slices 1-2 are NFL per-game (8-10 days). NBA (slice 3) can follow straight after, so per-game NBA
lands in November, not on 20 Oct.
OPEN FOR DERIK: (a) the room shape: 4 seats x 5 picks with the best 4 counting, or another;
(b) K/DST in the NFL per-game pool, yes or no; (c) whether CFB final-only scoring is acceptable,
with results about 35 min after the final; (d) whether the weekly ranked Draft retires after the
first clean per-game week.
