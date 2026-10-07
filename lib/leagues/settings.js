// lib/leagues/settings.js - what a league IS: its games, how long it runs, how
// it is scored, its format, its door. PURE and client-safe (the create sheet
// and the server read the same rules, so they cannot disagree about one).
//
// THE RULES, each with its sentence (the server returns the sentence; the sheet
// greys the option that would earn it, so a reader rarely sees one):
//   - at least one game, every game a registered key (lib/leagues/gameTypes.js);
//   - SURVIVOR is not offered while lib/survivor/flag.js says it is off;
//   - TOTAL POINTS NEEDS EXACTLY ONE GAME. A bundle ranks everyone in each game
//     and adds up the places, because two games' scores are not one unit;
//   - a DAILY span only holds games that are played by the day - Pick'em is a
//     week, and a "day" of it is nothing;
//   - the guillotine and drop-the-worst both need a SEASON (more than one
//     period to chop or drop), and they do not combine - a guillotine counts
//     every period by definition;
//   - 2 to 100 members.

import { LEAGUE_GAME_TYPES } from './gameTypes.js';
import { survivorOn } from '../survivor/flag.js';
import { validatePickFormat, leaguePlaysPickem } from './pickFormat.js';

export const SPANS = Object.freeze(['daily', 'weekly', 'season']);
export const SCORINGS = Object.freeze(['rank', 'total']);
export const FORMATS = Object.freeze(['table', 'guillotine']);
export const MEMBERS_MIN = 2;
export const MEMBERS_MAX = 100;
export const MEMBERS_DEFAULT = 12;

/** The period one result belongs to, per game. A round of The Run counts like
 * a day for the start line; P2's period map decides how a week holds it. */
export const GAME_PERIOD = Object.freeze({
  pickem: 'week', weekly: 'week', draft: 'week', survivor: 'week',
  daily: 'day', october: 'day', six: 'day', run: 'round',
  // EPL Weekly 5 is a matchweek - not an NFL week, so it anchors like a round.
  epl_weekly_5: 'round',
});

export const SPAN_LABEL = Object.freeze({ daily: 'Daily', weekly: 'Weekly', season: 'Season' });
export const SCORING_LABEL = Object.freeze({ rank: 'Rank points', total: 'Total points' });
export const FORMAT_LABEL = Object.freeze({ table: 'Table', guillotine: 'Guillotine' });

export const SETTING_REFUSALS = Object.freeze({
  no_games: 'Pick at least one game',
  unknown_game: 'That game is not one a league can play',
  survivor_off: 'Survivor is not open right now',
  bad_span: 'Pick how long it runs',
  daily_span: 'A daily league only holds games played by the day',
  bad_scoring: 'Pick how it is scored',
  total_one_game: 'Total points needs exactly one game - a bundle uses rank points',
  bad_format: 'Pick a format',
  guillotine_season: 'A guillotine needs a season to chop through',
  drop_season: 'Dropping a worst week needs a season table',
  bad_members: `Max members is ${MEMBERS_MIN} to ${MEMBERS_MAX}`,
});

// ---------------------------------------------------------------------------
// RANK POINTS - THE ONE SCALE. Every surface that awards or explains rank
// points reads these two functions: lib/leagues/standings.js awards with
// rankPoints(), the create sheet and the league board explain with
// rankPointsCopy(). 1st in a unit scores N (the member count), each place
// below one fewer, never below 0; tied places share the higher place's points
// (thu-14 ruling b) and no entry scores 0 (ruling a).
// RULED N members (Derik, fri-2) - change it HERE and only here.
// ---------------------------------------------------------------------------
export function rankPoints(place, memberCount) {
  return Math.max(0, Number(memberCount) - Number(place) + 1);
}

/** The sentence. With `memberCount` it names this league's top score. */
export function rankPointsCopy(unit = 'week', memberCount = null) {
  // Derik, fri-2: the create sheet reads EXACTLY this.
  if (memberCount == null) return '1st earns one point per member, last earns 1';
  const n = Number(memberCount);
  return `1st in a game's ${unit} = ${rankPoints(1, n)} here (${n} ${n === 1 ? 'member' : 'members'}), each place below one fewer.`;
}

