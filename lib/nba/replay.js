// lib/nba/replay.js - the NBA live path, replayed from a finished game.
//
// WHY. Preseason is not in BDL and /nba/v1/box_scores/live keeps no history,
// so the first live NBA game the poller would ever see is the 20 Oct opener.
// A recorded game (scripts/nba-replay-record.mjs: the final /games row, every
// play with its wallclock, the box score) is enough to say what the live feed
// would have said at any second, and this file says it:
//
//   before the first play     status_state 'scheduled', period 0, no clock
//   between first and last    'in_progress'; period, clock and both scores
//                             from the newest play at or before T; the line
//                             score summed from the plays, period by period
//   after "End Game"          the recorded final row, exactly
//
// THE `time` SPELLING IS SYNTHETIC. The live feed's own has never been seen;
// this emits the bare clock ("5:12", "1.5", "0.0") and "Halftime" after the
// second period ends - shapes parseNbaLive accepts. What the replay proves is
// everything downstream of that string; what it cannot prove is the string.
//
// TIMEOUTS AND THE BONUS ARE SYNTHESISED FROM THE PLAYS (nba-card, thu-37), so
// the card's BONUS tag and timeout count can be drawn from a replay. The rules
// are the NBA's, applied to the recorded plays. Against the three recorded
// final rows the bonus is exact on all six sides and the timeouts on five (the
// blowout's SAS reads 4 where the feed said 3 - a charge the plays do not
// name). Pinned in lib/nba/card.test.mjs:
//   timeouts  seven per team in regulation; two per team in each overtime,
//             nothing carried in. A "Full Timeout" play is charged to its team.
//   bonus     X_in_bonus means X SHOOTS the bonus (the feed's sense, read off
//             the three finals): the OTHER side has committed five team fouls
//             in the period (four in overtime), or two inside its last two
//             minutes. Offensive and technical fouls are not team fouls.
// The live feed sends both fields itself; only the harness derives them.
//
// THE IN-GAME BOX IS SYNTHESISED TOO, points only: the recorder holds the
// final box, and a live card's top-scorer line beside a Q2 score would be the
// final's 38. Before "End Game" each player's pts is the sum of the score
// changes on plays whose text starts "<their name> makes" - close to, not
// exactly, the recorded total (a handful of plays name a player the box
// spells differently). Every other column is the final's. After "End Game"
// the recorded box, exactly, so the sum-to-final checks are unchanged.
//
// THE STUB SERVES THE ROUTES THE POLLER AND THE STATS SYNC ASK FOR:
//   /nba/v1/games?dates[]=..       the game row at T for each game filed on a date asked
//   /nba/v1/box_scores/live        the in-progress rows at T
//   /nba/v1/stats?game_ids[]=X     the box at T (statsAt: pts from the plays,
//                                  the rest final - the recorder has no in-game
//                                  box; the sum checks are run at the final)
//   /nba/v1/plays?game_id=X        the plays up to T
// Anything else is a 404, so a route the harness did not expect is loud.

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const REPLAY_GAMES = Object.freeze({ ot: '18447720', blowout: '18447706', close: '18447717' });

export function loadReplay(id) {
  return JSON.parse(readFileSync(path.join(HERE, 'fixtures', `replay-${id}.json`), 'utf8'));
}

const ms = (iso) => Date.parse(iso);

/** PURE. The first and last wallclock of a recording. */
export function replaySpan(fx) {
  return { tipAt: ms(fx.plays[0].wallclock), endAt: ms(fx.plays.at(-1).wallclock) };
}

/** PURE. Per-period points from the plays up to (and including) index i. */
function lineFrom(plays, i) {
  const endOf = new Map(); // period -> [home, away] at its newest play
  for (let k = 0; k <= i; k += 1) endOf.set(plays[k].period, [plays[k].home_score, plays[k].away_score]);
  const out = {}; let prev = [0, 0];
  const keys = ['q1', 'q2', 'q3', 'q4', 'ot1', 'ot2', 'ot3'];
  for (let p = 1; p <= 7; p += 1) {
    const e = endOf.get(p);
    out[`home_${keys[p - 1]}`] = e ? e[0] - prev[0] : null;
    out[`visitor_${keys[p - 1]}`] = e ? e[1] - prev[1] : null;
    if (e) prev = e;
  }
  return out;
}

const TEAM_FOUL = (type) => /foul/i.test(String(type ?? '')) && !/offensive|technical/i.test(String(type ?? ''));
const secsLeft = (clock) => {
  const c = String(clock ?? '');
  const m = /^(\d{1,2}):(\d{2})$/.exec(c);
  if (m) return Number(m[1]) * 60 + Number(m[2]);
  return /^\d{1,2}\.\d$/.test(c) ? Number(c) : null;
};

/**
 * PURE. Timeouts left and the bonus, per side, as of play index i - the rules
 * in this file's header. Sides are keyed by the play's team abbreviation.
 */
