// lib/mlb/bdlLive.js - the live baseball state, the batting orders and the
// players' names, all from BallDontLie. The replacement for what
// lib/mlb/statsapi.js supplied (runners, batter, pitcher, lineups), measured
// against it on 25 Sep 2026 (CHC @ BOS, BDL 5060187 / statsapi 824703).
//
// THE LIVE STATE COMES FROM /mlb/v1/plate_appearances, ONE PAGE PER GAME. A
// game is ~75 plate appearances, so per_page=100 is the whole game in one call
// - which also retires the poller's old read of /plays, whose first page of
// 100 held only the first ~3 innings and froze the outs and the count there.
//
// WHAT THE MEASUREMENT SAID, and what this code does about it:
//   - The at-bat IN PROGRESS is present (result empty, pitches growing). The
//     NEWEST plate appearance wins.
//   - It runs 30-90 s behind statsapi. Accepted (ruling, 25 Sep).
//   - runner_on_first/second/third and outs are the state at the START of the
//     plate appearance. A steal inside an at-bat shows at the next one.
//     Accepted.
//   - A plate appearance can briefly carry a NON-OUTCOME result ("Batter
//     Timeout") before its real one. Only results in OUTCOMES end an at-bat;
//     anything else is read as still in progress.
//   - Each pitch's balls/strikes is the count BEFORE that pitch - equal to
//     statsapi's on all 289 pitches of the measured game. The count NOW is the
//     last pitch's count plus that pitch's call. A call code this does not
//     know gives NO count: an empty count beats a wrong one.

const BDL = 'https://api.balldontlie.io';

/** Every result BDL wrote on 1,858 finished plate appearances (22-24 Sep). */
export const OUTCOMES = Object.freeze(new Set([
  'Strikeout', 'Groundout', 'Single', 'Flyout', 'Walk', 'Pop Out', 'Lineout', 'Double', 'Home Run',
  'GIDP', 'Forceout', 'Hit By Pitch', 'Field Error', 'Sac Fly', 'Triple', 'Sac Bunt', 'Double Play',
  'Bunt Groundout', 'Fielders Choice Out', 'Caught Stealing 2B', 'Fielders Choice',
  'Strikeout Double Play', 'Catcher Interference', 'Stolen Base 2B', 'Pickoff 1B', 'Intent Walk',
  'Bunt Pop Out', 'Pickoff Caught Stealing 2B',
  // the rest of the same families, which a season will produce
  'Caught Stealing 3B', 'Caught Stealing Home', 'Stolen Base 3B', 'Stolen Base Home', 'Pickoff 2B',
  'Pickoff 3B', 'Pickoff Caught Stealing 3B', 'Pickoff Caught Stealing Home', 'Triple Play',
  'Sac Fly Double Play', 'Sac Bunt Double Play', 'Fan Interference', 'Batter Interference',
]));

export const isOutcome = (result) => OUTCOMES.has(String(result ?? '').trim());

const BALL = new Set(['ball', 'blocked_ball', 'pitchout', 'intent_ball']);
const STRIKE = new Set(['called_strike', 'swinging_strike', 'swinging_strike_blocked', 'foul_tip', 'missed_bunt']);
const FOUL = new Set(['foul', 'foul_bunt']);
const ENDS = new Set(['hit_into_play', 'hit_by_pitch']);

/**
 * PURE. The count after the last pitch thrown, or null when there is none to
 * give: no pitch yet is 0-0; a call this does not know is null, never a guess.
 */
export function countNow(pitches) {
  const list = Array.isArray(pitches) ? pitches : [];
  if (!list.length) return { balls: 0, strikes: 0 };
  const last = list[list.length - 1];
  const b = Number(last?.balls); const s = Number(last?.strikes);
  if (!Number.isInteger(b) || !Number.isInteger(s)) return null;
  const code = String(last?.pitch_call_code ?? '').trim();
  if (BALL.has(code)) return b >= 3 ? null : { balls: b + 1, strikes: s };
  if (STRIKE.has(code)) return s >= 2 ? null : { balls: b, strikes: s + 1 };
  if (FOUL.has(code)) {
    if (code === 'foul_bunt' && s >= 2) return null;       // a two-strike foul bunt is a strikeout
    return { balls: b, strikes: Math.min(2, s + 1) };
  }
  if (ENDS.has(code)) return null;                         // the at-bat is over
  return null;                                             // a call we do not know
}

/**
 * PURE. The live state, from a game's plate appearances, in the shape the
 * poller's merge already takes (lib/mlb/ingest.js mergeStatsApi):
 * { period, half, outs, balls, strikes, bases, batterId, pitcherId }.
 * Null when there is no plate appearance yet.
 */
