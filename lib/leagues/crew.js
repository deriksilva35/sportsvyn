// lib/leagues/crew.js - CREW POINTS: one table across several games. PURE.
// (Leagues Phase 1, slice 2, thu-4.)
//
// THE PROBLEM IT SOLVES. A league that plays The Daily and Pick'em cannot add
// their scores: a Daily day is thousands, a Pick'em week is a dozen. So in a
// league of several games each GAME'S WEEK is a little contest of its own, and
// its finish is what counts:
//
//     1st 10 · 2nd 8 · 3rd 6 · 4th 5 · 5th 4 · 6th 3 · 7th on 0
//
// TIES SHARE THE HIGHER place (standard competition ranking, the house rule -
// lib/games/rank.js): two members tied for 1st both take 10, and the next one
// is 3rd and takes 6. A member with no entry in a game's week is not ranked in
// it and takes 0.
//
// A GAME is a game type (all of a Pick'em league's sports are one Pick'em);
// its WEEK is the Tuesday-to-Monday ET week every weekly surface uses
// (lib/leagues/results.js tuesdayOf), so a Daily week is its seven days added
// up. A game's week AWARDS once its time is up and every result in it is final
// (the guillotine's rule, lib/leagues/guillotine.js) - until then it is
// provisional, which is what "this week" shows.

import { competitionRanks } from './standings.js';
import { tuesdayOf, bucketOver } from './weeks.js';

export const CREW_POINTS = Object.freeze([10, 8, 6, 5, 4, 3]);

/** Crew points for a finish (1-based). Past 6th, 0. */
export const crewPointsFor = (place) => (Number.isInteger(place) && place >= 1 ? CREW_POINTS[place - 1] ?? 0 : 0);

/** A league plays crew points when it covers more than one game. */
export const isCrewLeague = (games = []) => new Set(games).size > 1;

export const CREW_EXPLAINER = "Crew points: every game's week awards 10, 8, 6, 5, 4, 3 by finish, so a Daily score and a Pick'em score count the same. Ties share the higher place. Tap a game for its own table.";

const round = (x) => Math.round(x * 100) / 100;

/**
 * results (lib/leagues/results.js shape) -> Map<`${game}|${week}`, { game, week,
 * final, byUser: Map<userId, score> }>. Scores of one game in one week add up.
 */
export function gameWeeks(results, { now = new Date() } = {}) {
  const out = new Map();
  for (const r of results) {
    if (r.score == null || !Number.isFinite(Number(r.score))) continue;
    const week = tuesdayOf(r.bucket);
    const k = `${r.game}|${week}`;
    if (!out.has(k)) out.set(k, { game: r.game, week, allFinal: true, byUser: new Map() });
    const gw = out.get(k);
    gw.allFinal = gw.allFinal && !!r.final;
    gw.byUser.set(Number(r.userId), round((gw.byUser.get(Number(r.userId)) ?? 0) + Number(r.score)));
  }
  for (const gw of out.values()) gw.final = gw.allFinal && bucketOver(gw.week, 'week', now);
  return out;
}

/** One game-week's finish: Map<userId, { place, points, score }>. */
export function awardWeek(byUser) {
  const places = competitionRanks([...byUser].map(([key, value]) => ({ key, value })));
  const out = new Map();
  for (const [uid, score] of byUser) {
    const place = places.get(uid);
    out.set(uid, { place, points: crewPointsFor(place), score });
  }
  return out;
}

/**
 * THE CREW TABLE over FINAL game-weeks. members: [{ userId, handle }].
 * -> { rows: [{ userId, handle, place, total, wins: {game: n}, weeks, move }],
 *      weeks: [week], awarded: [{game, week, finish}] }
 * `move` is the place change since the last awarded week (null with one week).
 */
export function crewTable({ members, results, now = new Date() }) {
  const ids = new Set(members.map((m) => Number(m.userId)));
  const gws = [...gameWeeks(results.filter((r) => ids.has(Number(r.userId))), { now }).values()]
    .filter((g) => g.final)
    .sort((a, b) => (a.week < b.week ? -1 : a.week > b.week ? 1 : a.game < b.game ? -1 : 1));
  const weeks = [...new Set(gws.map((g) => g.week))];
  const per = new Map(members.map((m) => [Number(m.userId), { byWeek: new Map(), wins: {}, played: 0 }]));
  const awarded = [];
  for (const gw of gws) {
    const finish = awardWeek(gw.byUser);
    awarded.push({ game: gw.game, week: gw.week, finish });
    for (const [uid, v] of finish) {
      const p = per.get(uid);
      if (!p) continue;
      p.byWeek.set(gw.week, (p.byWeek.get(gw.week) ?? 0) + v.points);
      p.played += 1;
      if (v.place === 1) p.wins[gw.game] = (p.wins[gw.game] ?? 0) + 1;
    }
  }
  const totalUpTo = (p, n) => weeks.slice(0, n).reduce((s, w) => s + (p.byWeek.get(w) ?? 0), 0);
  const rows = members.map((m) => {
    const p = per.get(Number(m.userId));
    return { userId: Number(m.userId), handle: m.handle ?? null, total: totalUpTo(p, weeks.length), wins: p.wins, played: p.played };
  });
  const places = competitionRanks(rows.map((r) => ({ key: r.userId, value: r.total })));
  const before = weeks.length >= 2
    ? competitionRanks(rows.map((r) => ({ key: r.userId, value: totalUpTo(per.get(r.userId), weeks.length - 1) })))
    : null;
  for (const r of rows) {
    r.place = places.get(r.userId);
    r.move = before ? before.get(r.userId) - r.place : null;
    r.winCount = Object.values(r.wins).reduce((a, b) => a + b, 0);
  }
  // A TIE IS LISTED by game-week wins, then the handle - stable and explainable.
  rows.sort((a, b) => a.place - b.place || b.winCount - a.winCount
    || String(a.handle ?? '').localeCompare(String(b.handle ?? '')));
  return { rows, weeks, awarded };
}

/**
 * THIS WEEK, PROVISIONAL: the crew points each member would take if every game's
 * current week ended now, and each game's leader. `week` defaults to the latest
 * week any result sits in.
 * -> { week, points: Map<userId, n>, leaders: [{ game, userIds, score }] }
 */
export function crewThisWeek({ members, results, week = null, now = new Date() }) {
  const ids = new Set(members.map((m) => Number(m.userId)));
  const all = [...gameWeeks(results.filter((r) => ids.has(Number(r.userId))), { now }).values()];
  const wk = week ?? all.map((g) => g.week).sort().at(-1) ?? null;
  const points = new Map(members.map((m) => [Number(m.userId), 0]));
  const leaders = [];
  for (const gw of all.filter((g) => g.week === wk).sort((a, b) => (a.game < b.game ? -1 : 1))) {
    const finish = awardWeek(gw.byUser);
    for (const [uid, v] of finish) points.set(uid, (points.get(uid) ?? 0) + v.points);
    const top = [...finish].filter(([, v]) => v.place === 1);
    if (top.length) leaders.push({ game: gw.game, userIds: top.map(([u]) => u), score: top[0][1].score });
  }
  return { week: wk, points, leaders };
}

/** "Won Daily 3 wks · Pick'em 1 wk" - a row's sub-line; '' with no wins. */
export function winsLine(wins = {}, label = (g) => g) {
  return Object.entries(wins)
    .sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))
    .map(([g, n], i) => `${i === 0 ? 'Won ' : ''}${label(g)} ${n} ${n === 1 ? 'wk' : 'wks'}`)
    .join(' · ');
}
