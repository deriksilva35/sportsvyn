// lib/winprob/live.js - the win probability a live game carries, computed by
// the poller on every write, from the market prior frozen at kickoff.
//
// WHAT RUNS WHERE
//   NFL  computed, logged (winprob_log), and written to live_state.win_prob
//        for the web game page - shipped by override, "Calibrating" label.
//   CFB  computed and logged, NEVER written as a display value: SHADOW until
//        it passes the blind re-score in model/winprob/GATE-cfb.md.
//   Phone: nothing, unless WINPROB_PHONE=on (lib/push/liveActivityState.js).
//
// THE PRIOR is the LAST odds_markets consensus spread before kickoff, frozen
// once into metadata.market_prior = { spread, n_books, captured_at }.
//   spread  the consensus HOME line in BETTING convention: -3 means the home
//           side is favoured by 3. Measured, not assumed: on PROD 2026 finals,
//           corr(home value, home win) is -0.35 over 33 NFL games and -0.59
//           over 246 CFB. spreadForModel() turns it into each model's own sign.
// The match-scope odds rows carry a NULL league_id, so they are found by
// match_id, never by league. The home selection is named by the team, and
// sideFor() (lib/gridiron/oddsReader.js) says which side a label is.
//
// NO LINE, NO NUMBER. A game with no pre-kick spread gets no prior, and a game
// with no prior gets no win probability - no 50/50, no Elo.

import { sideFor } from '../gridiron/oddsReader.js';
import { predict, priorLogit, spreadForModel, MODEL_VERSION } from './predict.js';

export const WINPROB_SPORTS = Object.freeze(['nfl', 'cfb']);
/** Which sports may put a number on a card. CFB is shadow. */
export const DISPLAYED = Object.freeze({ nfl: true, cfb: false });

/** A spread value as stored: '-3.5', '+2', 'PK'. Null when it is not one. */
export function spreadPoints(v) {
  const s = String(v ?? '').trim().toUpperCase();
  if (s === 'PK' || s === 'EVEN' || s === 'PICK') return 0;
  const n = Number(s);
  return s !== '' && Number.isFinite(n) ? n : null;
}

/** 'MM:SS' (or 'M:SS') -> seconds, or null. */
export function clockSecs(clock) {
  const m = /^\s*(\d{1,2}):(\d{2})\s*$/.exec(String(clock ?? ''));
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
}

/**
 * The model's clock from the feed's. Four 15-minute quarters in both codes.
 * secs_game is regulation seconds left, 0 in overtime; secs_half is seconds
 * left in the half (in overtime, the period's own clock).
 */
export function timeState(period, clock) {
  const p = Number(period); const c = clockSecs(clock);
  if (!Number.isInteger(p) || p < 1 || c == null) return null;
  if (p >= 5) return { secs_game: 0, secs_half: c, is_ot: 1 };
  return { secs_game: (4 - p) * 900 + c, secs_half: (p === 1 || p === 3 ? 900 : 0) + c, is_ot: 0 };
}

/** x filled when missing, then clipped - pandas' fillna(f).clip(lo, hi). */
const fillClip = (x, f, lo, hi) => {
  const n = x == null || x === '' || !Number.isFinite(Number(x)) ? f : Number(x);
  return Math.min(hi, Math.max(lo, n));
};

/**
 * PURE. Everything a model takes, from what the poller holds, or null when
 * the clock, the score or the play is missing.
 *
 * THE PLAY IS THE NEWEST ONE with a known offense - a kickoff and a PAT
 * included - and its possession state is FILLED exactly as the models were
 * trained (the Mac's feature code):
 *   down           fillna(1).clip(1, 4)
 *   distance       fillna(10).clip(0, 30)
 *   yards_to_goal  fillna(50).clip(1, 99)
 * A kickoff is scored as 1st & 10 at midfield, not as the last snap before
 * it: carrying an old down forward is a state the training data never had.
 */
export function modelState({ period, clock, homeScore, awayScore, play, homeTeamId, season }) {
  const t = timeState(period, clock);
  if (!t || homeScore == null || awayScore == null || !play || play.offense_team_id == null) return null;
  return {
    score_diff: Number(homeScore) - Number(awayScore),
    secs_game: t.secs_game, secs_half: t.secs_half, is_ot: t.is_ot,
    posteam_is_home: Number(play.offense_team_id) === Number(homeTeamId) ? 1 : 0,
    down_f: fillClip(play.down, 1, 1, 4),
    ydstogo_f: fillClip(play.distance, 10, 0, 30),
    yards_to_goal: fillClip(play.yards_to_goal, 50, 1, 99),
    season: season == null ? null : Number(season),
  };
}

