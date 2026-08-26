// lib/gridiron/rosterImport.js - land NFL and CFB rosters in `players`.
//
// COST, MEASURED NOT ESTIMATED:
//   NFL  BDL /nfl/v1/players/active, cursor-paginated at 100  -> ~17 requests
//   CFB  CFBD /roster?year=  -> ONE request for the whole league (30,072 rows,
//        315 teams, 1.6s), filtered IN CODE to the 243 teams we hold.
//
// THE SCOPE RULING IS ABOUT WHAT WE STORE, NOT WHAT WE FETCH. Asking CFBD
// per-team would honour the same scope at 243 requests instead of 1 - a 243x
// cost for an identical result - so the filter lives here, after one fetch.
// 26,703 rows survive it; 242 of our 243 teams match by name (St. Francis (PA)
// is the one CFBD has no 2025 roster for).
//
// IDEMPOTENT on external_ids->>'<provider>_player_id', the plays/rankings
// pattern: re-importing corrects a roster rather than duplicating it.

import { sql } from '../db.js';
import { makeRunSummary, noteUnmapped } from './ingest.js';
import { fromBdl, fromCfbd } from './roster.js';

const BDL_BASE = 'https://api.balldontlie.io';
const CFBD_BASE = 'https://apinext.collegefootballdata.com';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function bdlGet(pathAndQuery) {
  const key = process.env.BDL_API_KEY;
  if (!key) throw new Error('BDL_API_KEY missing in env');
  for (let attempt = 0; attempt < 4; attempt++) {
    const res = await fetch(`${BDL_BASE}${pathAndQuery}`, { headers: { Authorization: key } });
    if (res.status === 429) { await sleep(15000); continue; }
    if (!res.ok) throw new Error(`BDL ${res.status} on ${pathAndQuery}: ${(await res.text()).slice(0, 200)}`);
    return res.json();
  }
  throw new Error(`BDL rate-limited after retries on ${pathAndQuery}`);
}
async function cfbdGet(pathAndQuery) {
  const key = process.env.CFBD_API_KEY;
  if (!key) throw new Error('CFBD_API_KEY missing in env');
  const res = await fetch(`${CFBD_BASE}${pathAndQuery}`, { headers: { Authorization: `Bearer ${key}` } });
  if (!res.ok) throw new Error(`CFBD ${res.status} on ${pathAndQuery}: ${(await res.text()).slice(0, 200)}`);
  return res.json();
}

