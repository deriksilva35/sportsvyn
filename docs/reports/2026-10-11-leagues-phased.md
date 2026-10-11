# Season fantasy leagues, phased - recon (sun-4, read-only, nothing built)

## Rulings (replace the A/B report)
- Draft types: LIVE (a scheduled time, 60-90 s clock, autopick for no-shows) and SLOW (the
  commissioner sets 1/2/4/8 h per pick, a "you're up" push, autopick on expiry).
- 4-16 teams. Bots fill empty seats only if the commissioner turns them on.
- 15 rounds by default (14-16 allowed).
- Presets first (PPR / half / standard); custom editors later.
- Scoring: total points (default), head-to-head, roto.
- Phases:
  - P1: setup + live/slow drafts + a total-points season.
  - P2: H2H, lineups, free agents and waivers.
  - P3: roto, custom scoring, custom roster slots.
- Drafts use the shared draft look (draft-look branch).

## Where it plugs in
- A league today is a TABLE over public contests: lib/leagues/table.js reads player_league_games,
  then loadLeagueResults (lib/leagues/results.js) over contests and contest_entries. Standings are
  derived on read; the guillotine is the only persisted decision.
- A fantasy league is a new KIND: player_leagues.kind 'games' | 'fantasy', with its own settings
  table and its own standings reader branching in table.js.
- Not a new game_type: gameTypes.js is a registry of public contests.

## What fights it
| # | Where | Conflict |
|---|---|---|
| 1 | migrations/122 scoring CHECK; lib/leagues/settings.js SCORINGS, total_one_game | only total, rank. H2H/roto need a separate fantasy_format column, not new values here |
| 2 | 122 format CHECK; settings.js FORMATS | table, guillotine. Leave alone; the fantasy format lives in fantasy settings |
| 3 | 122 max_members 2-100; settings.js MEMBERS_MIN/MAX; invite.js cap | 4-16 needs a kind-aware validator |
| 4 | settings.js validateLeagueSettings ('no_games', span fit); core.js createLeague writes games always | fantasy has no games: its own validator and create branch |
| 5 | invite.js join door (late_joins, starts_at, cap) | there is no seat concept: add seats, and freeze joins at draft start |
| 6 | lib/leagues/rollover.js, pickFormat.js | Pick'em only: skip for fantasy |
| 7 | lib/fantasy/config.js TEAMS_MIN = 8 (validateConfig, StartForm, handoff.js) | 4-7 team leagues are refused by the draft config path |
| 8 | lib/fantasy/drafts.js loadPlayable (one owner), persistTurn (no pick-count guard), settleExpiredTurn (lazy, owner read only), timerAutoPick / autoComplete (one human seat); 046 drafts.user_id NOT NULL; engine isUser | the existing room is NOT multi-human safe. A league room needs its own tables with UNIQUE (draft, overall), optimistic writes (Game Drafts' pattern) and a cron sweep |
| 9 | lib/fantasy/engine.js ADP_REF tuned for 12 teams; FFC pool pairs per team count | bots in 4-7 seat leagues need a pool for that size. Use our own board (ourBoard) for leagues, not FFC |
| 10 | lib/weekly/pool.js weekScores (no defense columns); DST rows not materialised | K/DST scoring needs a DST reader if the presets include K/DST |
| 11 | Vercel cron minimum is 1 min | cannot drive a 60-90 s LIVE clock. Use a lazy clock on every room read or poll (sweepClock), client polling every 2-3 s (or SSE), and a cron backstop |

## Reuse
- Pool: lib/draft/ourBoard.js, frozen per draft.
- Scoring: lib/fantasy/scoring.js fantasyPoints with ppr / half-ppr / standard.
- bestball.js; weekScores / weekStatLines.
- Push: notifyPersonalized with event id `leaguedraft:<draft>:<overall>`, a new copy key, the
  prefs gate.
- Room pattern: Game Drafts (replay from picks, guarded writes, sweepClock); the view: the
  draft-look components.

## P1 - setup, live and slow drafts, total-points season: 22-28 days
- Migration: player_leagues.kind, plus
  - league_fantasy_settings (seats 4-16, rounds 14-16, scoring preset, roster preset,
    format total|h2h|roto, draft_type live|slow, pick_clock_s, draft_at, bots_on, status);
  - league_seats (league, seat, user_id NULL = bot);
  - league_drafts; league_draft_picks (UNIQUE (draft, overall), picked_by user|auto|bot);
  - league_draft_boards.
- Modules: lib/leagues/fantasy/{settings, seats, draft, sweep, autopick, standings}.
- Pages: a create flow branch, the league home, the draft room (draft look), standings, roster;
  a lobby card.
- Crons:
  - league-draft-sweep every minute (slow expiry; live backstop);
  - weekly total-points scoring after the Tuesday stats sweep.
- Split:
  - setup + seats + invites: 5-6 d;
  - slow draft (engine, room, autopick, push): 8-10 d;
  - live draft (polling + lazy clock + presence): 5-6 d;
  - season scoring + standings + roster: 4-5 d;
  - validator and lobby branches: 2 d.
- Ship the SLOW draft first. LIVE follows inside P1.

## P2 - head-to-head, lineups, free agents and waivers: 25-35 days (needs P1)
- Migrations: league_schedule / matchups / playoff rounds, league_lineups (week, slots, per-player
  lock), league_rosters, league_transactions, league_waivers (priority or FAAB).
- Split:
  - lineups with kickoff locks: 6-8 d;
  - free agents + waivers (nightly cron): 8-10 d;
  - H2H schedule for 4-16 teams + matchups + playoffs + tiebreaks: 7-9 d;
  - transactions UI: 4-6 d.

## P3 - roto, custom scoring, custom roster slots: 12-18 days (needs P1, P2)
- Roto: categories from summed game rows - pass yds/TD/INT, rush yds/TD, rec, rec yds/TD, FGM,
  XP, sacks, def INT, FR, def TD. There is no DST points-allowed data. 4-5 d.
- Custom scoring: parameterise scoring.js per league (JSON), recompute history, an editor.
  4-6 d.
- Custom roster slots: slot bounds and canRoster for league rosters, lineup validation, an
  editor. 3-5 d.

## Open decisions
1. P1 total points: does every drafted player score, or the best N per week (no lineups in P1)?
2. Bots in 4-7 team leagues: allowed (our-board pool, any size), or bots only at 8+?
3. LIVE sync: polling (recommended for P1) or SSE?
4. Do K and DST slots appear in the presets? If yes, a DST stat reader joins P1.
