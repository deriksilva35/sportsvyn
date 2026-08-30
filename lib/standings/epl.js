// lib/standings/epl.js — API-Sports /standings -> league_tables.
//
// *** THIS FILE IS BUILT AND DELIBERATELY UNWIRED. Ruled 30 Aug: option (i)
// today, option (ii) queued for after football week. ***
//
// EPL standings ALREADY WORK, by a different design that predates this store:
// lib/soccer/standings.js writes the table as a jsonb DOCUMENT onto
// leagues.metadata.standings, refreshed daily by /api/cron/epl-standings
// (26 13 * * *), and TWO live surfaces read it — app/page.js and
// app/epl/standings/page.js, the latter via railFor() for the UCL and
// relegation rails. That file argues its own case: one row per league, read
// whole and written whole, is the shape a jsonb column is for.
//
// So there is no EPL cron for this module, no consumer points at it, and
// league_tables stays empty until the migration below is run. Nothing here is
// dead code by accident — it is the finished half of a move that has been
// scheduled rather than taken.
//
// THE MIGRATION PATH, when (ii) is called:
//   1. add an hourly cron calling syncEplTable (the daily document cadence is
//      the weaker half of the current design — measured provider lag is 1-3
//      hours, so hourly catches a result the same afternoon)
//   2. repoint app/epl/standings/page.js at getLeagueTable(), mapping
//      qualification_description through the existing railFor()
//   3. repoint app/page.js:374
//   4. delete syncEplStandings / getEplStandings and the epl-standings cron
// What it buys: per-team rows joinable to teams, hourly instead of daily, and
// one storage shape for every league's standings. What it costs: migrating two
// live pages, which is why it waits for a quiet week.
//
// THE `update` FIELD IS NOT A FRESHNESS SIGNAL AND IS DELIBERATELY DISCARDED.
// Measured 30 Aug 2026: the payload stamped "2026-08-30T00:00:00+00:00" —
// midnight — while already carrying results from matches that finished at
// 15:00Z the same day (Chelsea 2-0-0, 6 pts, form WW). It is date-granularity
// at best and would be actively wrong as a cache key or a conditional-fetch
// guard. We refetch on cadence, upsert, and let the diff be the change signal.
//
// The same probe measured the real lag: matches ending ~15:00Z were in the
// table by 18:12Z; a match ending ~17:20Z was not yet. So roughly one to three
// hours behind a final, which an hourly job catches inside the hour.

import { sql } from '../db.js';

const HOST = 'https://v3.football.api-sports.io';

/** One API-Sports standing -> our row. PURE. */
export function toTableRow(s, { teamId, leagueId, season, unmapped } = {}) {
  const all = s.all ?? {};
  const goals = all.goals ?? {};
  const known = new Set(['rank', 'team', 'points', 'goalsDiff', 'group', 'form',
    'status', 'description', 'all', 'home', 'away', 'update']);
  for (const k of Object.keys(s)) if (!known.has(k)) unmapped?.push(k);
  return {
    league_id: leagueId, team_id: teamId, season,
    rank: s.rank,
    played: all.played ?? 0,
    win: all.win ?? 0,
    draw: all.draw ?? 0,
    lose: all.lose ?? 0,
    goals_for: goals.for ?? 0,
    goals_against: goals.against ?? 0,
    // STORED, NOT DERIVED. The provider computes goalsDiff itself and a league
    // that awards or deducts goals administratively would make for-minus-
    // against disagree with the published table. Their number is the one the
    // table is sorted by.
    goal_diff: s.goalsDiff ?? ((goals.for ?? 0) - (goals.against ?? 0)),
    points: s.points ?? 0,
    form: s.form ?? null,
    movement_status: s.status ?? null,
    qualification_description: s.description ?? null,
    group_name: s.group ?? null,
    data_provider: 'apisports',
  };
}

async function teamMap(leagueId) {
  const rows = await sql`
    SELECT id, external_ids->>'api_sports' AS pid FROM teams
     WHERE league_id = ${leagueId} AND external_ids ? 'api_sports'`;
  return new Map(rows.map((r) => [r.pid, r.id]));
}

export function apiSportsStandingsFetcher({ host = HOST } = {}) {
  return async (providerLeagueId, season) => {
    const key = process.env.API_SPORTS_KEY;
    if (!key) throw new Error('API_SPORTS_KEY missing in env');
    const res = await fetch(`${host}/standings?league=${providerLeagueId}&season=${season}`, {
      headers: { 'x-apisports-key': key },
    });
    if (!res.ok) throw new Error(`API-Sports ${res.status} on /standings`);
    const j = await res.json();
    if (j.errors && Object.keys(j.errors).length) {
      throw new Error(`API-Sports errors: ${JSON.stringify(j.errors).slice(0, 160)}`);
    }
    // standings is an array of GROUPS; a single-table league has exactly one.
    return j.response?.[0]?.league?.standings ?? [];
  };
}

export async function syncEplTable(leagueId, season, { fetchStandings, dryRun = false } = {}) {
  const summary = {
    provider: 'apisports', season, requests: 1,
    groups: 0, rows: 0, matched: 0, noTeam: 0, written: 0, unmapped: [], dryRun,
  };
  const [lg] = await sql`SELECT external_ids->>'api_sports' AS pid FROM leagues WHERE id = ${leagueId}`;
  if (!lg?.pid) { summary.reason = 'league-has-no-api_sports-id'; return summary; }

  const groups = await (fetchStandings ?? apiSportsStandingsFetcher())(lg.pid, season);
  summary.groups = groups.length;
  const tmap = await teamMap(leagueId);

  const batch = [];
  for (const g of groups) {
    for (const s of g ?? []) {
      summary.rows += 1;
      const teamId = tmap.get(String(s.team?.id));
      if (teamId == null) { summary.noTeam += 1; continue; }
      summary.matched += 1;
      batch.push(toTableRow(s, { teamId, leagueId, season, unmapped: summary.unmapped }));
    }
  }
  summary.unmapped = [...new Set(summary.unmapped)];
  if (!dryRun) summary.written = await upsertTable(batch);
  return summary;
}

export async function upsertTable(rows) {
  let n = 0;
  for (const r of rows) {
    await sql`
      INSERT INTO league_tables (
        league_id, team_id, season, rank, played, win, draw, lose,
        goals_for, goals_against, goal_diff, points,
        form, movement_status, qualification_description, group_name,
        data_provider, data_provider_synced_at)
      VALUES (
        ${r.league_id}, ${r.team_id}, ${r.season}, ${r.rank}, ${r.played},
        ${r.win}, ${r.draw}, ${r.lose},
        ${r.goals_for}, ${r.goals_against}, ${r.goal_diff}, ${r.points},
        ${r.form}, ${r.movement_status}, ${r.qualification_description},
        ${r.group_name}, ${r.data_provider}, now())
      ON CONFLICT (league_id, team_id, season) DO UPDATE SET
        rank = EXCLUDED.rank, played = EXCLUDED.played,
        win = EXCLUDED.win, draw = EXCLUDED.draw, lose = EXCLUDED.lose,
        goals_for = EXCLUDED.goals_for, goals_against = EXCLUDED.goals_against,
        goal_diff = EXCLUDED.goal_diff, points = EXCLUDED.points,
        form = EXCLUDED.form, movement_status = EXCLUDED.movement_status,
        qualification_description = EXCLUDED.qualification_description,
        group_name = EXCLUDED.group_name,
        data_provider_synced_at = now(), updated_at = now()`;
    n += 1;
  }
  return n;
}
