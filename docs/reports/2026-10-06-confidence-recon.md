# Confidence Pick'em - read-only recon (tue-6, 6 Oct 2026)

Method: three read-only Explore passes over the tree plus two SELECT-with-LIMIT reads (DEV and PROD);
no code, no writes. File:line cites are from those passes; some are approximate (~). Not independently
re-verified line by line by the orchestrator - treat cites as pointers.

## 1. Storage, and what a rank needs
- Picks live in contest_entries.lineup jsonb: `{match_id: 'home'|'away'}` (football, NBA day boards),
  `{series_key: team_id}` (MLB series). score / base_score numeric. No rank anywhere.
  Save: components/pickem/PickemBoard.js tap() -> app/actions/pickem.js savePickAction(contestId, matchId, side)
  -> lib/pickem/entry.js savePick (:387) / saveDayPick (:441); merge is `lineup || patch` (:418-427).
- Many readers treat lineup[matchId] as a bare side string (section 3B). DO NOT put the rank inside the
  lineup value. Recommend a NEW column contest_entries.ranks jsonb `{match_id: int}` (a nested key in meta
  would meet the shallow-`||` law; a column is simpler) written with an explicit per-key merge.
- Scoring mode belongs to the BOARD, not the sport: contests.meta.scoring = 'confidence', stamped at creation.
  That is what leaves open contests untouched and lets settle branch per board.
- Migration: one (next number is 132 today - rescan before applying): ranks column + nothing else for public.
- MLB series boards already have weighted points (ROUND_POINTS 1/2/3/4) and have 1-4 series per round
  (SERIES_IN_ROUND 4,4,2,1): a rank over 1 or 2 series is meaningless. Recommend MLB is OUT of confidence.

## 2. Settle / grade, and void
- lib/pickem/settle.js: scoreLineup (:~100) counts wins; gradePickemBoard writes score=base_score=wins
  (:145-149); perfect = {results, max: perfectMax(results), void} (:155); a void or tie is results[id]=null
  and perfectMax counts only home/away. Day boards: lib/nba/dayPickem.js settleDayBoard (:259-303), same
  scoreLineup, max = played. Re-grade (7 days, regradeResults) re-scores every entry through the same function.
- Confidence: score = sum of ranks of correct picks. A void/tie drops its rank from earned (no win) AND
  from max. Because each entry assigns its own ranks, max is PER ENTRY (sum of that entry's ranks over
  non-null results), so it cannot live in contests.perfect.max (board-wide). Store it on the entry
  (new column max_score, or contest_entries.meta) at settle and re-grade; ranking = score / max.
  An unranked/unpicked game contributes 0 earned and, decision needed, either its slot rank or nothing to max.
- Late picks (NBA onTimePicks, moved to meta.late_picks) must strip the matching rank too.
- All-void close (closeVoidAll) writes no scores: unchanged.

## 3. Readers of pick'em scores
NEEDS CHANGE
- lib/pickem/settle.js scoreLineup/perfectMax/regrade; lib/nba/dayPickem.js settle (strip ranks, max).
- lib/results/pickem.js: pickemRecord/competitionRank/distribution/bestHitRate are all win-count based and
  would disagree with stored score; header (wins) vs rows (points) mixed units. Rewrite to score/max.
- lib/games/lobbyV3.js pickemBoardV3 (:~160-185): footer prints `${perfect.max} games`; relabel as points.
- lib/games/playRegistry.js:176, lib/nba/yours.js (:~115-138): "Settled - N of M right" wrong for points.
- lib/pickem/entry.js pickemCardData settled branch (:~263-267): record={correct: score, played: board.length}
  would print e.g. 47/16. Feeds components/my/panels.js:41, lib/panelLoaders.js:45, app/page.js:395,
  lib/games/read.js:718, lib/games/lobbyV2.js:79. receiptFor "rarest correct pick" reads lineup (:~235).
- components/pickem/PickemGrade.js / ShareGrade (the share card): caption "N of M - pct%" is W/L from
  settledGrade.js; decide: points of max, or stay W-L. Leaderboard rows beside it already print score.
- lib/games/leaderboard.js pickemBoardLeaderboard (:51-90): ranks by raw score; ranking by score/max goes here.
- House autopickers (lib/house/run.js:95, lib/house/pickPickem.js) must assign ranks or house entries score 0.
SILENTLY WRONG IF SCORE SEMANTICS CHANGE BUT LINEUP STAYS A STRING (decide, not break)
- lib/games/read.js pickemTable (:~100-170) season standings: win-percentage with a 3-board floor. Stays W-L
  unless Derik wants a points season. Inherited by lib/pickem/seasonPct.js, app/pickem/[sport]/page.js:104,
  lobbyV3.js:256, read.js:967, lib/rankings/view.js:111 + people.js, lib/you/reads.js:195,214.
