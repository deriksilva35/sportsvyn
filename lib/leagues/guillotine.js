// lib/leagues/guillotine.js - the chop, persisted. (Leagues V1 P3.)
//
// THE ONE STORED DECISION. Standings are derived on every read; a chop is not,
// because a stat correction after Monday night must never bring a chopped
// member back or chop a different one. player_league_eliminations (migration
// 122) holds one row per chopped member; the rule is lib/leagues/standings.js
// chop() (ruling c: a tie on the bucket goes to the higher season total, a tie
// on both and nobody goes).
//
// A BUCKET IS DECIDED ONLY WHEN IT IS FINISHED: its time is up (a week runs to
// Tuesday 00:00 ET, a day to the next midnight) AND every result in it is final
// (a settled contest, a closed Daily board). Pick'em NFL settles on the
// following Sunday's cron, so a week with Pick'em is decided then - late, never
// wrong. Run by /api/cron/leagues-tick; idempotent (PRIMARY KEY + DO NOTHING).

import { sql } from '../db.js';
import { chop, unitPoints } from './standings.js';
import { loadLeagueResults, tuesdayOf, bucketUnit } from './results.js';
import { etDateOf } from './start.js';

/** Has a bucket's time run out? week: its Tuesday + 7 days; day: the next day (ET dates). */
export function bucketOver(bucket, unit, now = new Date()) {
  const today = etDateOf(now);
  const [y, m, d] = bucket.split('-').map(Number);
  const end = new Date(Date.UTC(y, m - 1, d) + (unit === 'week' ? 7 : 1) * 86_400_000).toISOString().slice(0, 10);
  return today >= end;
}

/**
 * A member who joined after the start is on the block from the bucket AFTER the
 * one they joined in - they could not have played the whole of that one.
 */
export function lateFrom(joinedAt, startsAt, unit) {
  if (!joinedAt || !startsAt || new Date(joinedAt) <= new Date(startsAt)) return null;
  const day = etDateOf(new Date(joinedAt));
  const b = unit === 'week' ? tuesdayOf(day) : day;
  const [y, m, d] = b.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d) + (unit === 'week' ? 7 : 1) * 86_400_000).toISOString().slice(0, 10);
}

/** Pure: shaped results -> [bucket] finished, oldest first. */
export function finishedBuckets(results, unit, now = new Date()) {
  const all = [...new Set(results.map((r) => r.bucket))].sort();
  return all.filter((b) => bucketOver(b, unit, now) && results.filter((r) => r.bucket === b).every((r) => r.final));
}

/** Pure: per member, per bucket totals (missed = 0) under the league's scoring. */
export function bucketTotals(results, members, scoring) {
  const ids = new Set(members.map((m) => Number(m.userId)));
  const units = unitPoints(results.filter((r) => ids.has(r.userId)), { scoring, memberCount: members.length });
  const by = new Map(members.map((m) => [Number(m.userId), {}]));
  for (const u of units.values()) {
    for (const [uid, v] of u.byUser) {
      const row = by.get(uid);
      if (row) row[u.bucket] = (row[u.bucket] ?? 0) + v.points;
    }
  }
  return by;
}

export async function eliminations(leagueId) {
  return sql`SELECT user_id, period_key, period_total, season_total, decided_at
               FROM player_league_eliminations WHERE league_id = ${leagueId} ORDER BY decided_at, period_key`;
}

/** Decide every finished, undecided bucket of one guillotine league. -> new chops. */
export async function settleGuillotine(league, { now = new Date() } = {}) {
  if (league.format !== 'guillotine') return [];
  const memberRows = await sql`SELECT user_id, joined_at FROM league_members WHERE league_id = ${league.id}`;
  const gameRows = await sql`SELECT game_type, sport FROM player_league_games WHERE league_id = ${league.id}`;
  const games = [...new Set(gameRows.map((g) => g.game_type))];
  const unit = bucketUnit({ span: league.span, games });
  const members = memberRows.map((r) => ({ userId: Number(r.user_id), from: lateFrom(r.joined_at, league.starts_at, unit) }));
  const { results } = await loadLeagueResults({ ...league, games, gameRows }, members.map((m) => m.userId), { now });
  const done = (await eliminations(league.id)).map((e) => ({ userId: Number(e.user_id), bucket: e.period_key }));
  const fresh = chop({
    members, finishedBuckets: finishedBuckets(results, unit, now),
    byBucket: bucketTotals(results, members, league.scoring), decided: done,
  });
  for (const c of fresh) {
    await sql`
      INSERT INTO player_league_eliminations (league_id, user_id, period_key, period_total, season_total)
      VALUES (${league.id}, ${c.userId}, ${c.bucket}, ${c.periodTotal}, ${c.seasonTotal})
      ON CONFLICT DO NOTHING`;
  }
  return fresh;
}

/** Every guillotine league that has started. */
export async function settleAllGuillotines({ now = new Date() } = {}) {
  const leagues = await sql`
    SELECT id, span, scoring, format, starts_at FROM player_leagues
     WHERE format = 'guillotine' AND starts_at IS NOT NULL AND starts_at <= ${new Date(now).toISOString()}`;
  const out = [];
  for (const lg of leagues) {
    try { out.push({ leagueId: lg.id, chopped: (await settleGuillotine(lg, { now })).length }); } catch (e) {
      out.push({ leagueId: lg.id, error: String(e?.message ?? e) });
    }
  }
  return out;
}
