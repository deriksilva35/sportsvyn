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
// Timeouts and bonus are not in the plays and are emitted as null.
//
// THE STUB SERVES THE ROUTES THE POLLER AND THE STATS SYNC ASK FOR:
//   /nba/v1/games?dates[]=..       the game row at T for each game filed on a date asked
//   /nba/v1/box_scores/live        the in-progress rows at T
//   /nba/v1/stats?game_ids[]=X     the recorded box (final totals at any T - the
//                                  recorder has no in-game box; the sum checks
//                                  are run at the final)
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
  return {
    ...base, ...lineFrom(plays, i),
    status: halftime ? 'Halftime' : `${p.period}`, status_state: 'in_progress',
    period: p.period, time: halftime ? 'Halftime' : String(p.clock),
    home_team_score: p.home_score, visitor_team_score: p.away_score,
    home_timeouts_remaining: null, visitor_timeouts_remaining: null, home_in_bonus: null, visitor_in_bonus: null,
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
      return json(200, { data: fx ? fx.stats : [], meta: { per_page: 100 } });
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