/** A slug that cannot collide with the 1,248 soccer players already stored. */
function slugFor(name, providerKey, providerId) {
  const base = String(name ?? '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  const tag = providerKey === 'bdl_player_id' ? 'nfl' : 'cfb';
  return `${base || 'player'}-${tag}-${providerId}`;
}

/**
 * Upsert a CHUNK of players in one statement.
 *
 * WHY BATCHED. The first version did a SELECT then an INSERT-or-UPDATE per
 * player: two HTTP round trips each, measured at ~4 rows/sec against Neon,
 * which projects to ~110 minutes for CFB's 26,703 rows. One multi-row
 * INSERT ... ON CONFLICT per 500 does the same work in a few dozen statements.
 *
 * The ON CONFLICT target is the PARTIAL unique index from migration 076, and
 * the predicate must be repeated for Postgres to infer it. That predicate is
 * also the safety rail: a soccer player carries neither provider key, so they
 * are outside the index and cannot be matched, updated or collided with.
 */
async function upsertChunk(rows, providerKey) {
  if (!rows.length) return 0;
  // DEDUPE WITHIN THE CHUNK. CFBD's /roster?year= returns the same player id
  // more than once - a transfer listed under both teams, most likely - and
  // Postgres refuses outright: "ON CONFLICT DO UPDATE command cannot affect row
  // a second time". Last occurrence wins, which matches the per-row behaviour
  // this replaced.
  const byId = new Map();
  for (const r of rows) byId.set(r.providerId, r);
  rows = [...byId.values()];
  // ELEVEN bound params per row, not twelve - the twelfth column is now(),
  // which is literal SQL and consumes no placeholder. Using 12 as the stride
  // made the numbering outrun the params and Postgres refused $12 outright.
  const cols = 11;
  const values = rows.map((_, i) => {
    const b = i * cols;
    return `($${b+1},$${b+2},$${b+3},$${b+4},$${b+5},$${b+6},$${b+7},$${b+8},$${b+9},$${b+10},$${b+11}::jsonb,now())`;
  }).join(',');
  const params = rows.flatMap((r) => [
    r.slug, r.fullName, r.position, r.positionGroup, r.teamId, r.jersey,
    r.heightCm, r.weightKg, r.college, r.experienceYears,
    JSON.stringify({ [providerKey]: r.providerId }),
  ]);
  await sql.query(
    `INSERT INTO players (
       slug, full_name, position, position_group, current_team_id,
       current_team_jersey_number, height_cm, weight_kg, college,
       experience_years, external_ids, data_provider_synced_at
     ) VALUES ${values}
     ON CONFLICT ((external_ids->>'${providerKey}')) WHERE external_ids ? '${providerKey}'
     DO UPDATE SET
       full_name = EXCLUDED.full_name, position = EXCLUDED.position,
       position_group = EXCLUDED.position_group,
       current_team_id = EXCLUDED.current_team_id,
       current_team_jersey_number = EXCLUDED.current_team_jersey_number,
       height_cm = EXCLUDED.height_cm, weight_kg = EXCLUDED.weight_kg,
       college = EXCLUDED.college, experience_years = EXCLUDED.experience_years,
       external_ids = players.external_ids || EXCLUDED.external_ids,
       data_provider_synced_at = now(), updated_at = now()`,
    params,
  );
  return rows.length;
}

const CHUNK = 500;

/** provider team id -> our teams.id, for one league. */
async function teamMapByExternal(leagueSlug, providerKey) {
  const rows = await sql`
    SELECT t.id, t.external_ids->>${providerKey} AS pid FROM teams t
      JOIN leagues l ON l.id = t.league_id
     WHERE l.slug = ${leagueSlug} AND t.external_ids ? ${providerKey}`;
  return new Map(rows.map((r) => [r.pid, r.id]));
}

/** team NAME -> our teams.id. CFBD's /roster carries no team id, only a name. */
async function teamMapByName(leagueSlug) {
  const rows = await sql`
    SELECT t.id, t.name FROM teams t JOIN leagues l ON l.id = t.league_id
     WHERE l.slug = ${leagueSlug}`;
  return new Map(rows.map((r) => [r.name, r.id]));
}

export async function importNflRoster(runSummary = makeRunSummary()) {
  const tmap = await teamMapByExternal('nfl', 'bdl_team_id');
  let cursor = null, pages = 0, written = 0, skipped = 0;
  do {
    const j = await bdlGet(`/nfl/v1/players/active?per_page=100${cursor ? `&cursor=${cursor}` : ''}`);
    const batch = [];
    for (const raw of j.data ?? []) {
      const p = fromBdl(raw);
      const teamId = p.providerTeamId ? tmap.get(p.providerTeamId) : null;
      // A player with no resolvable team cannot appear on a team page, and a
      // null current_team_id would make them invisible anyway - so they are
      // skipped and counted rather than stored orphaned.
      if (teamId == null) { skipped++; continue; }
      if (!p.positionGroup) noteUnmapped(runSummary, `(pos) ${p.position ?? '?'}`);
      batch.push({ ...p, teamId, slug: slugFor(p.fullName, p.providerKey, p.providerId) });
    }
    written += await upsertChunk(batch, 'bdl_player_id');
    cursor = j.meta?.next_cursor ?? null;
    pages++;
  } while (cursor && pages < 40);
  return { league: 'nfl', requests: pages, written, skipped, runSummary };
}

export async function importCfbRoster(season, runSummary = makeRunSummary()) {
  // ONE request; the scope is applied to what we KEEP, not to what we ask for.
  const roster = await cfbdGet(`/roster?year=${season}`);
  const tmap = await teamMapByName('cfb');
  let written = 0, skipped = 0;
  const batch = [];
  for (const raw of roster) {
    const p = fromCfbd(raw);
    const teamId = p.providerTeamName ? tmap.get(p.providerTeamName) : null;
    if (teamId == null) { skipped++; continue; }   // a team we do not hold
    if (!p.positionGroup) noteUnmapped(runSummary, `(pos) ${p.position ?? '?'}`);
    batch.push({ ...p, teamId, slug: slugFor(p.fullName, p.providerKey, p.providerId) });
    if (batch.length >= CHUNK) { written += await upsertChunk(batch.splice(0), 'cfbd_player_id'); }
  }
  written += await upsertChunk(batch, 'cfbd_player_id');
  return { league: 'cfb', season, requests: 1, fetched: roster.length,
    written, skipped, runSummary };
}
