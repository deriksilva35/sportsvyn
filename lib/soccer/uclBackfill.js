// lib/soccer/uclBackfill.js - the Champions League's matchday-1 goals, cards
// and team stats (ruling fri-4). MD1 (8-10 Sep) was played before the live
// tick polled the UCL, so the import gave those 18 finals their scores and
// nothing else: no timeline on the card, no moments or stats on the match page.
//
// ONE REQUEST: /fixtures?ids= for the finals that have no current events yet
// (at most MAX_IDS - MD1 is 18), each with its events and statistics embedded,
// written through the SAME atoms the live tick calls at full time
// (lib/events.js syncMatchEvents, lib/statistics.js syncMatchStatistics).
// Idempotent: a second run finds nothing to fetch. Dry run by default.
// The atoms write through lib/db.js, so the caller's DATABASE_URL is the
// database written (scripts/ucl-backfill-events.mjs guards that for PROD).

import { syncMatchEvents } from '../events.js';
import { syncMatchStatistics } from '../statistics.js';
import { MAX_IDS } from './eplLive.js';

/** Finals of `week` in `league` with an api_sports id and no current events. */
export async function backfillCandidates(sql, { league = 'ucl', week = 1 } = {}) {
  return sql`
    SELECT m.id, m.slug, m.external_ids->>'api_sports' AS fixture
      FROM matches m JOIN leagues l ON l.id = m.league_id
     WHERE l.slug = ${league} AND m.week = ${week} AND m.status = 'final'
       AND m.external_ids->>'api_sports' IS NOT NULL
       AND NOT EXISTS (SELECT 1 FROM match_events e WHERE e.match_id = m.id AND e.is_current)
     ORDER BY m.kickoff_at, m.id
     LIMIT ${MAX_IDS}`;
}

/**
 * The backfill. `client` is fixturesByIds-shaped; `atoms` injectable.
 * Returns { candidates, requests, written: [{slug, events, stats}], missing }.
 */
export async function backfillUclEvents({
  sql, client, apply = false, league = 'ucl', week = 1,
  atoms = { events: syncMatchEvents, statistics: syncMatchStatistics },
} = {}) {
  const rows = await backfillCandidates(sql, { league, week });
  const out = { candidates: rows.map((r) => r.slug), requests: 0, written: [], missing: [] };
  if (!apply || !rows.length) return out;
  const resp = await client.fixturesByIds(rows.map((r) => r.fixture));
  out.requests = 1;
  const byFx = new Map((resp ?? []).map((f) => [String(f.fixture?.id), f]));
  for (const row of rows) {
    const f = byFx.get(String(row.fixture));
    if (!f) { out.missing.push(row.slug); continue; }
    const ctx = { homeTeamApiId: f.teams?.home?.id, awayTeamApiId: f.teams?.away?.id, fixtureApiId: Number(row.fixture) };
    const ev = f.events ?? [];
    if (ev.length) await atoms.events(row.id, ev, ctx);
    const st = Array.isArray(f.statistics) && f.statistics.length >= 2 ? f.statistics : null;
    if (st) await atoms.statistics(row.id, st, ctx);
    out.written.push({ slug: row.slug, events: ev.length, stats: Boolean(st) });
  }
  return out;
}
