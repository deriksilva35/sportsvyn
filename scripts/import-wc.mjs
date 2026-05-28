// scripts/import-wc.mjs
// Throwaway import that upserts the 2026 FIFA World Cup league, its 48
// teams, and its fixture list into whatever DATABASE_URL points at.
// Run via: node --env-file=.env.local scripts/import-wc.mjs (DEV by default).
//
// Idempotent: each entity has an ON CONFLICT clause on its natural key
// (leagues.slug, teams.(league_id,slug), matches.slug). Re-running updates
// the API-controlled fields and leaves editorial / denormalized columns
// (migration 017) untouched.

import { sql } from '../lib/db.js';
import { apiSports } from '../lib/apiSports.js';

const WC_LEAGUE_API_ID = 1;
const SEASON = 2026;

function slugify(s) {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

const STATUS_MAP = {
  // pre-match
  TBD: 'scheduled', NS: 'scheduled',
  // in-flight
  '1H': 'live', HT: 'live', '2H': 'live', ET: 'live', BT: 'live', P: 'live',
  SUSP: 'live', INT: 'live', LIVE: 'live',
  // final
  FT: 'final', AET: 'final', PEN: 'final',
  // postponed / cancelled
  PST: 'postponed',
  CANC: 'cancelled', ABD: 'cancelled', AWD: 'cancelled', WO: 'cancelled',
};

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
  if (/^Group\s+Stage\b/i.test(r)) return { stage: 'group', groupCode: null };
  if (/^Round of 32/i.test(r))     return { stage: 'round_of_32', groupCode: null };
  if (/^Round of 16/i.test(r))     return { stage: 'round_of_16', groupCode: null };
  if (/^Quarter[- ]?finals?/i.test(r)) return { stage: 'quarter', groupCode: null };
  if (/^Semi[- ]?finals?/i.test(r))    return { stage: 'semi', groupCode: null };
  if (/^3rd Place|^Third Place/i.test(r)) return { stage: 'third_place', groupCode: null };
  if (/^Final$/i.test(r))          return { stage: 'final', groupCode: null };
  return { stage: null, groupCode: null };
}

function ymd(iso) {
  return new Date(iso).toISOString().slice(0, 10);
}

async function upsertLeague() {
  const externalIds = JSON.stringify({ api_sports: String(WC_LEAGUE_API_ID) });
  const rows = await sql`
    INSERT INTO leagues (
      slug, name, short_name, sport, season_type, season_year,
      external_ids, data_provider_synced_at
    )
    VALUES (
      'fifa-wc-2026', '2026 FIFA World Cup', 'World Cup',
      'soccer', 'tournament', ${SEASON},
      ${externalIds}::jsonb, now()
    )
    ON CONFLICT (slug) DO UPDATE SET
      name = EXCLUDED.name,
      short_name = EXCLUDED.short_name,
      sport = EXCLUDED.sport,
      season_type = EXCLUDED.season_type,
      season_year = EXCLUDED.season_year,
      external_ids = EXCLUDED.external_ids,
      data_provider_synced_at = EXCLUDED.data_provider_synced_at,
      updated_at = now()
    RETURNING id
  `;
  return rows[0].id;
}

async function upsertTeams(leagueId) {
  const apiTeams = await apiSports.teams(WC_LEAGUE_API_ID, SEASON);
  const map = new Map();
  for (const t of apiTeams) {
    const team = t.team;
    const slug = slugify(team.name);
    const externalIds = JSON.stringify({ api_sports: String(team.id) });
    const rows = await sql`
      INSERT INTO teams (
        league_id, slug, name, short_name, abbreviation,
        external_ids, data_provider_synced_at
      )
      VALUES (
        ${leagueId}, ${slug}, ${team.name}, ${team.name}, ${team.code ?? null},
        ${externalIds}::jsonb, now()
      )
      ON CONFLICT (league_id, slug) DO UPDATE SET
        name = EXCLUDED.name,
        short_name = EXCLUDED.short_name,
        abbreviation = EXCLUDED.abbreviation,
        external_ids = EXCLUDED.external_ids,
        data_provider_synced_at = EXCLUDED.data_provider_synced_at,
        updated_at = now()
      RETURNING id
    `;
    map.set(team.id, rows[0].id);
  }
  return map;
}