export function liveFromPlateAppearances(pas) {
  const list = Array.isArray(pas) ? pas.filter((p) => Number.isFinite(Number(p?.pa_number))) : [];
  if (!list.length) return null;
  const pa = list.reduce((m, p) => (Number(p.pa_number) > Number(m.pa_number) ? p : m));
  const inProgress = !isOutcome(pa.result);
  const half = String(pa.half_inning ?? '').trim().toLowerCase();
  const count = inProgress ? countNow(pa.pitches) : null;
  const num = (v) => (v == null || v === '' || !Number.isFinite(Number(v)) ? null : Number(v));
  return {
    period: num(pa.inning),
    half: half === 'top' ? 'Top' : half === 'bottom' ? 'Bottom' : null,
    outs: num(pa.outs),
    balls: count ? count.balls : null,
    strikes: count ? count.strikes : null,
    bases: { first: Boolean(pa.runner_on_first), second: Boolean(pa.runner_on_second), third: Boolean(pa.runner_on_third) },
    batterId: pa.batter_id == null ? null : String(pa.batter_id),
    pitcherId: pa.pitcher_id == null ? null : String(pa.pitcher_id),
    paNumber: num(pa.pa_number),
    inProgress,
  };
}

async function bdlGet(path, { key = process.env.BDL_API_KEY, fetchImpl = fetch } = {}) {
  if (!key) throw new Error('BDL_API_KEY is not set');
  const res = await fetchImpl(`${BDL}${path}`, { headers: { Authorization: key } });
  if (!res.ok) throw new Error(`BDL ${path.split('?')[0]} -> ${res.status}`);
  return res.json();
}

/** Every plate appearance of one game (one page, walking a cursor if a game ever runs past 100). */
export async function fetchPlateAppearances(gameId, opts = {}) {
  const out = []; let cursor = null; let calls = 0;
  do {
    const j = await bdlGet(`/mlb/v1/plate_appearances?game_id=${encodeURIComponent(gameId)}&per_page=100${cursor ? `&cursor=${cursor}` : ''}`, opts);
    calls += 1;
    out.push(...(j?.data ?? []));
    cursor = j?.meta?.next_cursor ?? null;
  } while (cursor && calls < 5);
  return { pas: out, calls };
}

// NAMES, CACHED. A game's batters and pitchers are a few dozen ids that never
// change their names mid-game; one lookup per new id, kept for the process.
const nameCache = new Map();
export function _resetNameCache() { nameCache.clear(); }

/** id -> full name, fetching only the ids not seen before. */
export async function playerNames(ids, opts = {}) {
  const want = [...new Set((ids ?? []).filter((x) => x != null).map(String))];
  const missing = want.filter((id) => !nameCache.has(id));
  let calls = 0;
  for (let i = 0; i < missing.length; i += 25) {
    const q = missing.slice(i, i + 25).map((id) => `player_ids[]=${encodeURIComponent(id)}`).join('&');
    const j = await bdlGet(`/mlb/v1/players?${q}&per_page=100`, opts);
    calls += 1;
    for (const p of j?.data ?? []) {
      const name = p?.full_name ?? [p?.first_name, p?.last_name].filter(Boolean).join(' ');
      if (p?.id != null && name) nameCache.set(String(p.id), name);
    }
  }
  return { names: new Map(want.map((id) => [id, nameCache.get(id) ?? null])), calls };
}

/**
 * The live object the poller merges, names resolved. Null before the first
 * plate appearance. Never throws past a failed name lookup: a state without a
 * batter's name is still the right outs and runners.
 */
export async function bdlLiveState(gameId, opts = {}) {
  const { pas, calls } = await fetchPlateAppearances(gameId, opts);
  const s = liveFromPlateAppearances(pas);
  if (!s) return { live: null, calls };
  let names = new Map(); let nameCalls = 0;
  try { ({ names, calls: nameCalls } = await playerNames([s.batterId, s.pitcherId], opts)); } catch { /* names are optional */ }
  const live = {
    period: s.period, half: s.half, outs: s.outs, balls: s.balls, strikes: s.strikes, bases: s.bases,
    batter: s.inProgress ? (names.get(s.batterId) ?? null) : null,
    pitcher: names.get(s.pitcherId) ?? null,
  };
  return { live, calls: calls + nameCalls };
}

/**
 * PURE. One game's /lineups rows -> the batting orders in metadata.lineups'
 * shape: { away, home } of [{ id, name, position, order }] or null for a side
 * not posted. The order is batting_order; the probable pitcher rows (no
 * batting_order) are not batters. Null when neither side has posted.
 */
export function lineupsFromRows(rows, { awayAbbr, homeAbbr } = {}) {
  const list = Array.isArray(rows) ? rows : [];
  const side = (abbr) => {
    const r = list.filter((x) => String(x?.team?.abbreviation ?? '').toUpperCase() === String(abbr ?? '').toUpperCase()
      && Number.isInteger(Number(x?.batting_order)) && x?.batting_order != null)
      .sort((a, b) => Number(a.batting_order) - Number(b.batting_order));
    if (!r.length) return null;
    return r.map((x) => ({
      id: String(x.player?.id),
      name: x.player?.full_name ?? [x.player?.first_name, x.player?.last_name].filter(Boolean).join(' '),
      position: x.position ?? null,
      order: Number(x.batting_order),
    }));
  };
  const away = side(awayAbbr); const home = side(homeAbbr);
  if (!away && !home) return null;
  return { away, home };
}
