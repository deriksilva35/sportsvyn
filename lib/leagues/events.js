// lib/leagues/events.js - "LATEST IN THE LEAGUE" (Leagues Phase 1, slice 1).
//
// league_events (migration 144) holds what happened in a league: a JOIN, a
// PERIOD WINNER (a day's or week's best; in a crew league, a game's week), a
// member who TOOK 1ST on the season table, and a CHOP. The strip on the league
// home reads the three newest.
//
// WRITTEN ONCE. Every writer inserts with ON CONFLICT DO NOTHING against the
// UNIQUE (league, kind, user, period_key), so the hourly tick re-deriving the
// whole season, a retried join and a re-run settle all land on rows that
// already exist. Winners and leaders are decided only over FINISHED buckets
// (time up AND every result final - the guillotine's rule), so a provisional
// score never writes a line a stat correction would have to take back.
//
// WHO WRITES:
//   join          lib/leagues/core.js createLeague (the owner, in its CTE) and
//                 lib/leagues/invite.js joinByInvite (everyone after)
//   chopped       lib/leagues/guillotine.js settleGuillotine, beside the chop
//   period_winner /api/cron/leagues-tick -> settleAllLeagueEvents (below)
//   took_first    the same tick

import { sql } from '../db.js';
import { computeStandings } from './standings.js';
import { loadLeagueResults, bucketUnit, bucketLabel } from './results.js';
import { finishedBuckets, bucketTotals } from './guillotine.js';
import { crewTable, isCrewLeague } from './crew.js';
import { easternLocalToUtc } from '../gridiron/ingest.js';

const round = (x) => Math.round(x * 100) / 100;

/** The ET date a bucket ends on (exclusive): a day's next day, a week's next Tuesday. */
export function bucketEnd(bucket, unit) {
  const [y, m, d] = String(bucket).slice(0, 10).split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d) + (unit === 'week' ? 7 : 1) * 86_400_000).toISOString().slice(0, 10);
}

/** The sole leader of a table, or null (nobody, a tie, or nobody has scored). */
function soleLeader(rows) {
  const top = rows.filter((r) => r.place === 1);
  return top.length === 1 && top[0].total > 0 ? top[0].userId : null;
}

/**
 * PURE: every event a league's results imply. league: { span, scoring, format,
 * drop_worst, games }. -> [{ kind, userId, periodKey, payload, endsOn, unit }]
 */
export function deriveEvents({ league, members, results, unit, now = new Date() }) {
  const out = [];
  const ids = new Set(members.map((m) => Number(m.userId)));
  const mine = results.filter((r) => ids.has(Number(r.userId)));

  if (isCrewLeague(league.games ?? [])) {
    // A CREW LEAGUE: each game's week has a winner; 1st is the crew table's.
    const crew = crewTable({ members, results: mine, now });
    for (const a of crew.awarded) {
      for (const [uid, v] of a.finish) {
        if (v.place === 1 && v.score > 0) {
          out.push({ kind: 'period_winner', userId: uid, periodKey: `${a.game}:${a.week}`, payload: { game: a.game, score: v.score, bucket: a.week }, endsOn: bucketEnd(a.week, 'week'), unit: 'week' });
        }
      }
    }
    let prev = null;
    crew.weeks.forEach((w, i) => {
      // The crew table as it stood after its first i+1 awarded weeks.
      const upTo = new Set(crew.weeks.slice(0, i + 1));
      const totals = members.map((m) => ({ userId: Number(m.userId), total: 0 }));
      for (const aw of crew.awarded.filter((x) => upTo.has(x.week))) {
        for (const [uid, v] of aw.finish) { const row = totals.find((x) => x.userId === uid); if (row) row.total += v.points; }
      }
      const max = Math.max(0, ...totals.map((x) => x.total));
      const top = totals.filter((x) => x.total === max && max > 0);
      const leader = top.length === 1 ? top[0].userId : null;
      if (leader != null && prev != null && leader !== prev) {
        out.push({ kind: 'took_first', userId: leader, periodKey: w, payload: { from: prev, bucket: w }, endsOn: bucketEnd(w, 'week'), unit: 'week' });
      }
      if (leader != null) prev = leader;
    });
    return out;
  }

  const finished = finishedBuckets(mine, unit, now);
  const finals = mine.filter((r) => r.final);
  const totals = bucketTotals(finals, members, league.scoring);
  const played = new Map();
  for (const r of finals) {
    if (r.score == null) continue;
    if (!played.has(r.bucket)) played.set(r.bucket, new Set());
    played.get(r.bucket).add(Number(r.userId));
  }
  for (const b of finished) {
    const who = [...(played.get(b) ?? [])];
    if (!who.length) continue;
    const vals = who.map((u) => ({ u, v: totals.get(u)?.[b] ?? 0 }));
    const max = Math.max(...vals.map((x) => x.v));
    if (!(max > 0)) continue;
    for (const x of vals.filter((y) => y.v === max)) {
      out.push({ kind: 'period_winner', userId: x.u, periodKey: b, payload: { score: round(max), bucket: b }, endsOn: bucketEnd(b, unit), unit });
    }
  }

  // TOOK 1ST: a season table only (a daily or weekly league's winner IS its 1st).
  if (league.span === 'season' && league.format !== 'guillotine') {
    let prev = null;
    finished.forEach((b, i) => {
      const order = finished.slice(0, i + 1);
      const st = computeStandings({
        members, results: finals.filter((r) => order.includes(r.bucket)),
        scoring: league.scoring, dropWorst: !!league.drop_worst, bucketOrder: order,
      });
      const leader = soleLeader(st.rows);
      if (leader != null && prev != null && leader !== prev) {
        out.push({ kind: 'took_first', userId: leader, periodKey: b, payload: { from: prev, bucket: b }, endsOn: bucketEnd(b, unit), unit });
      }
      if (leader != null) prev = leader;
    });
  }
  return out;
}