/** The games the create sheet offers - Survivor only while its flag is on. */
export function leagueGameChoices({ survivor = survivorOn() } = {}) {
  return LEAGUE_GAME_TYPES
    .filter((g) => g.key !== 'survivor' || survivor)
    .map((g) => ({ key: g.key, label: g.label, sports: [...g.sports], sub: gameSub(g) }));
}

/** The small line under a game's name: its sports, or "All sports". */
export function gameSub(g) {
  return g.sports.length ? g.sports.map((s) => s.toUpperCase()).join(' · ') : 'All sports';
}

/** Can this span hold these games? Only a daily span is picky. */
export function spanHolds(span, games) {
  if (span !== 'daily') return true;
  return games.every((k) => GAME_PERIOD[k] === 'day');
}

const bool = (v) => v === true || v === 'true' || v === 'on' || v === '1' || v === 1;

/**
 * Raw input (a FormData's values or a plain object) -> { ok, settings } or
 * { ok: false, reason }. `survivor` is the flag, passed in so a test can hold it.
 */
export function validateLeagueSettings(raw = {}, { survivor = survivorOn() } = {}) {
  const fail = (k) => ({ ok: false, reason: SETTING_REFUSALS[k], code: k });
  const list = Array.isArray(raw.games) ? raw.games : String(raw.games ?? '').split(',');
  const games = [...new Set(list.map((g) => String(g).trim()).filter(Boolean))];
  if (!games.length) return fail('no_games');
  const known = new Map(LEAGUE_GAME_TYPES.map((g) => [g.key, g]));
  for (const k of games) {
    if (!known.has(k)) return fail('unknown_game');
    if (k === 'survivor' && !survivor) return fail('survivor_off');
  }
  // Calendar order, whatever order they were tapped in - one league, one spelling.
  games.sort((a, b) => LEAGUE_GAME_TYPES.findIndex((g) => g.key === a) - LEAGUE_GAME_TYPES.findIndex((g) => g.key === b));

  const span = String(raw.span ?? '');
  if (!SPANS.includes(span)) return fail('bad_span');
  if (!spanHolds(span, games)) return fail('daily_span');

  const scoring = String(raw.scoring ?? '');
  if (!SCORINGS.includes(scoring)) return fail('bad_scoring');
  if (scoring === 'total' && games.length !== 1) return fail('total_one_game');

  const format = String(raw.format ?? '');
  if (!FORMATS.includes(format)) return fail('bad_format');
  if (format === 'guillotine' && span !== 'season') return fail('guillotine_season');

  const dropWorst = bool(raw.dropWorst);
  if (dropWorst && (span !== 'season' || format !== 'table')) return fail('drop_season');

  const maxMembers = Number(raw.maxMembers);
  if (!Number.isInteger(maxMembers) || maxMembers < MEMBERS_MIN || maxMembers > MEMBERS_MAX) return fail('bad_members');

  // HOW PICK'EM SCORES (S2): only a league that plays Pick'em has a choice; the
  // rest are REGULAR, which is what the column defaults to anyway.
  const pf = validatePickFormat(raw.pickFormat);
  if (!pf.ok) return { ok: false, reason: pf.reason, code: pf.code };
  const pickFormat = leaguePlaysPickem(games) ? pf.pickFormat : 'regular';

  return {
    ok: true,
    settings: { games, span, scoring, format, dropWorst, maxMembers, lateJoins: bool(raw.lateJoins), pickFormat },
  };
}

/** The rows player_league_games gets: one per (game, sport); no sport = 'all'. */
export function gameRows(games) {
  const out = [];
  for (const k of games) {
    const g = LEAGUE_GAME_TYPES.find((x) => x.key === k);
    if (!g) continue;
    if (!g.sports.length) out.push({ game_type: k, sport: 'all' });
    for (const s of g.sports) out.push({ game_type: k, sport: s });
  }
  return out;
}

