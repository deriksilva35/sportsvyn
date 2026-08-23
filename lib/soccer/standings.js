// lib/soccer/standings.js - the league table, from the provider.
//
// THE PROVIDER OWNS THE TABLE, not us. Points are trivial to compute from
// matches; the TABLE is not - it carries head-to-head tiebreaks, points
// deductions (administration, FFP), and the exact ordering the league
// publishes. Computing it ourselves would mean shipping a table that
// disagrees with the BBC on the one day a deduction lands.
//
// STORED AS A DOCUMENT ON THE LEAGUE ROW (leagues.metadata.standings), not a
// new table: it is read whole, written whole, and has exactly one row per
// league - the shape a jsonb column is for. No migration, and the flat
// top-level key keeps the shallow-merge law satisfied.

import { sql } from '../db.js';
import { EPL_LEAGUE_API_ID, EPL_SEASON, EPL_SLUG } from './epl.js';

const HOST = 'https://v3.football.api-sports.io';

/** One provider row -> our shape. PURE. */
export function toStandingRow(r) {
  return {
    rank: r.rank,
    teamId: r.team?.id ?? null,
    team: r.team?.name ?? null,
    played: r.all?.played ?? 0,
    win: r.all?.win ?? 0,
    draw: r.all?.draw ?? 0,
    lose: r.all?.lose ?? 0,
    goalsFor: r.all?.goals?.for ?? 0,
    goalsAgainst: r.all?.goals?.against ?? 0,
    goalsDiff: r.goalsDiff ?? 0,
    points: r.points ?? 0,
    // 'WDLWW', newest last per the provider - the page renders the tail.
    form: r.form ?? null,
    // 'Promotion - Champions League (Group Stage)' / 'Relegation' / null:
    // the league's own words, which drive the rail treatment.
    note: r.description ?? null,
  };
}

/** Champions League / Europa / relegation, from the provider's own prose. */
export function railFor(note) {
  const s = String(note ?? '').toLowerCase();
  if (!s) return null;
  if (s.includes('relegation')) return 'drop';
  if (s.includes('champions league')) return 'ucl';
  if (s.includes('europa') || s.includes('conference')) return 'uel';
  return null;
}

export async function fetchEplStandings() {
  const res = await fetch(
    `${HOST}/standings?league=${EPL_LEAGUE_API_ID}&season=${EPL_SEASON}`,
    { headers: { 'x-apisports-key': process.env.API_SPORTS_KEY } },
  );
  if (!res.ok) throw new Error(`standings: HTTP ${res.status}`);
  const body = await res.json();
  const table = body?.response?.[0]?.league?.standings?.[0];
  if (!Array.isArray(table) || table.length === 0) {
    throw new Error('standings: provider returned no table');
  }
  return table.map(toStandingRow);
}

/** Sync + store. Idempotent: same table in, same document out. */
export async function syncEplStandings() {
  const rows = await fetchEplStandings();
  const doc = JSON.stringify({ standings: { rows, updatedAt: new Date().toISOString() } });
  const r = await sql`
    UPDATE leagues
       SET metadata = COALESCE(metadata, '{}'::jsonb) || ${doc}::jsonb, updated_at = now()
     WHERE slug = ${EPL_SLUG}
     RETURNING id`;
  if (r.length === 0) throw new Error(`standings: no league row for '${EPL_SLUG}'`);
  return { clubs: rows.length, leader: rows[0]?.team ?? null, requests: 1 };
}

/** The stored table, or null before the first sync. Caught by callers. */
export async function getEplStandings() {
  const r = await sql`
    SELECT metadata->'standings' AS s FROM leagues WHERE slug = ${EPL_SLUG} LIMIT 1`;
  const s = r[0]?.s ?? null;
  return s?.rows?.length ? s : null;
}
