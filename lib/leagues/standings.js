// lib/leagues/standings.js - a league's table, DERIVED, never stored. PURE.
//
// Results come in as rows (lib/leagues/results.js loads them from the games'
// own settled tables): one per member per UNIT - a unit is one game, one sport,
// one of that game's periods ("pickem:nfl:2026-w5", "daily:all:2026-10-03").
// Nothing is re-scored here; each game's own score is the input.
//
// THE RULINGS (thu-14):
//   (a) no entry in a unit = 0 points - a member who did not play is not ranked
//       last, they are simply not ranked;
//   (b) ties share the HIGHER place's points (standard competition ranking:
//       1, 2, 2, 4 - RANK(), not DENSE_RANK()) - now every board's rule
//       (lib/games/rank.js, sun-16 C), and the table lists a tie earliest
//       submission first: the member whose total reached its value first;
//   (c) guillotine: the lowest bucket total is chopped; a tie on it goes to the
//       higher season total (the lower one is chopped); a tie on BOTH means
//       every one of the tied survives that bucket - see chop();
//   (d) is migration 122's (pre-V1 leagues are Daily-only, total points).
//
// RANK POINTS: in each unit, 1st scores N (the member count), 2nd N-1, and so
// on - the league board's footnote ("1st in a game's week = 9 here, 9
// members"). Total points: the game's own score.
//
// A BUCKET is the stretch a winner is named for - a week (Tuesday to Monday
// ET, the NFL week as every weekly surface reads it) or a day. Drop-worst
// drops a member's lowest bucket (a bucket they missed counts as 0, so a
// missed week is the one dropped), once two buckets exist.

import { rankPoints } from './settings.js';
import { competitionRank, latestSubmitted } from '../games/rank.js';

/** Competition ranks for [{key, value}] by value desc: ties share the higher place. */
export function competitionRanks(rows) {
  const sorted = [...rows].sort((a, b) => b.value - a.value);
  const out = new Map();
  let prev = null; let place = 0;
  sorted.forEach((r, i) => {
    if (prev === null || r.value !== prev) { place = i + 1; prev = r.value; }
    out.set(r.key, place);
  });
  return out;
}

const unitKey = (r) => `${r.game}:${r.sport}:${r.period}`;
const ordinal = (n) => {
  const s = ['th', 'st', 'nd', 'rd']; const v = n % 100;
  return `${n}${s[(v - 20) % 10] || s[v] || s[0]}`;
};
export { ordinal };

/**
 * Points per (user, unit). results: [{ userId, game, sport, period, bucket, score }].
 * -> Map<unitKey, { game, sport, period, bucket, byUser: Map<userId, {score, place, points}> }>
 */
export function unitPoints(results, { scoring, memberCount }) {
  const units = new Map();
  for (const r of results) {
    if (r.score == null || !Number.isFinite(Number(r.score))) continue;
    const k = unitKey(r);
    if (!units.has(k)) units.set(k, { game: r.game, sport: r.sport, period: r.period, bucket: r.bucket, byUser: new Map() });
    units.get(k).byUser.set(Number(r.userId), { score: Number(r.score), submittedAt: r.submittedAt ?? null });
  }
  for (const u of units.values()) {
    const places = competitionRanks([...u.byUser].map(([key, v]) => ({ key, value: v.score })));
    for (const [uid, v] of u.byUser) {
      v.place = places.get(uid);
      v.points = scoring === 'rank' ? rankPoints(v.place, memberCount) : v.score;
    }
  }
  return units;
}

const round = (x) => Math.round(x * 100) / 100;

/**
 * The table. members: [{ userId, handle }]. Buckets are ordered as given in
 * `bucketOrder` (oldest first); results whose bucket is not in it are ignored.
 * -> { rows: [{ userId, handle, place, total, current, dropped, move, games, record }],
 *      buckets, current }
 */
