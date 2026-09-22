// lib/mlb/ingest.js - the BDL MLB payload -> the things we own. PURE: no DB,
// no clock, no I/O.
//
// THE FIELD NAMES ARE NOT THE NFL'S, and that is the whole reason this file
// exists rather than a branch inside services/live-poller/poll.mjs fromBdl().
// That normaliser reads `home_team_score` / `visitor_team_score`; the MLB
// payload carries NEITHER. Runs live in home_team_data.runs / away_team_data.runs,
// beside hits, errors and the inning-by-inning line score. One shared function
// with two field vocabularies inside it is how a feed change breaks the other
// sport.
//
// THE LIVE STATE IS AN INNING AND A HALF, NEVER A CLOCK. BDL sends `clock: 0`
// and `display_clock: "0:00"` on every MLB row - scheduled, live and final
// alike, measured 22 Sep 2026 - so a surface that renders the clock puts a
// stopped clock on a live game. liveStateOf() below never emits one.
//
// THE HALF IS NOT ON THE GAME ROW, AND IS DERIVED HONESTLY. /games gives the
// inning (`period`) but not which half is being played. The two inning_scores
// arrays answer it: while the top half is under way the away side has batted in
// this inning and the home side has not, so away.length > home.length. Equal
// lengths mean the home side has batted too, which is the bottom. Measured on
// a live game (MIN @ SF, 7th inning: away 7 entries, home 6).
//   THE PLAYS FEED KNOWS BETTER and says so outright - /plays carries
//   `inning_type` of Top/Bottom/Mid/End, including the two between-halves
//   states this derivation cannot see. Where a play row is available the poller
//   passes its half in and this derivation is not used; it is the fallback for
//   a tick where only /games has been read.

import { mapLiveStatus } from '../live/vocabulary.js';

/** Runs, from the only place this feed puts them. */
const runs = (side) => {
  const v = side?.runs;
  if (v == null || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

/** The inning-by-inning line, plus the R/H/E a baseball box carries. */
export function lineScoreOf(row) {
  const side = (s) => {
    const d = row?.[s] ?? null;
    if (!d) return null;
    const innings = Array.isArray(d.inning_scores)
      ? d.inning_scores.map((v) => (v == null || v === '' ? null : Number(v)))
      : [];
    return {
      innings,
      runs: runs(d),
      hits: d.hits == null ? null : Number(d.hits),
      errors: d.errors == null ? null : Number(d.errors),
    };
  };
  const home = side('home_team_data'); const away = side('away_team_data');
  if (!home && !away) return null;
  return { home, away };
}

/**
 * WHICH HALF, from the two line-score arrays. See the header for why this is
 * a real signal and not an inference. Returns 'Top' | 'Bottom' | null.
 */
export function halfFromInnings(line) {
  const a = line?.away?.innings?.length;
  const h = line?.home?.innings?.length;
  if (!Number.isFinite(a) || !Number.isFinite(h)) return null;
  if (a === 0 && h === 0) return null;
  return a > h ? 'Top' : a === h ? 'Bottom' : null;
}

/**
 * The live state a baseball card reads. NO CLOCK, EVER.
 *
 * @param row   a /games row
 * @param play  the newest /plays row for this game, when the poller has one -
 *              it carries the authoritative half plus the outs and the count,
 *              none of which is on the game row.
 */
export function liveStateOf(row, play = null) {
  const p = Number(row?.period);
  if (!Number.isFinite(p) || p < 1) return null;
  const line = lineScoreOf(row);
  const half = play?.inning_type
    ? String(play.inning_type).trim()
    : halfFromInnings(line);
  const num = (v) => (v == null || v === '' ? null : (Number.isFinite(Number(v)) ? Number(v) : null));
  const state = { period: p, half: half ?? null };
  // OUTS AND THE COUNT COME FROM THE PLAY AND NOWHERE ELSE. /games has no
  // such field; a card that wants them without a play row shows none, which
  // is the honest gap rather than a zero that reads as "nobody out".
  if (play) {
    state.outs = num(play.outs);
    state.balls = num(play.balls);
    state.strikes = num(play.strikes);
  }
  return state;
}

/** The scoring plays, oldest first, as the card and the push both read them. */
export function scoringPlaysOf(row) {
  const raw = Array.isArray(row?.scoring_summary) ? row.scoring_summary : [];
  return raw.map((s) => ({
    text: String(s?.play ?? '').trim() || null,
    half: String(s?.inning ?? '').trim() || null,     // "top" | "bottom"
    inning: String(s?.period ?? '').trim() || null,   // "1st", "6th"
    homeScore: s?.home_score == null ? null : Number(s.home_score),
    awayScore: s?.away_score == null ? null : Number(s.away_score),
  })).filter((s) => s.text);
}

/** REG / POST, from the feed's own two fields rather than from the date. */
export function seasonPhaseOf(row) {
  if (row?.postseason === true) return 'POST';
  const t = String(row?.season_type ?? '').trim().toLowerCase();
  if (t === 'postseason' || t === 'post') return 'POST';
  if (t === 'regular') return 'REG';
  // A PHASE WE HAVE NOT SEEN IS NOT GUESSED. Spring training and the all-star
  // game both exist on this feed's calendar and neither is a REG game; null
  // lets the caller refuse the row rather than file it under the season.
  return null;
}

/**
 * THE NORMALISER, in the shape services/live-poller/poll.mjs already consumes:
 * { providerId, status, homeScore, awayScore, liveState }. Everything else a
 * baseball card needs - the line score, the scoring plays, the phase - rides
 * alongside so one parse serves the poller and the ingest both.
 */
export function fromBdlMlb(row, unmapped, { play = null, live = null } = {}) {
  const status = mapLiveStatus('bdl', row?.status_state, unmapped);
  const ls = status === 'live' ? liveStateOf(row, play) : null;
  return {
    providerId: row?.id == null ? null : String(row.id),
    status,
    homeScore: runs(row?.home_team_data),
    awayScore: runs(row?.away_team_data),
    // THE STATE ONLY MEANS ANYTHING WHILE THE GAME IS ON. A scheduled row
    // carries period 1 and empty inning arrays; a final carries the inning it
    // ended in. Neither is a live state, and scopeToStatus would null it
    // anyway - doing it here as well keeps the two honest about the same rule.
    //
    // THE SECOND PROVIDER RIDES ON TOP, never underneath. lib/mlb/statsapi.js
    // is the ONLY source of runners, the batter and the pitcher - BDL carries
    // none of the three - and it is also more authoritative about the half and
    // the outs, because it reads the game feed rather than the last play row.
    // Its fields are merged only where it HAS them: a feed that came back
    // without bases must not delete the inning BDL just told us.
    liveState: ls ? mergeStatsApi(ls, live) : null,
    lineScore: lineScoreOf(row),
    scoringPlays: scoringPlaysOf(row),
    seasonPhase: seasonPhaseOf(row),
    venue: String(row?.venue ?? '').trim() || null,
  };
}

/**
 * BDL's state, with statsapi's on top where statsapi has it.
 *
 * EVERY FIELD IS TESTED FOR PRESENCE, not for truthiness - `outs: 0` and
 * `balls: 0` are real readings and the sixth and seventh times this build has
 * had to say so. `bases` is the only field with no BDL counterpart at all.
 */
export function mergeStatsApi(base, live) {
  if (!live) return base;
  const out = { ...base };
  for (const k of ['period', 'half', 'outs', 'balls', 'strikes', 'bases', 'batter', 'pitcher']) {
    if (live[k] != null) out[k] = live[k];
  }
  return out;
}
