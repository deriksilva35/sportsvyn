// lib/soccer/epl.js - the Premier League sync: league row, clubs, fixtures.
//
// THE WC IMPORTER IS THE TEMPLATE (scripts/import-wc.mjs), lifted into lib so
// a cron can call it rather than a person running a throwaway script. Same
// idempotent upserts, same api-football v3 client, same status vocabulary -
// what changes is that a league season is a LEAGUE, not a tournament: no
// stages, no group codes, a matchweek round instead.
//
// THE SOCCER PRODUCT IS A SEPARATE SUBSCRIPTION with its own 75,000/day meter
// (Ultra, verified 23 Aug). Nothing here can starve the american-football
// poller's 2,000/day cap - different key, different quota.

import { sql } from '../db.js';
import { apiSports } from '../apiSports.js';

export const EPL_LEAGUE_API_ID = 39;
export const EPL_SLUG = 'epl';
/** api-football labels a European season by its OPENING year: 2026-27 = 2026. */
export const EPL_SEASON = 2026;

// The provider's fixture status vocabulary, verbatim from the WC importer -
// two seasons of evidence behind it. Unknown codes THROW rather than guess.
const STATUS_MAP = {
  TBD: 'scheduled', NS: 'scheduled',
  '1H': 'live', HT: 'live', '2H': 'live', ET: 'live', BT: 'live', P: 'live',
  SUSP: 'live', INT: 'live', LIVE: 'live',
  FT: 'final', AET: 'final', PEN: 'final',
  PST: 'postponed',
  CANC: 'cancelled', ABD: 'cancelled', AWD: 'cancelled', WO: 'cancelled',
};

export function mapFixtureStatus(short) {
  const out = STATUS_MAP[short];
  if (!out) throw new Error(`epl: unknown API-Sports status code '${short}'`);
  return out;
}

export function slugify(s) {
  return String(s)
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

/** 'Regular Season - 3' -> 3; anything else -> null (cups, playoffs). */
export function matchweekOf(round) {
  const m = String(round ?? '').match(/Regular Season\s*-\s*(\d+)/i);
  return m ? Number(m[1]) : null;
}

const ymd = (iso) => new Date(iso).toISOString().slice(0, 10);

export async function upsertEplLeague() {
  const externalIds = JSON.stringify({ api_sports: String(EPL_LEAGUE_API_ID) });
  const rows = await sql`
    INSERT INTO leagues (slug, name, short_name, sport, season_type, season_year,
                         external_ids, data_provider_synced_at)
    VALUES (${EPL_SLUG}, 'Premier League', 'Premier League',
            'soccer', 'league', ${EPL_SEASON}, ${externalIds}::jsonb, now())
    ON CONFLICT (slug) DO UPDATE SET
      name = EXCLUDED.name, short_name = EXCLUDED.short_name,
      sport = EXCLUDED.sport, season_type = EXCLUDED.season_type,
      season_year = EXCLUDED.season_year, external_ids = EXCLUDED.external_ids,
      data_provider_synced_at = EXCLUDED.data_provider_synced_at, updated_at = now()
    RETURNING id`;
  return rows[0].id;
}

export async function upsertEplTeams(leagueId) {
  const apiTeams = await apiSports.teams(EPL_LEAGUE_API_ID, EPL_SEASON);
  const map = new Map();
  for (const t of apiTeams) {
    const team = t.team;
    const externalIds = JSON.stringify({ api_sports: String(team.id) });
    const rows = await sql`
      INSERT INTO teams (league_id, slug, name, short_name, abbreviation,
                         external_ids, data_provider_synced_at)
      VALUES (${leagueId}, ${slugify(team.name)}, ${team.name}, ${team.name},
              ${team.code ?? null}, ${externalIds}::jsonb, now())
      ON CONFLICT (league_id, slug) DO UPDATE SET
        name = EXCLUDED.name, short_name = EXCLUDED.short_name,
        abbreviation = EXCLUDED.abbreviation, external_ids = EXCLUDED.external_ids,
        data_provider_synced_at = EXCLUDED.data_provider_synced_at, updated_at = now()
      RETURNING id`;
    map.set(team.id, rows[0].id);
  }
  return map;
}

/**
 * The season's fixtures. Idempotent on the match slug, and scores/status are
 * refreshed on every run - a re-sync of a played matchweek corrects itself.
 */
export async function upsertEplFixtures(leagueId, teamIdMap) {
  const fixtures = await apiSports.fixtures(EPL_LEAGUE_API_ID, EPL_SEASON);
  let upserted = 0, skipped = 0;
  const skippedReasons = [];
  for (const f of fixtures) {
    const homeId = teamIdMap.get(f.teams?.home?.id);
    const awayId = teamIdMap.get(f.teams?.away?.id);
    if (!homeId || !awayId) {
      skipped += 1;
      skippedReasons.push(`fixture ${f.fixture?.id}: unmapped club`);
      continue;
    }
    const slug = `${slugify(f.teams.home.name)}-vs-${slugify(f.teams.away.name)}-${ymd(f.fixture.date)}`;
    const status = mapFixtureStatus(f.fixture.status.short);
    const week = matchweekOf(f.league?.round);
    const externalIds = JSON.stringify({ api_sports: String(f.fixture.id) });
    await sql`
      INSERT INTO matches (league_id, slug, home_team_id, away_team_id,
                           kickoff_at, status, home_score, away_score,
                           season_year, week, venue, external_ids, data_provider_synced_at)
      VALUES (${leagueId}, ${slug}, ${homeId}, ${awayId},
              ${f.fixture.date}, ${status}, ${f.goals?.home ?? null}, ${f.goals?.away ?? null},
              ${EPL_SEASON}, ${week}, ${f.fixture.venue?.name ?? null},
              ${externalIds}::jsonb, now())
      ON CONFLICT (slug) DO UPDATE SET
        kickoff_at = EXCLUDED.kickoff_at, status = EXCLUDED.status,
        home_score = EXCLUDED.home_score, away_score = EXCLUDED.away_score,
        season_year = EXCLUDED.season_year, week = EXCLUDED.week,
        venue = EXCLUDED.venue, external_ids = EXCLUDED.external_ids,
        data_provider_synced_at = EXCLUDED.data_provider_synced_at, updated_at = now()`;
    upserted += 1;
  }
  return { upserted, skipped, skippedReasons };
}

/** The whole sync, in order. Safe to re-run; returns a ledger-ready summary. */
export async function syncEpl() {
  const leagueId = await upsertEplLeague();
  const teams = await upsertEplTeams(leagueId);
  const fx = await upsertEplFixtures(leagueId, teams);
  return { leagueId, teams: teams.size, fixtures: fx.upserted, skipped: fx.skipped,
    skippedReasons: fx.skippedReasons.slice(0, 5), requests: 2 };
}
