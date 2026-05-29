// lib/formSync.js — reusable form-data importer.
//
// syncTeamRecentResults(apiSportsTeamId) pulls a team's last N finished
// fixtures from API-Sports and upserts each into our DB under its REAL
// league (Option C semantics — no lumping into a catch-all bucket).
//
//   1. Resolve the league: SELECT by external_ids->>'api_sports', or
//      INSERT a fresh league row when first encountered.
//   2. Resolve both teams under that league: same lookup-or-insert
//      pattern, scoped to (league_id, api_sports_id). A real team can
//      exist as multiple rows across leagues — UNIQUE (league_id, slug)
//      makes that legal.
//   3. UPSERT the match keyed on slug (the only UNIQUE on `matches` per
//      migration 006). ON CONFLICT DO UPDATE refreshes scores, status,
//      kickoff if the API revised them.
//
// Idempotent: re-running against the same fixture set hits ON CONFLICT
// on each layer and produces no duplicates.

import { sql } from './db.js';
import { apiSports } from './apiSports.js';

// ============================================================================
// Shared helpers (same shape as lib/syncFixture.js + scripts/import-wc.mjs)
// ============================================================================

function slugify(s) {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

const STATUS_MAP = {
  TBD: 'scheduled', NS: 'scheduled',
  '1H': 'live', HT: 'live', '2H': 'live', ET: 'live', BT: 'live', P: 'live',
  SUSP: 'live', INT: 'live', LIVE: 'live',
  FT: 'final', AET: 'final', PEN: 'final',
  PST: 'postponed',
  CANC: 'cancelled', ABD: 'cancelled', AWD: 'cancelled', WO: 'cancelled',
};
const FINAL_STATUSES = new Set(['FT', 'AET', 'PEN']);

function mapStatus(short) {
  const out = STATUS_MAP[short];
  if (!out) throw new Error(`Unknown API-Sports status code: ${short}`);
  return out;
}

function mapStageAndGroup(round) {
  if (!round) return { stage: null, groupCode: null };
  const r = round.trim();
  const groupLetter = r.match(/^Group\s+([A-L])\s*-\s*\d+$/i);
  if (groupLetter) return { stage: 'group', groupCode: groupLetter[1].toUpperCase() };
  if (/^Group\s+Stage\b/i.test(r))         return { stage: 'group', groupCode: null };
  if (/^Round of 32/i.test(r))             return { stage: 'round_of_32', groupCode: null };
  if (/^Round of 16/i.test(r))             return { stage: 'round_of_16', groupCode: null };
  if (/^Quarter[- ]?finals?/i.test(r))     return { stage: 'quarter', groupCode: null };
  if (/^Semi[- ]?finals?/i.test(r))        return { stage: 'semi', groupCode: null };
  if (/^3rd Place|^Third Place/i.test(r))  return { stage: 'third_place', groupCode: null };
  if (/^Final$/i.test(r))                  return { stage: 'final', groupCode: null };
  return { stage: null, groupCode: null };
}

function ymd(iso) {
  return new Date(iso).toISOString().slice(0, 10);
}

// ============================================================================
// Upserts — league → team → match
// ============================================================================

async function upsertLeagueFromApi(apiLeague) {
  const apiSportsId = String(apiLeague.id);

  // Lookup by api_sports id first — that's the canonical identifier across
  // any name/slug variation between API and our DB.
  const existing = await sql`
    SELECT id FROM leagues WHERE external_ids->>'api_sports' = ${apiSportsId} LIMIT 1
  `;
  if (existing[0]) return { id: existing[0].id, created: false };

  const slug = slugify(apiLeague.name ?? `league-${apiSportsId}`);
  const externalIds = JSON.stringify({ api_sports: apiSportsId });
  const seasonYear = apiLeague.season ?? null;
  const sport = 'soccer';
  // Default season_type 'tournament' for new leagues — common case for the
  // competitions we'd encounter via form sync (Gold Cup, UCL, WCQ, etc.).
  // Friendlies (already in DB) carry 'friendly'; this default doesn't
  // overwrite them since the lookup-first path returns existing rows.
  const seasonType = 'tournament';

  const inserted = await sql`
    INSERT INTO leagues (slug, name, sport, season_type, season_year, external_ids, data_provider_synced_at)
    VALUES (${slug}, ${apiLeague.name}, ${sport}, ${seasonType}, ${seasonYear}, ${externalIds}::jsonb, now())
    ON CONFLICT (slug) DO UPDATE SET
      external_ids = leagues.external_ids || EXCLUDED.external_ids,
      data_provider_synced_at = EXCLUDED.data_provider_synced_at,
      updated_at = now()
    RETURNING id
  `;
  return { id: inserted[0].id, created: true };
}

async function upsertTeamInLeague(leagueId, apiTeam) {
  const apiSportsId = String(apiTeam.id);

  // Scope to (league_id, api_sports_id). A team can have multiple rows in
  // our DB — one per league it appears in — that's expected per the
  // UNIQUE(league_id, slug) constraint.
  const existing = await sql`
    SELECT id FROM teams
    WHERE league_id = ${leagueId}
      AND external_ids->>'api_sports' = ${apiSportsId}
    LIMIT 1
  `;
  if (existing[0]) return existing[0].id;

  const slug = slugify(apiTeam.name);
  const externalIds = JSON.stringify({ api_sports: apiSportsId });

  const inserted = await sql`
    INSERT INTO teams (league_id, slug, name, short_name, abbreviation, external_ids, data_provider_synced_at)
    VALUES (
      ${leagueId}, ${slug}, ${apiTeam.name}, ${apiTeam.name}, ${apiTeam.code ?? null},
      ${externalIds}::jsonb, now()
    )
    ON CONFLICT (league_id, slug) DO UPDATE SET
      external_ids = teams.external_ids || EXCLUDED.external_ids,
      data_provider_synced_at = EXCLUDED.data_provider_synced_at,
      updated_at = now()
    RETURNING id
  `;
  return inserted[0].id;
}

async function upsertMatch({ leagueId, homeTeamId, awayTeamId, fixture, fixtureLeague }) {
  const homeName = fixture.teams?.home?.name;
  const awayName = fixture.teams?.away?.name;
  const homeSlug = slugify(homeName);
  const awaySlug = slugify(awayName);
  const datePart = ymd(fixture.fixture?.date);
  const slug = `${homeSlug}-vs-${awaySlug}-${datePart}`;
  const status = mapStatus(fixture.fixture?.status?.short);
  const { stage, groupCode } = mapStageAndGroup(fixtureLeague?.round);
  const venue = fixture.fixture?.venue?.name ?? null;
  const externalIds = JSON.stringify({ api_sports: String(fixture.fixture?.id) });

  await sql`
    INSERT INTO matches (
      league_id, slug, home_team_id, away_team_id,
      kickoff_at, status, home_score, away_score,
      stage, group_code, venue, external_ids, data_provider_synced_at
    ) VALUES (
      ${leagueId}, ${slug}, ${homeTeamId}, ${awayTeamId},
      ${fixture.fixture?.date}, ${status}, ${fixture.goals?.home ?? null}, ${fixture.goals?.away ?? null},
      ${stage}, ${groupCode}, ${venue}, ${externalIds}::jsonb, now()
    )
    ON CONFLICT (slug) DO UPDATE SET
      kickoff_at = EXCLUDED.kickoff_at,
      status = EXCLUDED.status,
      home_score = EXCLUDED.home_score,
      away_score = EXCLUDED.away_score,
      stage = EXCLUDED.stage,
      group_code = EXCLUDED.group_code,
      venue = EXCLUDED.venue,
      external_ids = EXCLUDED.external_ids,
      data_provider_synced_at = EXCLUDED.data_provider_synced_at,
      updated_at = now()
  `;
}

// ============================================================================
// Public entry
// ============================================================================

export async function syncTeamRecentResults(apiSportsTeamId, { limit = 10 } = {}) {
  if (!Number.isInteger(apiSportsTeamId) || apiSportsTeamId <= 0) {
    throw new Error(`Invalid api_sports team id: ${apiSportsTeamId}`);
  }
  const fixtures = await apiSports.fixturesByTeam({ team: apiSportsTeamId, last: limit });

  const leagueIdsCreated = new Set();
  const leagueIdsReused = new Set();
  const teamIdsTouched = new Set();
  let matchesUpserted = 0;
  let skippedNonFinal = 0;
  const detail = [];

  for (const f of fixtures || []) {
    const statusShort = f.fixture?.status?.short;
    if (!FINAL_STATUSES.has(statusShort)) {
      skippedNonFinal++;
      continue;
    }

    const { id: leagueId, created } = await upsertLeagueFromApi(f.league);
    if (created) leagueIdsCreated.add(leagueId);
    else leagueIdsReused.add(leagueId);

    const homeTeamId = await upsertTeamInLeague(leagueId, f.teams.home);
    const awayTeamId = await upsertTeamInLeague(leagueId, f.teams.away);
    teamIdsTouched.add(homeTeamId);
    teamIdsTouched.add(awayTeamId);

    await upsertMatch({ leagueId, homeTeamId, awayTeamId, fixture: f, fixtureLeague: f.league });
    matchesUpserted++;
    detail.push({
      fixture_id: f.fixture?.id,
      date: f.fixture?.date,
      league: f.league?.name,
      score: `${f.teams.home.name} ${f.goals.home}-${f.goals.away} ${f.teams.away.name}`,
    });
  }

  return {
    api_sports_team_id: apiSportsTeamId,
    fixtures_seen: (fixtures || []).length,
    skipped_non_final: skippedNonFinal,
    matches_upserted: matchesUpserted,
    leagues_created: leagueIdsCreated.size,
    leagues_reused: leagueIdsReused.size,
    teams_touched: teamIdsTouched.size,
    detail,
  };
}