/** player_league_games rows -> distinct game keys, calendar order. */
export function gamesFromRows(rows = []) {
  const keys = new Set(rows.map((r) => r.game_type));
  return LEAGUE_GAME_TYPES.filter((g) => keys.has(g.key)).map((g) => g.key);
}

export const gameLabel = (k) => LEAGUE_GAME_TYPES.find((g) => g.key === k)?.label ?? k;

/** "Pick'em + The Weekly · Season · Rank points · Table" - the summary bar ("· Confidence" after the games for a confidence league). */
export function summaryLine({ games = [], span, scoring, format, pickFormat, pick_format } = {}) {
  const parts = [];
  if (games.length) parts.push(games.map(gameLabel).join(' + '));
  // A CONFIDENCE league says so; REGULAR is the default and stays unsaid.
  if ((pickFormat ?? pick_format) === 'confidence' && leaguePlaysPickem(games)) parts.push('Confidence');
  if (SPAN_LABEL[span]) parts.push(SPAN_LABEL[span]);
  if (SCORING_LABEL[scoring]) parts.push(SCORING_LABEL[scoring]);
  if (FORMAT_LABEL[format]) parts.push(FORMAT_LABEL[format]);
  return parts.join(' · ');
}

/** The chips a league card wears: its games, then span and format. */
export function leagueChips({ games = [], span, format } = {}) {
  return [...games.map(gameLabel), SPAN_LABEL[span], FORMAT_LABEL[format]].filter(Boolean);
}

// ---------------------------------------------------------------------------
// THE START ANCHOR. Pure choice over anchors the server loads (lib/leagues/
// start.js): `nfl` = the next NFL regular-season week whose FIRST kickoff is
// still ahead, `day` = tomorrow's ET date and its midnight. A week game anchors
// on the NFL week, a day or round game on the day; the league starts at the
// earliest of them - the late-join line is the first moment anything counts.
// ---------------------------------------------------------------------------
export function chooseStart(games = [], { nfl = null, day = null } = {}) {
  const weekly = games.some((k) => GAME_PERIOD[k] === 'week');
  const daily = games.some((k) => GAME_PERIOD[k] === 'day' || GAME_PERIOD[k] === 'round');
  const out = { startsAt: null, startSeason: null, startWeek: null, startDate: null };
  const ats = [];
  if (weekly && nfl) { out.startSeason = nfl.season; out.startWeek = nfl.week; ats.push(new Date(nfl.at)); }
  if (daily && day) { out.startDate = day.date; ats.push(new Date(day.at)); }
  if (ats.length) out.startsAt = new Date(Math.min(...ats.map((d) => d.getTime()))).toISOString();
  return out;
}

const NFL_LAST_REG_WEEK = 18;
const fmtDay = (iso) => {
  const [y, m, d] = String(iso).split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d, 12)).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' });
};

/** The line under HOW LONG - what the span means for THESE games, with dates. */
export function spanLine(span, games = [], anchors = {}) {
  const s = chooseStart(games, anchors);
  const byWeek = s.startWeek != null;
  const unit = byWeek ? 'week' : 'day';
  const from = byWeek ? `Week ${s.startWeek}` : s.startDate ? fmtDay(s.startDate) : null;
  if (span === 'daily') return from ? `A fresh winner every day, from ${from}.` : 'A fresh winner every day.';
  if (span === 'weekly') return from ? `A fresh winner every week, from ${from}.` : 'A fresh winner every week.';
  if (byWeek) return `Season runs Week ${s.startWeek} to Week ${NFL_LAST_REG_WEEK}, with a winner every week along the way.`;
  return from ? `Season runs from ${from} on, with a winner every ${unit} along the way.` : `One table for the whole season.`;
}

/** "Sat, Oct 3" / "Week 5" - when a league starts, for the late-join line. */
export function startLabel(start = {}) {
  if (start.startsAt) {
    return new Date(start.startsAt).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'America/New_York' });
  }
  return start.startWeek != null ? `Week ${start.startWeek}` : null;
}