export function situationAt(plays, i, { home, away }) {
  const p = plays[i];
  const period = Number(p?.period ?? 0);
  const used = { [home]: 0, [away]: 0 };
  const fouls = { [home]: 0, [away]: 0 };
  const late = { [home]: 0, [away]: 0 };
  for (let k = 0; k <= i; k += 1) {
    const q = plays[k]; const ab = q.team?.abbreviation ?? null;
    if (!(ab in used)) continue;
    const per = Number(q.period);
    if (q.type === 'Full Timeout' && (period <= 4 ? per <= 4 : per === period)) used[ab] += 1;
    if (per === period && TEAM_FOUL(q.type)) {
      fouls[ab] += 1;
      const left = secsLeft(q.clock);
      if (left != null && left <= 120) late[ab] += 1;
    }
  }
  const allowed = period <= 4 ? 7 : 2;
  const limit = period <= 4 ? 5 : 4;
  const bonus = (shooter, fouler) => fouls[fouler] >= limit || late[fouler] >= 2;
  return {
    timeouts: { home: Math.max(0, allowed - used[home]), away: Math.max(0, allowed - used[away]) },
    bonus: { home: bonus(home, away), away: bonus(away, home) },
  };
}

/** PURE. The box at instant t: the recorded final, with pts from the plays up to t (header). */
export function statsAt(fx, t) {
  const plays = fx.plays;
  if (!plays.length || t >= ms(plays.at(-1).wallclock)) return fx.stats;
  const pts = new Map(); let h = 0; let a = 0;
  for (const p of plays) {
    if (ms(p.wallclock) > t) break;
    const d = (p.home_score - h) + (p.away_score - a);
    h = p.home_score; a = p.away_score;
    const m = d > 0 ? /^(.+?) makes /.exec(String(p.text ?? '')) : null;
    if (m) pts.set(m[1].trim().toLowerCase(), (pts.get(m[1].trim().toLowerCase()) ?? 0) + d);
  }
  return fx.stats.map((s) => ({
    ...s, pts: pts.get(`${s.player?.first_name ?? ''} ${s.player?.last_name ?? ''}`.trim().toLowerCase()) ?? 0,
  }));
}

/** PURE. What /nba/v1/games would have said about this game at instant t (ms). */
export function rowAt(fx, t) {
  const g = fx.game; const plays = fx.plays;
  const { tipAt } = replaySpan(fx);
  const base = {
    id: g.id, date: g.date, datetime: g.datetime, season: g.season, postseason: g.postseason,
    postponed: false, ist_stage: g.ist_stage ?? null, home_team: g.home_team, visitor_team: g.visitor_team,
  };
  if (t < tipAt) {
    const nulls = lineFrom([], -1);
    return { ...base, ...nulls, status: g.datetime, status_state: 'scheduled', period: 0, time: null,
      home_team_score: 0, visitor_team_score: 0,
      home_timeouts_remaining: null, visitor_timeouts_remaining: null, home_in_bonus: null, visitor_in_bonus: null };
  }
  let i = 0;
  while (i + 1 < plays.length && ms(plays[i + 1].wallclock) <= t) i += 1;
  const p = plays[i];
  if (p.type === 'End Game') return { ...g };
  const halftime = p.type === 'End Period' && p.period === 2;
  const sit = situationAt(plays, i, { home: g.home_team.abbreviation, away: g.visitor_team.abbreviation });
  return {
    ...base, ...lineFrom(plays, i),
    status: halftime ? 'Halftime' : `${p.period}`, status_state: 'in_progress',
    period: p.period, time: halftime ? 'Halftime' : String(p.clock),
    home_team_score: p.home_score, visitor_team_score: p.away_score,
    home_timeouts_remaining: sit.timeouts.home, visitor_timeouts_remaining: sit.timeouts.away,
    home_in_bonus: sit.bonus.home, visitor_in_bonus: sit.bonus.away,
  };
}

const json = (status, body) => ({ ok: status >= 200 && status < 300, status, json: async () => body });

/**
 * A fetch() for the recorded games at a moving instant. clock() returns the
 * replay's current time in ms; calls are counted per route.
 */
export function replayFetch(fixtures, clock) {
  const calls = {};
  const fn = async (url) => {
    const u = new URL(url);
    const route = u.pathname;
    calls[route] = (calls[route] ?? 0) + 1;
    const t = clock();
    if (route === '/nba/v1/games') {
      const dates = u.searchParams.getAll('dates[]');
      return json(200, { data: fixtures.filter((fx) => dates.includes(fx.game.date)).map((fx) => rowAt(fx, t)), meta: { per_page: 100 } });
    }
    if (route === '/nba/v1/box_scores/live') {
      return json(200, { data: fixtures.map((fx) => rowAt(fx, t)).filter((r) => r.status_state === 'in_progress') });
    }
    if (route === '/nba/v1/stats') {
      const id = u.searchParams.get('game_ids[]');
      const fx = fixtures.find((f) => String(f.game.id) === String(id));
      return json(200, { data: fx ? statsAt(fx, t) : [], meta: { per_page: 100 } });
    }
    if (route === '/nba/v1/plays') {
      const fx = fixtures.find((f) => String(f.game.id) === String(u.searchParams.get('game_id')));
      return json(200, { data: fx ? fx.plays.filter((p) => ms(p.wallclock) <= t) : [] });
    }
    return json(404, { error: 'Route not found' });
  };
  fn.calls = calls;
  return fn;
}
