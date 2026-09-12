// lib/gridiron/scoresV2Shape.js - the Scores tab v2, PURE (SCORES TAB v2 relay).
//
// The reader (scoresV2.js) fetches; these decide: which day a game belongs
// to in the viewer's zone, the seven-day strip and its count lines, the three
// groups and their order, what a pick is doing, which card a game gets, and
// the Mine count. Fixtures in scoresV2Shape.test.mjs pin each one.

import { downDistanceLabel, spotLabel } from './driveStrip.js';

export const ET = 'America/New_York';
export const LEAGUES = Object.freeze(['nfl', 'cfb', 'epl']);
export const LEAGUE_LABEL = Object.freeze({ nfl: 'NFL', cfb: 'CFB', epl: 'EPL' });

const partsFmt = new Map();
function parts(iso, tz) {
  const key = tz;
  if (!partsFmt.has(key)) {
    partsFmt.set(key, new Intl.DateTimeFormat('en-US', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', weekday: 'short', hour: 'numeric', hourCycle: 'h23' }));
  }
  return Object.fromEntries(partsFmt.get(key).formatToParts(new Date(iso)).map((p) => [p.type, p.value]));
}

/** 'YYYY-MM-DD' of an instant in the viewer's zone. */
export function viewerDay(iso, tz = ET) {
  const p = parts(iso, tz);
  return `${p.year}-${p.month}-${p.day}`;
}

/** Shift a 'YYYY-MM-DD' by n days (calendar arithmetic, no zone). */
export function shiftDay(ymd, n) {
  const d = new Date(`${ymd}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const DOW_LONG = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
export const weekdayOf = (ymd, long = false) => (long ? DOW_LONG : DOW)[new Date(`${ymd}T12:00:00Z`).getUTCDay()];
export const dayNumOf = (ymd) => Number(ymd.slice(8, 10));
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export const monthDayOf = (ymd) => `${MON[Number(ymd.slice(5, 7)) - 1]} ${dayNumOf(ymd)}`;

/** Seven days centred on `today` (viewer's zone): today-3 .. today+3. */
export function dayStripDays(today) {
  return [-3, -2, -1, 0, 1, 2, 3].map((n) => {
    const date = shiftDay(today, n);
    return { date, dow: weekdayOf(date), day: dayNumOf(date), isToday: n === 0 };
  });
}

/** Per-day status buckets for a set of games, in the viewer's zone. */
export function dayCounts(games, tz = ET) {
  const out = new Map();
  for (const g of games) {
    const d = viewerDay(g.kickoffAt, tz);
    const c = out.get(d) ?? { live: 0, final: 0, scheduled: 0, epl: 0 };
    if (g.status === 'live') c.live += 1;
    else if (g.status === 'final') c.final += 1;
    else c.scheduled += 1;
    if (g.leagueSlug === 'epl') c.epl += 1;
    out.set(d, c);
  }
  return out;
}

/** "3 live" (live-red) / "4 final" / "14 games" / "2 final · 3 games" / "EPL" / "no games". */
export function countLine(c) {
  if (!c) return { text: 'no games', live: false };
  if (c.live > 0) return { text: `${c.live} live`, live: true };
  const total = c.final + c.scheduled;
  if (total === 0) return { text: 'no games', live: false };
  if (c.epl === total && c.scheduled > 0 && c.final === 0) return { text: 'EPL', live: false };
  if (c.final > 0 && c.scheduled === 0) return { text: `${c.final} final`, live: false };
  if (c.scheduled > 0 && c.final === 0) return { text: `${c.scheduled} game${c.scheduled === 1 ? '' : 's'}`, live: false };
  return { text: `${c.final} final · ${c.scheduled} game${c.scheduled === 1 ? '' : 's'}`, live: false };
}

export const cardVariant = (g) => (g.status === 'live' ? 'live' : g.status === 'final' ? 'final' : 'upcoming');

/** What a Pick'em side is doing right now. */
export function pickState({ side, homeScore, awayScore, status }) {
  if (!side) return null;
  const h = Number(homeScore), a = Number(awayScore);
  if (!Number.isFinite(h) || !Number.isFinite(a)) return status === 'final' ? 'lost' : 'pending';
  if (status === 'final') {
    if (h === a) return 'push';
    return (side === 'home' ? h > a : a > h) ? 'won' : 'lost';
  }
  if (status === 'live') {
    if (h === a) return 'tied';
    return (side === 'home' ? h > a : a > h) ? 'winning' : 'losing';
  }
  return 'pending';
}
export const pickTone = (state) => (state === 'won' || state === 'winning' ? 'good' : state === 'lost' || state === 'losing' ? 'bad' : '');

/** The Mine count: matches with any stake or an alert. */
export function hasStake(s) {
  return Boolean(s && (s.pick || (s.weekly && s.weekly.length) || s.alerts));
}
export const mineCount = (games, stake) => games.filter((g) => hasStake(stake?.get(g.id))).length;

/**
 * THE THREE GROUPS, in order: Live now (every live game, whatever day is
 * picked), the picked day's upcoming games, the picked day's finals. Empty
 * groups are omitted. `sport` narrows by league, `mine` to staked matches.
 */
export function groupGames(games, { date, today, tz = ET, sport = 'all', mine = false, stake = null, signedIn = false } = {}) {
  const keep = games.filter((g) => (sport === 'all' || g.leagueSlug === sport) && (!mine || hasStake(stake?.get(g.id))));
  const live = keep.filter((g) => g.status === 'live');
  const onDay = keep.filter((g) => g.status !== 'live' && viewerDay(g.kickoffAt, tz) === date);
  const upcoming = onDay.filter((g) => g.status !== 'final');
  const finals = onDay.filter((g) => g.status === 'final');
  const dayTitle = date === today ? 'Today'
    : date === shiftDay(today, 1) ? `Tomorrow · ${weekdayOf(date, true)}`
      : date === shiftDay(today, -1) ? `Yesterday · ${weekdayOf(date, true)}`
        : `${weekdayOf(date, true)} · ${monthDayOf(date)}`;
  const groups = [];
  if (live.length) groups.push({ key: 'live', title: 'Live now', sub: 'updates every 30s', games: live });
  if (upcoming.length) groups.push({ key: 'day', title: dayTitle, sub: `${upcoming.length} game${upcoming.length === 1 ? '' : 's'}${signedIn ? ' · your picks lock at kick' : ''}`, games: upcoming });
  if (finals.length) groups.push({ key: 'final', title: 'Final', sub: weekdayOf(date), games: finals });
  return groups;
}

/** The live drive strip, from the latest down-bearing play. */
export function driveStripFor({ play, lastText = null, game }) {
  if (!play || play.down == null) return null;
  const offenseIsHome = play.offenseTeamId != null && play.offenseTeamId === game.home?.id;
  const offense = offenseIsHome ? game.home : game.away;
  const defense = offenseIsHome ? game.away : game.home;
  const ytg = play.yardsToGoal == null ? null : Number(play.yardsToGoal);
  // Progress toward the goal, 0 at the offense's own goal line, 100 at the score.
  const pct = ytg == null ? null : Math.max(0, Math.min(100, 100 - ytg));
  return {
    label: downDistanceLabel(play.down, play.distance, ytg),
    spot: spotLabel(ytg, offense?.abbreviation, defense?.abbreviation),
    offenseAbbr: offense?.abbreviation ?? null,
    pct,
    lastPlay: lastText ?? play.text ?? null,
  };
}

/** "Purdy 25/34 · 205 · 3 TD" / "Haaland 2, Foden 1". */
export function statLineText(row, league) {
  if (!row) return null;
  if (league === 'epl') { const sc = (row.scorers ?? []).filter((s) => Number(s.goals) > 0); return sc.length ? sc.map((s) => `${s.name} ${s.goals}`).join(', ') : null; }
  const last = String(row.name ?? '').trim().split(/\s+/).pop();
  // R3: a leader with 0 in the stat is no line at all.
  if (!last || !(Number(row.passAtt) > 0) || !(Number(row.passYds) > 0)) return null;
  const td = Number(row.passTd ?? 0);
  return `${last} ${row.passCmp ?? 0}/${row.passAtt} · ${row.passYds ?? 0}${td ? ` · ${td} TD` : ''}`;
}

/** Spread + total foot: "Spread DEN -5.5 · O/U 43.5". */
export function oddsLine(g, spreadHome, total) {
  const bits = [];
  if (spreadHome != null && Number.isFinite(Number(spreadHome))) {
    const s = Number(spreadHome);
    const fav = s <= 0 ? g.home : g.away;
    bits.push(`Spread ${fav?.abbreviation ?? ''} ${s <= 0 ? s : -s}`.trim());
  }
  if (total != null && Number.isFinite(Number(total))) bits.push(`O/U ${Number(total)}`);
  return bits.length ? bits.join(' · ') : null;
}

/** EPL win probability bar: the favoured side and its pct, from the model. */
export function eplBar(prob, g) {
  if (!prob) return null;
  const home = Number(prob.home), away = Number(prob.away);
  if (!Number.isFinite(home) || !Number.isFinite(away)) return null;
  const favHome = home >= away;
  return { abbr: (favHome ? g.home : g.away)?.abbreviation ?? '', pct: Math.round(favHome ? home : away) };
}
