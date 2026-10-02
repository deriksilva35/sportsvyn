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
import { EPL_SLUG } from './epl.js';
import { soccerLeague } from './leagues.js';

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

/**
 * One league's table from the provider. The UCL's league phase is ONE table of
 * 36 (the provider's single group); the EPL's is one of 20. `fetchJson` is
 * injectable so the tests read a recorded payload.
 */
export async function fetchSoccerStandings(slug, { fetchJson = null } = {}) {
  const c = soccerLeague(slug);
  if (!c) throw new Error(`standings: no registry entry for '${slug}'`);
  const url = `${HOST}/standings?league=${c.apiId}&season=${c.season}`;
  const body = fetchJson ? await fetchJson(url) : await (async () => {
    const res = await fetch(url, { headers: { 'x-apisports-key': process.env.API_SPORTS_KEY } });
    if (!res.ok) throw new Error(`standings: HTTP ${res.status}`);
    return res.json();
  })();
  const table = body?.response?.[0]?.league?.standings?.[0];
  if (!Array.isArray(table) || table.length === 0) {
    throw new Error(`standings: provider returned no ${slug} table`);
  }
  return table.map(toStandingRow);
}

export const fetchEplStandings = () => fetchSoccerStandings(EPL_SLUG);

/** Sync + store one league's table. Idempotent: same table in, same document out. */
export async function syncSoccerStandings(slug, { fetchJson = null, db = sql, storeAs = null } = {}) {
  const rows = await fetchSoccerStandings(slug, { fetchJson });
  // `standings` is a FLAT top-level key replaced whole - the shallow merge is
  // exactly right for it (CLAUDE.md: never || into a nested key).
  const doc = JSON.stringify({ standings: { rows, updatedAt: new Date().toISOString() } });
  const r = await db`
    UPDATE leagues
       SET metadata = CASE WHEN jsonb_typeof(metadata) = 'object' THEN metadata ELSE '{}'::jsonb END || ${doc}::jsonb,
           updated_at = now()
     WHERE slug = ${storeAs ?? slug}
     RETURNING id`;
  if (r.length === 0) throw new Error(`standings: no league row for '${storeAs ?? slug}'`);
  return { clubs: rows.length, leader: rows[0]?.team ?? null, requests: 1 };
}

export const syncEplStandings = () => syncSoccerStandings(EPL_SLUG);

/** The stored table, or null before the first sync. Caught by callers. */
export async function getSoccerStandings(slug, { db = sql } = {}) {
  const r = await db`
    SELECT metadata->'standings' AS s FROM leagues WHERE slug = ${slug} LIMIT 1`;
  const s = r[0]?.s ?? null;
  return s?.rows?.length ? s : null;
}

export const getEplStandings = () => getSoccerStandings(EPL_SLUG);