async function upsertFixtures(leagueId, teamIdMap) {
  const fixtures = await apiSports.fixtures(WC_LEAGUE_API_ID, SEASON);
  let upserted = 0;
  let skipped = 0;
  const skippedReasons = [];

  for (const f of fixtures) {
    const homeApiId = f.teams.home?.id;
    const awayApiId = f.teams.away?.id;
    const homeId = teamIdMap.get(homeApiId);
    const awayId = teamIdMap.get(awayApiId);
    if (!homeId || !awayId) {
      skipped++;
      skippedReasons.push(`fixture ${f.fixture.id}: missing team mapping (home api ${homeApiId} → ${homeId ?? 'X'}, away api ${awayApiId} → ${awayId ?? 'X'})`);
      continue;
    }

    const homeSlug = slugify(f.teams.home.name);
    const awaySlug = slugify(f.teams.away.name);
    const datePart = ymd(f.fixture.date);
    const slug = `${homeSlug}-vs-${awaySlug}-${datePart}`;
    const status = mapStatus(f.fixture.status.short);
    const { stage, groupCode } = mapStageAndGroup(f.league.round);
    const externalIds = JSON.stringify({ api_sports: String(f.fixture.id) });
    const venue = f.fixture.venue?.name ?? null;

    await sql`
      INSERT INTO matches (
        league_id, slug, home_team_id, away_team_id,
        kickoff_at, status, home_score, away_score,
        stage, group_code, venue, external_ids, data_provider_synced_at
      )
      VALUES (
        ${leagueId}, ${slug}, ${homeId}, ${awayId},
        ${f.fixture.date}, ${status}, ${f.goals.home ?? null}, ${f.goals.away ?? null},
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
    upserted++;
  }

  return { upserted, skipped, skippedReasons };
}

async function verify(leagueId) {
  const [{ n: teamCount }] = await sql`SELECT count(*)::int AS n FROM teams WHERE league_id = ${leagueId}`;
  const [{ n: matchCount }] = await sql`SELECT count(*)::int AS n FROM matches WHERE league_id = ${leagueId}`;
  console.log(`teams in WC:    ${teamCount}  (expect 48)`);
  console.log(`matches in WC:  ${matchCount}  (expect 72)`);

  const [argentina] = await sql`
    SELECT id, name, slug, group_code, abbreviation
    FROM teams
    WHERE league_id = ${leagueId} AND slug = 'argentina'
    LIMIT 1
  `;

  if (!argentina) {
    console.log('Argentina row: NOT FOUND');
    return;
  }

  console.log(`\nArgentina row: id=${argentina.id} name="${argentina.name}" slug=${argentina.slug} abbr=${argentina.abbreviation ?? '(null)'} group_code=${argentina.group_code ?? '(null)'}`);

  const fixtures = await sql`
    SELECT
      m.kickoff_at, m.status, m.stage, m.group_code,
      m.home_score, m.away_score,
      CASE WHEN m.home_team_id = ${argentina.id} THEN at.name ELSE ht.name END AS opponent,
      CASE WHEN m.home_team_id = ${argentina.id} THEN 'home' ELSE 'away' END AS venue_side
    FROM matches m
    LEFT JOIN teams ht ON ht.id = m.home_team_id
    LEFT JOIN teams at ON at.id = m.away_team_id
    WHERE (m.home_team_id = ${argentina.id} OR m.away_team_id = ${argentina.id})
      AND m.league_id = ${leagueId}
    ORDER BY m.kickoff_at
  `;

  console.log(`Argentina fixtures (${fixtures.length}):`);
  for (const f of fixtures) {
    const d = new Date(f.kickoff_at).toISOString().slice(0, 16).replace('T', ' ');
    const score = (f.home_score != null && f.away_score != null) ? ` ${f.home_score}-${f.away_score}` : '';
    const stage = f.stage ?? '—';
    const grp = f.group_code ? ` (${f.group_code})` : '';
    console.log(`  ${d}Z  [${stage}${grp}]  ${f.venue_side === 'home' ? 'vs' : '@'} ${f.opponent}${score}  status=${f.status}`);
  }
}

(async () => {
  const t0 = Date.now();
  console.log('=== Importing 2026 FIFA World Cup reference data ===');

  const leagueId = await upsertLeague();
  console.log(`leagues row id: ${leagueId}`);

  const teamIdMap = await upsertTeams(leagueId);
  console.log(`teams upserted: ${teamIdMap.size}`);

  const { upserted, skipped, skippedReasons } = await upsertFixtures(leagueId, teamIdMap);
  console.log(`matches upserted: ${upserted}  (skipped: ${skipped})`);
  for (const r of skippedReasons) console.log(`  · ${r}`);

  console.log(`\n--- Verification ---`);
  await verify(leagueId);

  console.log(`\nDone in ${Date.now() - t0}ms`);
})();