- lib/games/v3Rows.js pickemRecord/pickemRowV3 (W-L counter): fine as W-L.
- lib/gridiron/todayPicks.js, scoresV2.js:~218, todayReads.js:160, inYourGames.js:~178, lib/nba/yours.js:~95,
  lib/widget/reads.js:172 + shape.js:359: read lineup side strings only - SAFE as long as ranks stay out of lineup.
UNAFFECTED
- Morning push (lib/daily/morningPush.js has no pick'em), notifyPickemSettled copy (static), widgets (picks
  only, no score), My page except pickemCardData, October/Run/Six/Weekly/Draft (own perfect shapes), void
  rule modules, create.js, crons, admin reads.
- Leagues (lib/leagues/results.js, standings.js): read e.score only. NOTE they sum raw score across boards with
  different rank-sums ("total" scoring) - a bigger board weighs more; semantic decision, see section 8.

## 4. Slate sizes (DEV and PROD agree)
- NFL: every REG game in the week, no cap: 13-19 (weeks 1-18: 16,16,16,16,15,14,14,14,15,14,13,16,14,15,16,16,16,16).
- CFB: every game in a Mon-Mon ET window with >=1 AP-ranked team: PROD boards 8,23,24,22,18,16, current 19 (8-24).
- NBA: one board per ET day (week=YYYYMMDD), every non-void game with a tip that day. 20 Oct-8 Nov: 3,11,2,12,8,
  7,9,4,12,3,10,7,4,15,14,2,9,7,7 -> range 2-15; opener 3; no board on 3 Nov. No size is hard-coded in the
  builder. Only PIP_SPLIT_AT=26 (PickemBoard.js:69) and MLB SERIES_IN_ROUND.
- A 2-game NBA night has ranks {1,2}: legal but thin (swing is 1 point); a 3-12 night does not BREAK anything.
  A 15-game night/CFB 24 is a long ranking list for a phone - the UI cost, not a data one.

## 5. First fresh week per sport (PROD today)
- Open now, UNCHANGED: CFB contest 47 (wk key 41, 19 games), NFL contest 48 (wk 5, 15 games), MLB 45 locked.
- NFL: week 6 (14 games), opens Tue 13 Oct 09:00 ET, created by the 13:23Z cron that morning.
- CFB: window 12-19 Oct, opens Tue 13 Oct 09:00 ET (first kick ~14h later).
- NBA: 20 Oct opener (3 games, opens at 06:00 ET or first tip).
- MLB: CS (2 series) only after the DS - out of scope per section 1.
- => NFL and CFB's next fresh weeks open 13 OCT, SEVEN DAYS from now, a week BEFORE NBA's 20 Oct. If confidence
  cannot be live by 13 Oct, NFL/CFB start at the 20 Oct boards (NFL week 7) instead.
- Per-game locks: football/NBA lock each game at its own kickoff/tip against the server clock (entry.js:409-416,
  dayGameLocked). A rank sheet cannot be reshuffled after some games kick: locked games keep their rank; the
  rest may only permute among the remaining unused ranks. Server must enforce swap-within-unlocked. Kickoffs can
  move earlier (current matches.kickoff_at is read at save) - NBA stamps meta.picked_at; ranks need the same.

## 6. Pick entry UI today
- Two big tap buttons per game (pkv-g rows, PickemBoard.js:276-383, disabled when locked), grouped by lock day,
  optimistic overlay tap() :129 -> savePick :142; one pick per server call; payload (contestId, matchId, side);
  validation side in ['home','away'] (entry.js:388). "Lock it in" (confirmPickemEntry) only writes confirmed_at.
- No dnd/animation libs in package.json. Tap-to-rank is cheaper than drag. Recommended shape: tap the side
  (as today) then the game gets the next free rank; a rank-order list to reorder via up/down or tap-swap.
- Replaces: the pkv-g side picker, tap/savePick/stage/canConfirm and the pip "picked" counter (:119-181).
  New action needed: setRanksAction(contestId, ranks) - whole-sheet, validated against locked games.

## 7. Leagues today
- Leagues (player_leagues + league_members + player_league_games) score members' PUBLIC entries: results.js:73-81
  joins contests+contest_entries by game_type:sport, member ids, locks_at >= league.starts_at, excludes void_all,
  reads e.score. No league-scoped contests exist; the contest unique index is (game_type,sport,season,week).
- Leagues offer pick'em for NFL and CFB only (lib/leagues/gameTypes.js:11). NBA and MLB are not offered.
- player_leagues has span, scoring (total|rank), drop_worst, format (table|guillotine - a STANDINGS format, do not
  overload), max_members, late_joins, starts_at, start_*... NO settings jsonb. League settings are create-time
  only: no commissioner edit action exists (only resetInvite). "Format locks when the first week locks" is
  therefore trivially satisfied by create-time-only; a commissioner pre-lock edit would be NEW work.
- Needs: migration adding player_leagues.pick_format text NOT NULL DEFAULT 'regular' CHECK in
  (regular|confidence|ats) - a new column so existing leagues become REGULAR automatically.