export function computeStandings({ members, results, scoring, dropWorst = false, bucketOrder = null }) {
  const n = members.length;
  const ids = new Set(members.map((m) => Number(m.userId)));
  const units = unitPoints(results.filter((r) => ids.has(Number(r.userId))), { scoring, memberCount: n });
  const buckets = bucketOrder ?? [...new Set([...units.values()].map((u) => u.bucket))].sort();
  const bset = new Set(buckets);
  const current = buckets[buckets.length - 1] ?? null;

  const per = new Map(members.map((m) => [Number(m.userId), { byBucket: new Map(buckets.map((b) => [b, 0])), games: [], at: [] }]));
  for (const u of units.values()) {
    if (!bset.has(u.bucket)) continue;
    for (const [uid, v] of u.byUser) {
      const p = per.get(uid);
      if (!p) continue;   // not a member (any more): never on the table
      p.byBucket.set(u.bucket, p.byBucket.get(u.bucket) + v.points);
      p.at.push(v.submittedAt);
      if (u.bucket === current) p.games.push({ game: u.game, sport: u.sport, place: v.place, score: v.score, points: v.points });
    }
  }

  // THE PICK'EM RECORD (S2): W-L over the same window, printed second to the
  // points. null for a member with no settled Pick'em in it.
  for (const r of results) {
    if (!r.record || !bset.has(r.bucket)) continue;
    const p = per.get(Number(r.userId));
    if (!p) continue;
    p.rec = { w: (p.rec?.w ?? 0) + r.record.w, l: (p.rec?.l ?? 0) + r.record.l };
    // PUSHES ride along for an ATS week (r.record.p); a regular week has none.
    if (r.record.p != null || p.rec.p != null) p.rec.p = (p.rec.p ?? 0) + (r.record.p ?? 0);
  }

  const totalOf = (p, upTo = buckets.length) => {
    const vals = buckets.slice(0, upTo).map((b) => p.byBucket.get(b));
    let sum = vals.reduce((a, b) => a + b, 0);
    let dropped = null;
    if (dropWorst && vals.length >= 2) {
      const i = vals.indexOf(Math.min(...vals));
      dropped = buckets[i]; sum -= vals[i];
    }
    return { total: round(sum), dropped };
  };

  const rows = members.map((m) => {
    const p = per.get(Number(m.userId));
    const { total, dropped } = totalOf(p);
    return {
      userId: Number(m.userId), handle: m.handle ?? null, total, dropped,
      current: current == null ? 0 : round(p.byBucket.get(current)),
      byBucket: Object.fromEntries([...p.byBucket].map(([b, v]) => [b, round(v)])),
      games: p.games,
      record: p.rec ?? null,
      submittedAt: latestSubmitted(p.at),
    };
  });
  const places = competitionRanks(rows.map((r) => ({ key: r.userId, value: r.total })));
  // MOVEMENT: the place before the current bucket counted (null with one bucket).
  const before = buckets.length >= 2
    ? competitionRanks(rows.map((r) => ({ key: r.userId, value: totalOf(per.get(r.userId), buckets.length - 1).total })))
    : null;
  for (const r of rows) {
    r.place = places.get(r.userId);
    r.move = before ? before.get(r.userId) - r.place : null;   // + = climbed
  }
  // A TIE ON THE TABLE is listed earliest submission first - the member whose
  // total got there first (lib/games/rank.js); it was the handle's alphabet.
  const order = new Map(competitionRank(rows, (r) => r.total, (r) => r.submittedAt).map((r, i) => [r.userId, i]));
  rows.sort((a, b) => order.get(a.userId) - order.get(b.userId));
  return { rows, buckets, current };
}

/**
 * THE GUILLOTINE (P3), one bucket at a time over FINISHED buckets, oldest first.
 * members: [{ userId, from? }] - `from` is a late joiner's first bucket.
 * decided: [{ userId, bucket }] already persisted - those members stay out and
 * those buckets are never re-decided (a stat correction cannot flip a chop).
 * byBucket: Map<userId, {bucket: total}> (every member, missed = 0).
 * -> [{ userId, bucket, periodTotal, seasonTotal }] - the NEW chops only.
 */
/**
 * A TIE AT THE CUT - FLAGGED, NOT DECIDED HERE (sun-16 C). Tied on the bucket
 * AND the season total, ruling (c) chops nobody ('survive', the standing rule
 * and the recommendation). 'all' would chop every one of them. The earliest-
 * submission rule never reaches this: it orders a tie on a board, it does
 * not break one at the guillotine. Changing this is Derik's call.
 */
export const GUILLOTINE_TIE_AT_CUT = 'survive';

export function chop({ members, finishedBuckets, byBucket, decided = [], tieAtCut = GUILLOTINE_TIE_AT_CUT }) {
  const out = [];
  const gone = new Set(decided.map((d) => Number(d.userId)));
  const done = new Set(decided.map((d) => d.bucket));
  const season = new Map(members.map((m) => [Number(m.userId), 0]));
  const from = new Map(members.map((m) => [Number(m.userId), m.from ?? null]));
  for (const b of finishedBuckets) {
    for (const [uid] of season) season.set(uid, season.get(uid) + (byBucket.get(uid)?.[b] ?? 0));
    if (done.has(b)) continue;
    // A LATE JOINER is on the block only from their first whole bucket (`from`).
    const alive = [...season.keys()].filter((u) => !gone.has(u) && !(from.get(u) && b < from.get(u)));
    if (alive.length <= 1) break;   // a winner: nothing left to chop
    const low = Math.min(...alive.map((u) => byBucket.get(u)?.[b] ?? 0));
    const onBlock = alive.filter((u) => (byBucket.get(u)?.[b] ?? 0) === low);
    let victims = onBlock;
    if (onBlock.length > 1) {
      const lowSeason = Math.min(...onBlock.map((u) => season.get(u)));
      victims = onBlock.filter((u) => season.get(u) === lowSeason);
    }
    // Ruling (c): tied on the bucket AND the season - all of them survive
    // (GUILLOTINE_TIE_AT_CUT; 'all' chops every one, unused).
    if (victims.length !== 1 && tieAtCut !== 'all') continue;
    if (victims.length >= alive.length) continue;   // never chop the whole league
    for (const v of victims) {
      gone.add(v);
      out.push({ userId: v, bucket: b, periodTotal: round(byBucket.get(v)?.[b] ?? 0), seasonTotal: round(season.get(v)) });
    }
  }
  return out;
}