/** Insert events; the UNIQUE key makes a repeat a no-op. -> rows inserted. */
export async function insertEvents(leagueId, events) {
  let n = 0;
  const atCache = new Map();
  for (const e of events) {
    let at = null;
    if (e.endsOn) {
      if (!atCache.has(e.endsOn)) atCache.set(e.endsOn, await easternLocalToUtc(`${e.endsOn} 00:00:00`));
      at = atCache.get(e.endsOn);
    }
    const rows = await sql`
      INSERT INTO league_events (league_id, kind, user_id, period_key, payload, at)
      VALUES (${leagueId}, ${e.kind}, ${e.userId}, ${e.periodKey ?? ''}, ${JSON.stringify(e.payload ?? {})}::jsonb,
              COALESCE(${at}::timestamptz, now()))
      ON CONFLICT DO NOTHING RETURNING id`;
    n += rows.length;
  }
  return n;
}

/** A join line - the join paths call this; a repeat is a no-op. */
export async function writeJoinEvent(leagueId, userId) {
  await sql`
    INSERT INTO league_events (league_id, kind, user_id, period_key, at)
    SELECT ${leagueId}, 'join', ${userId}, '', m.joined_at FROM league_members m
     WHERE m.league_id = ${leagueId} AND m.user_id = ${userId}
    ON CONFLICT DO NOTHING`;
}

/** Re-derive one league's winners and leaders and write the new ones. */
export async function writeLeagueEvents(league, { now = new Date() } = {}) {
  const gameRows = await sql`SELECT game_type, sport FROM player_league_games WHERE league_id = ${league.id}`;
  const games = [...new Set(gameRows.map((g) => g.game_type))];
  const memberRows = await sql`SELECT user_id FROM league_members WHERE league_id = ${league.id}`;
  const members = memberRows.map((r) => ({ userId: Number(r.user_id) }));
  const lg = { ...league, games, gameRows };
  const unit = bucketUnit(lg);
  const { results } = await loadLeagueResults(lg, members.map((m) => m.userId), { now });
  return insertEvents(league.id, deriveEvents({ league: lg, members, results, unit, now }));
}

/** Every started league. -> [{ leagueId, written } | { leagueId, error }] */
export async function settleAllLeagueEvents({ now = new Date() } = {}) {
  const leagues = await sql`
    SELECT id, span, scoring, format, drop_worst, starts_at, pick_format, pick_format_prev, pick_format_from
      FROM player_leagues WHERE starts_at IS NOT NULL AND starts_at <= ${new Date(now).toISOString()}`;
  const out = [];
  for (const lg of leagues) {
    try { out.push({ leagueId: lg.id, written: await writeLeagueEvents(lg, { now }) }); } catch (e) {
      out.push({ leagueId: lg.id, error: String(e?.message ?? e) });
    }
  }
  return out;
}

/**
 * The strip: the newest `limit` events with handles and period labels.
 * -> [{ kind, userId, handle, payload, at, periodLabel }]
 */
export async function latestEvents(leagueId, { limit = 3, unit = 'day' } = {}) {
  const rows = await sql`
    SELECT e.kind, e.user_id, u.handle, e.payload, e.at, e.period_key, l.owner_id
      FROM league_events e JOIN users u ON u.id = e.user_id JOIN player_leagues l ON l.id = e.league_id
     WHERE e.league_id = ${leagueId}
     ORDER BY e.at DESC, e.id DESC LIMIT ${limit}`;
  return rows.map((r) => {
    const b = r.payload?.bucket ?? (r.period_key || null);
    const evUnit = r.payload?.game ? 'week' : unit;
    return {
      kind: r.kind, userId: Number(r.user_id), handle: r.handle, at: r.at,
      payload: { ...(r.payload ?? {}), ...(r.kind === 'join' && Number(r.owner_id) === Number(r.user_id) ? { owner: true } : {}) },
      periodLabel: b ? bucketLabel(b, evUnit) : null,
    };
  });
}