- With one pick sheet per user per week (winner + rank): REGULAR = winners only, recomputed from lineup vs
  perfect.results (no new table); CONFIDENCE = ranks, i.e. the stored score; ATS = a SECOND sheet, picks
  against the frozen line -> new table league_ats_entries(league_id, contest_id, user_id, picks jsonb, ...)
  plus scoring in results.js. So loadLeagueResults must branch by pick_format (REGULAR must stop reading
  e.score once score means confidence points). Public entries are shared across leagues, so a user cannot
  differ per league on the main sheet - consistent with the addendum.

## 8. Spreads
- Single store odds_markets (migration 014): match-scope market_type h2h|spread|total, selection_value signed
  line, is_current, fetched_at; history is kept (flip is_current, INSERT), pruned to open/close/last
  (lib/ops/dataRetention.js). Provider The Odds API, cron app/api/cron/gridiron-odds (15 min tick; 15-min
  polls inside 6h of a kickoff, hourly otherwise; only status='scheduled' matches).
- NFL: yes (americanfootball_nfl). CFB: yes (ncaaf); some games unpriced early in the week (and the board
  opens Tuesday). Readers: getSpreadHome (lib/gridiron/oddsReader.js:147), openingSpreads (openingLine.js).
- NBA: NO odds at all - no SPORT_KEYS entry, no basketball path, hasLine = sport !== 'nba'. Needs
  basketball_nba key + cron entry + credit budget (3 per call); NBA lines post same-day so an open-time
  freeze is thin. MLB: h2h+totals only, postseason only, no run line bought (would be +-1.5 run line);
  series boards anyway.
- Frozen league line: board snapshot is the natural home (boardPlan builds {match_id, slug, kickoff_at,
  teams} once, ON CONFLICT DO NOTHING, create.js:~146-157, 240-250). But the board opens Tuesday, days before
  kickoff, so a line frozen there is a Tuesday line, and unpriced games have none. Cleaner: a new table
  contest_game_lines(contest_id, match_id, spread_home, odds_id, captured_at) written by an idempotent capture
  step at "when the league week opens" and filled for stragglers at first capture; game with no line at
  freeze = excluded from that ATS week (decision). Whole-number lines can push: push = void = null result,
  off earned and max (same mechanics as the void/tie rule).
- ATS therefore realistically NFL/CFB only; NBA ATS needs the odds feed first (own ship).

## 9. League creation UI
- app/leagues/new/page.js -> components/leagues/CreateLeagueForm.js (state :47-56, settings built :66, posted :82;
  format Radio table/guillotine at :143). Pick format goes beside it, shown only when games includes 'pickem'.
  Server: lib/leagues/settings.js validateLeagueSettings (:~110-145) + summaryLine/leagueChips, core.js
  createLeague INSERT (:76-81), app/actions/leagues.js:36-44. Read: myLeagues/leagueDetail select (core.js:117-147).

## 10. Size and ships
Public confidence (NFL/CFB/NBA), ~7-9 working days, 1 migration:
 mig ranks column + per-entry max; entry.js set-ranks + lock-aware validation; settle/regrade/day settle;
 the reader fixes in 3A; tap-to-rank UI; house pickers; tests (void drops earned+max, regrade, lock, late pick).
 RISKS: per-entry max (not board max); every reader that prints "N of M right"; regrade correctness; mid-week
 flag flip must not touch open boards (key off contests.meta.scoring stamped at creation).
League formats on top: pick_format column + create form + results.js branching ~3 days (REGULAR/CONFIDENCE);
 ATS ~5-6 days (lines table + capture + second sheet + settle + push/void + UI), +NBA odds feed ~2 days if wanted.
Total ~16-18 working days.
Suggested ships:
 S1 (before 13 Oct for NFL/CFB, or at latest before 20 Oct for all): public confidence - NFL, CFB, NBA.
 S2 (before first league week that uses it): leagues pick_format column + REGULAR/CONFIDENCE.
 S3: ATS leagues, NFL/CFB; S4: NBA lines feed + NBA ATS (optional).
 Must land before NBA 20 Oct: S1 only. Can follow: S2-S4 (existing leagues stay REGULAR via the default,
 but note: once public score = confidence points, today's league results.js would silently score REGULAR
 leagues in confidence points - S1 must either include the results.js REGULAR recompute or leagues must
 keep reading wins; this is the one S2 item that cannot wait).

## Decisions for Derik
1. NFL/CFB start 13 Oct (needs S1 in 7 days) or 20 Oct?
2. Unranked/unpicked game: earns 0 and adds 0 to max (recommended), or adds its slot to max?
3. Must a player rank every game, or may they rank a subset (ranks are the highest-N descending)?
4. Season standings and the share card: stay W-L, or move to points/max?
5. MLB series stays on its own round points (recommended); NBA 2-game nights ranked or left plain?
6. League "total" scoring across boards with different rank-sums: normalise (score/max) or leave.