/** The last pre-kick consensus HOME spread for one match, or null. */
export async function lastPreKickSpread(sql, m) {
  const rows = await sql`
    WITH last AS (
      SELECT max(o.fetched_at) AS at FROM odds_markets o
       WHERE o.match_id = ${m.id} AND o.market_scope = 'match' AND o.market_type = 'spread'
         AND o.fetched_at < ${new Date(m.kickoff_at).toISOString()}::timestamptz)
    SELECT o.selection_label, o.selection_value, o.num_books, o.fetched_at
      FROM odds_markets o, last
     WHERE o.match_id = ${m.id} AND o.market_scope = 'match' AND o.market_type = 'spread'
       AND o.fetched_at BETWEEN last.at - interval '2 minutes' AND last.at
     ORDER BY o.fetched_at DESC`;
  for (const r of rows) {
    if (sideFor(r.selection_label, m.home_name, m.away_name) !== 'home') continue;
    const spread = spreadPoints(r.selection_value);
    if (spread == null) return null;
    return { spread, n_books: r.num_books == null ? null : Number(r.num_books), fetched_at: new Date(r.fetched_at).toISOString() };
  }
  return null;
}

/**
 * The frozen prior, freezing it on first ask. Written ONCE: the UPDATE only
 * lands where market_prior is absent, so a second poller, a restart, or a
 * later odds fetch can never move a prior a game has already been scored on.
 * A game with no pre-kick line freezes nothing and stays without one.
 */
export async function ensureMarketPrior(sql, m, { now = new Date() } = {}) {
  if (m.market_prior && m.market_prior.spread != null) return m.market_prior;
  const got = await lastPreKickSpread(sql, m);
  if (!got) return null;
  const prior = { spread: got.spread, n_books: got.n_books, captured_at: new Date(now).toISOString() };
  const [row] = await sql`
    UPDATE matches
       SET metadata = COALESCE(metadata, '{}'::jsonb) || jsonb_build_object('market_prior', ${JSON.stringify(prior)}::jsonb)
     WHERE id = ${m.id} AND NOT (COALESCE(metadata, '{}'::jsonb) ? 'market_prior')
     RETURNING metadata->'market_prior' AS market_prior`;
  if (row) return row.market_prior;
  const [held] = await sql`SELECT metadata->'market_prior' AS market_prior FROM matches WHERE id = ${m.id}`;
  return held?.market_prior ?? null;
}

/**
 * The newest play with a known offense, as the training rows had it. The
 * row's own score comes too: it is the score AFTER the play (measured: every
 * PROD touchdown and field-goal row), which is what winProbTick compares with
 * the match's.
 */
export async function newestSnap(sql, matchId) {
  const rows = await sql`
    SELECT id, down, distance, yards_to_goal, offense_team_id, play_type, home_score, away_score
      FROM plays
     WHERE match_id = ${matchId} AND offense_team_id IS NOT NULL
     ORDER BY drive_number DESC NULLS LAST, play_number DESC NULLS LAST, id DESC
     LIMIT 1`;
  // NO STOPPAGE SKIP. CFB's training rows (CFBD /plays) carry Timeout, End
  // Period and End of Game rows with an offense - 958 in week 4 alone - and
  // training scored them as states, quirks included ("down 0 clips to 1").
  // Reproducing training means reading them as it did (ruling, 27 Sep: parity
  // first, corrections at the retrain). NFL's carry no offense in either
  // source and are excluded by the query.
  return rows[0] ?? null;
}

/**
 * PURE. ARE THE PLAYS BEHIND THE SCORE? The match score comes from the score
 * poller every 30 s; the play rows from plays-live every one to two minutes.
 * For the minute between, the newest snap is the possession BEFORE the score -
 * the ball at the goal line - while the score already counts the touchdown,
 * and the model counts both: an overshoot that settles when the row lands
 * (Colorado State - UTSA, 26 Sep: 86.8 -> 84.8 on the extra point). A play
 * row's own score is the score AFTER it (every PROD touchdown and field-goal
 * row, 26 Sep), so a match score that differs from it is a score the plays
 * have not reached. Unknown either side: not behind - there is nothing to say.
 */
