# League draft formats A and B on the weekly Draft - recon (tue-1, read-only, nothing built)

Ruling tue-1: the weekly Draft is the permanent public Draft (S4 cancelled). Leagues get two
draft formats built on it: A = season best ball, B = full league.

## What exists today
- WEEKLY DRAFT (lib/draft/*, lib/fantasy/drafts.js):
  - The config is 12 seats x 8 rounds, PPR, a 30 s clock, slots QB1 RB2 WR3 TE1 FLEX1
    (lib/draft/contest.js:55).
  - The pool is lib/draft/ourBoard.js (VOR from finals blended with the FFC prior), frozen per
    contest in draft_contest_boards (125).
  - Scoring is best 6 (lib/draft/bestball.js) on weekScores (lib/weekly/pool.js), with rosters
    bridged to nfl_players (lib/draft/entry.js bridgeRoster) and settled weekly
    (lib/weekly/settle.js settleDue('draft')).
- LEAGUES (073 + 122 + 133):
  - player_leagues / league_members, with span, scoring total|rank, format table|guillotine.
  - player_league_games lists which public games count; 'draft' is one, with period 'week'
    (lib/leagues/settings.js:32).
  - A "Draft league" TODAY is everyone drafting their OWN weekly room against bots, with the
    league ranking those scores. Nobody drafts against each other.
- NO MULTI-HUMAN DRAFT ROOM EXISTS. Every room (ranked, mock, Fantrax league runs, Game Drafts)
  is one human and bots. drafts.user_id is a single owner, and draft_picks.picked_by is
  user|ai|logged (046, 055).
- Game Drafts already has the pattern a shared room needs: picks replayed from a list, writes
  guarded on the pick count, and a server-side clock sweep that auto-picks for an absent seat
  (lib/draftGame/rules.js sweepClock, room.js).

## Format A - season best ball
- The league drafts ONCE, members in the seats and bots filling any empty seat.
- Rosters are frozen. Every NFL week each roster scores its best 6 (the weekly Draft's grammar),
  and the season total ranks the league.
- No lineups, no waivers.
- NEW:
  1. A LEAGUE DRAFT ROOM for N humans. Recommend a SLOW DRAFT first: each pick has a long clock
     (e.g. 8 h, set by the commissioner), a push "you're up", and an autopick (top of the board)
     when the clock runs out. It runs on the Game Drafts sweep model generalised to many human
     seats. A live 30 s room for N humans needs presence and real-time sync: later, if wanted.
  2. ROUNDS: 8 is too thin for a season (byes, injuries). Recommend 14 rounds with best 6 weekly.
     DECISION for Derik.
  3. SEASON SCORING: per week, per roster, bestBall over weekScores, after the Tuesday stats
     sweep; the season total is derived on read like lib/leagues/standings.js.
- Migration (1 file):
  - league_drafts (id, league_id, season_year, rounds, pick_clock_s, order jsonb, status,
    started_at, completed_at);
  - league_draft_picks (league_draft_id, overall, seat, user_id NULL for a bot, nfl_player_id,
    picked_by user|auto|bot, picked_at; UNIQUE (league_draft_id, overall));
  - league_draft_boards (league_draft_id, rows jsonb) - the frozen season pool;
  - a 'draft_season' key in player_league_games.
- Reuse: ourBoard (season build), nfl_players ids (no bridge needed: draft straight from our own
  board), bestball.js, weekScores, the league invites and members, standings, push.

## Format B - full league
A plus, per week:
- start/sit lineups locked at each kickoff (QB RB RB WR WR TE FLEX + bench);
- free agency and waivers (priority or FAAB, a processing cron);
- head-to-head schedule and playoffs;
- trades later.
Migrations:
- league_lineups (league_id, user_id, week, slots jsonb, locked per player);
- league_transactions (add/drop/claim/trade, status);
- league_waivers (order or FAAB);
- league_matchups (week, home, away, scores).

## Sizes and ship split
| Slice | What | Days |
|---|---|---|
| A1 | migration + slow-draft room (N humans + bots, long clock, autopick, "you're up" push), league-draft setup in the league page | 7-9 |
| A2 | season best-ball scoring weekly + league standings + roster page | 3-4 |
| A3 | draft recap / share, commissioner tools (pause, reorder before start) | 2 |
| A total | | 12-15 |
| B1 | lineups with per-kickoff locks + lineup page | 5-7 |
| B2 | free agents + waivers cron | 6-8 |
| B3 | H2H schedule, weekly matchups, playoffs | 5-7 |
| B4 | trades (propose / accept / veto) | 4-6 |
| B total, on top of A | | 20-28 (4-6 weeks) |

## Open decisions for Derik
1. Slow draft first (recommended) or a live room?
2. Rounds for A: 14 (recommended), or the weekly 8?
3. A standings: total points (recommended) or head-to-head?
4. Bots allowed in league seats (recommended, so 6 friends can run a 12-team league)?
