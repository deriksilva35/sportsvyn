# Draft -> season bridge: recon (thu-1, 8 Oct 2026; code and migrations only, nothing built)

## 1. Draft data today
- migrations/046_sim_draft_schema.sql: `draft_configs` (user_id, teams_count, scoring_format
  ppr|half-ppr|standard|2qb, roster_slots jsonb, source manual|preset|tracker|fantrax), `drafts`
  (status in_progress|completed|abandoned, pick_position, completed_at), `draft_picks` (draft_id,
  round, overall_pick, roster_slot, ffc_player_id text, player_name, position, picked_by).
- Later: 055 drafts.mode sim|tracker; 083 Fantrax pool + keepers (draft_config_keepers,
  draft_picks.is_keeper); 084 drafts.user_seat; 085 draft_config_members + invites; 086 NCAAF pool.
- Writers (lib/fantasy/drafts.js): startDraftFor / startCustomDraftFor (manual/preset),
  startTrackerDraftFor + logPickFor (tracker), startLeagueDraftFor, Fantrax via lib/fantrax/import.js.
- END STATE EXISTS: drafts.status='completed' + completed_at (several finish paths in drafts.js).
  There is NO final-roster table: "my roster" = draft_picks at my seat by snake geometry
  (picked_by is unreliable - timer picks are filed 'ai'); lib/draft/entry.js does this.
- Sports: NFL (+ NCAAF players in the same pool). No NBA/MLB drafts.
- Identity: ffc_player_id is an FFC / Fantrax / synthetic id; the bridge to our `nfl_players` is
  sim_player_pool.matched_player_id (name+position match). Ranked pool: 712/712 matched.
- ALREADY A ONE-WEEK BRIDGE: the ranked weekly Draft game freezes a roster into
  contest_entries.meta.roster (lib/draft/entry.js bridgeRoster :138, storeRoster :225) and scores
  best-ball 6 (lib/draft/bestball.js) via the draft-bridge / draft-settle crons.

## 2. What "season" would score
- NFL: nfl_player_game_stats (049) per player per match; weeks via matches (season_year, REG, week,
  final). lib/fantasy/scoring.js fantasyPoints(s, format) :83 (pure; K and DST approximate).
  Weekly points are COMPUTED: lib/weekly/pool.js weekScores :204; season sums
  lib/weekly/seasonLine.js seasonTotals :106. Nothing stored per week.
- CFB: cfb_player_game_stats keyed by players.id; drafts join college players by NAME only
  (lib/fantasy/collegeStats.js), season totals only.
- NBA/MLB stats exist (bdl ids) but no drafts use them.
- League spine to reuse: player_leagues / league_members (073), 122 (span, scoring,
  player_league_games; game 'draft' is NFL), standings derived on read (lib/leagues/standings.js).

## 3. Gaps
- No season entity linking a completed draft (or a draft_config league) to a season or to a
  player_league; draft_config_members and league_members are two membership systems.
- No frozen final roster; Fantrax devy/college players often never resolve (083: 18 of 76).
- Scoring settings = reception value only. No starters per week, no waivers/trades/FA pool.

## 4. Options
A. SEASON TRACKER, best ball on a frozen roster - about 4-6 days.
   1 migration (`draft_season_entries`: draft_id, user_id, config_id, season_year, roster jsonb of
   nfl_players ids + unresolved list, frozen_at). lib/draft/season.js freezes at completion (next to
   the existing ranked hook; tracker + league paths too), generalising bridgeRoster and bestball.js
   to the config's slots. Weekly score = weekScores + fantasyPoints + best ball, standings derived
   on read among the draft's members. One page. No new cron needed.
   Risks: unbridged players (show "unscored", as bestball does), approximate K/DST, NFL only.
B. FULL SEASON LEAGUE - about 3-5 weeks.
   A plus ownership, weekly lineups with per-kickoff locks, add/drop + waiver cron, FA pool,
   per-league scoring, bye/injury handling; hooked into player_leagues as a 'season' game.
   Risks: lineup/waiver races, BDL stat reliability in season, scope against Pick'em/Weekly.
Recommendation: A first; build B's start/sit only if A shows retention.