export function playsBehindScore(snap, homeScore, awayScore) {
  if (!snap || snap.home_score == null || snap.away_score == null || homeScore == null || awayScore == null) return false;
  return Number(snap.home_score) !== Number(homeScore) || Number(snap.away_score) !== Number(awayScore);
}

/**
 * PURE. THE CARD'S FIELDS THROUGH A HOLD, or null when there is no value to
 * hold. The last value is kept; its stamp is refreshed for the first
 * HOLD_FRESH_SEC of a continuous hold and then left to age, so a feed that
 * never catches up turns into the card's honest "Paused - feed reconnecting"
 * (LiveWinProb, 90 s after the stamp) instead of a frozen number that looks
 * live. The longest hold on 26 Sep was 723 s (Utah - Iowa State). Ruling:
 * 180 s. win_prob_hold_since marks the start; a computed value drops it,
 * because writeLive replaces live_state whole.
 */
export const HOLD_FRESH_SEC = 180;
export function heldWinProb(prev, now = new Date()) {
  if (!prev || prev.win_prob == null) return null;
  const t = new Date(now).getTime();
  const since = Number.isFinite(Date.parse(prev.win_prob_hold_since ?? '')) ? prev.win_prob_hold_since : new Date(t).toISOString();
  const fresh = t - Date.parse(since) <= HOLD_FRESH_SEC * 1000;
  return {
    win_prob: prev.win_prob,
    win_prob_at: fresh || prev.win_prob_at == null ? new Date(t).toISOString() : prev.win_prob_at,
    win_prob_hold_since: since,
  };
}

/**
 * ONE LIVE TICK. Returns null when there is nothing to say (no line, no snap
 * yet, no clock), else { sport, p, state, prior, playSeq, model, display }
 * where display is the home percent for a card - an integer - or null for a
 * shadow sport.
 */
export async function winProbTick(sql, m, { liveState, homeScore, awayScore, now = new Date() } = {}) {
  const sport = m.league_slug;
  if (!WINPROB_SPORTS.includes(sport)) return null;
  const mp = await ensureMarketPrior(sql, m, { now });
  const logit = mp ? priorLogit(sport, spreadForModel(sport, mp.spread)) : null;
  if (logit == null) return null;
  const snap = await newestSnap(sql, m.id);
  // NO GUESS WHILE THE PLAYS CATCH UP: the tick HOLDS. Nothing is computed or
  // logged, and the poller keeps the card's last value fresh (ruling, 26 Sep).
  if (playsBehindScore(snap, homeScore, awayScore)) {
    return { sport, hold: true, reason: 'plays-behind-score', p: null, display: null, playSeq: snap?.id ?? null };
  }
  const state = modelState({
    period: liveState?.period, clock: liveState?.clock, homeScore, awayScore,
    play: snap, homeTeamId: m.home_team_id, season: m.season_year,
  });
  if (!state) return null;
  const p = predict(sport, state, logit);
  if (p == null || !Number.isFinite(p)) return null;
  return {
    sport, p, state, prior: { ...mp, prior_logit: logit }, playSeq: snap?.id ?? null,
    model: MODEL_VERSION[sport], display: DISPLAYED[sport] ? Math.round(p * 100) : null,
  };
}

const canon = (o) => JSON.stringify(Object.keys(o ?? {}).sort().map((k) => [k, o[k] == null ? null : Number.isFinite(Number(o[k])) ? Number(o[k]) : o[k]]));

/**
 * Log a tick, once per STATE: a poll whose inputs match the last logged row
 * for the match writes nothing.
 */
export async function logWinProb(sql, matchId, tick, { now = new Date() } = {}) {
  // A HOLD IS NOT A STATE: nothing was computed, so nothing is logged.
  if (!tick || tick.hold) return false;
  const inputs = { ...tick.state, prior_logit: tick.prior.prior_logit, spread: tick.prior.spread };
  const [last] = await sql`SELECT inputs FROM winprob_log WHERE match_id = ${matchId} ORDER BY ts DESC, id DESC LIMIT 1`;
  // KEY ORDER IS NOT A CHANGE. jsonb hands keys back in its own order, so the
  // comparison is on a sorted rendering, not on the two strings as written.
  if (last && canon(last.inputs) === canon(inputs)) return false;
  await sql`
    INSERT INTO winprob_log (match_id, ts, play_seq, p_home, inputs, model_version, sport)
    VALUES (${matchId}, ${new Date(now).toISOString()}, ${tick.playSeq}, ${tick.p}, ${JSON.stringify(inputs)}::jsonb, ${tick.model}, ${tick.sport})`;
  return true;
}
