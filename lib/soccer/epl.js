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

//
// THE CHAMPIONS LEAGUE RIDES THE SAME SYNC (ucl, fri-3). The league, its clubs
// and its fixtures come off the registry (lib/soccer/leagues.js) - one
// syncSoccerLeague(slug), and syncEpl() is that function for 'epl'. What
// differs is data, not code: the UCL's rounds are 'League Stage - N' then
// named knockouts (stored as week + stage), its qualifying rounds are not
// imported, and a club gets a UCL team row of its own (teams are per league),
// so Arsenal-in-Europe never moves Arsenal-in-England.

import { sql as defaultSql } from '../db.js';
import { apiSports } from '../apiSports.js';
import { soccerLeague, roundOf } from './leagues.js';

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

/**
 * THE PLAN, LOGGED ON EVERY FIXTURE RUN (thu-24). On 28-29 Sep the account fell
 * to the Free plan and every soccer cron failed with a message about seasons;
 * the plan name in the run's summary says which account answered before
 * anybody has to read an error. /status is free. Never throws.
 */
export async function apiSportsPlan(client = apiSports) {
  try {
    const r = await client.status();
    const s = Array.isArray(r) ? r[0] : r;
    return {
      plan: s?.subscription?.plan ?? null,
      active: s?.subscription?.active ?? null,
      end: s?.subscription?.end ?? null,
      requestsToday: s?.requests?.current ?? null,
      limitDay: s?.requests?.limit_day ?? null,
    };
  } catch (e) {
    return { error: String(e?.message ?? e).slice(0, 160) };
  }
}

const ymd = (iso) => new Date(iso).toISOString().slice(0, 10);

const cfgOf = (slug) => {
  const c = soccerLeague(slug);
  if (!c) throw new Error(`soccer: no registry entry for '${slug}'`);
  return c;
};

/** The provider's fixture -> the row's round. EPL keeps its old rule (every
 *  fixture, week or null); the UCL skips qualifying and reports the unknown. */
export function fixtureRound(slug, round) {
  if (slug === 'epl') return { week: matchweekOf(round), stage: null };
  return roundOf(slug, round);
}

export async function upsertSoccerLeague(slug, { sql = defaultSql } = {}) {
  const c = cfgOf(slug);
  const externalIds = JSON.stringify({ api_sports: String(c.apiId) });
  const rows = await sql`
    INSERT INTO leagues (slug, name, short_name, sport, season_type, season_year,
                         external_ids, data_provider_synced_at)
    VALUES (${c.slug}, ${c.name}, ${c.shortName},
            'soccer', ${c.seasonType}, ${c.season}, ${externalIds}::jsonb, now())
    ON CONFLICT (slug) DO UPDATE SET
      name = EXCLUDED.name, short_name = EXCLUDED.short_name,
      sport = EXCLUDED.sport, season_type = EXCLUDED.season_type,
      season_year = EXCLUDED.season_year, external_ids = EXCLUDED.external_ids,
      data_provider_synced_at = EXCLUDED.data_provider_synced_at, updated_at = now()
    RETURNING id`;
  return rows[0].id;
}

export const upsertEplLeague = () => upsertSoccerLeague('epl');

/**
 * The league's clubs, from /teams (it carries the three-letter code /fixtures
 * does not). `only` narrows to the provider ids that appear in the imported
 * fixtures - the UCL's /teams lists every qualifier too, and a club knocked
 * out in July gets no row. No colours: the card draws a monogram without them.
 */
export async function upsertSoccerTeams(slug, leagueId, apiTeams, { sql = defaultSql, only = null } = {}) {
  const map = new Map();
  for (const t of apiTeams) {
    const team = t.team;
    if (only && !only.has(team.id)) continue;
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

export async function upsertEplTeams(leagueId) {
  return upsertSoccerTeams('epl', leagueId, await apiSports.teams(EPL_LEAGUE_API_ID, EPL_SEASON));
}

/**
 * The season's fixtures. Idempotent on the provider's fixture id (then the
 * slug), and scores/status are refreshed on every run - a re-sync of a played
 * round corrects itself.
 */
export async function upsertSoccerFixtures(slug, leagueId, teamIdMap, fixtures, { sql = defaultSql } = {}) {
  const c = cfgOf(slug);
  let upserted = 0, skipped = 0, notCarried = 0;
  const skippedReasons = [];
  for (const f of fixtures) {
    const rd = fixtureRound(slug, f.league?.round);
    if (rd.skip) { notCarried += 1; continue; }
    if (rd.unknown) {
      skipped += 1;
      skippedReasons.push(`fixture ${f.fixture?.id}: unknown round '${f.league?.round}'`);
      continue;
    }
    const homeId = teamIdMap.get(f.teams?.home?.id);
    const awayId = teamIdMap.get(f.teams?.away?.id);
    if (!homeId || !awayId) {
      skipped += 1;
      skippedReasons.push(`fixture ${f.fixture?.id}: unmapped club`);
      continue;
    }
    const matchSlug = `${slugify(f.teams.home.name)}-vs-${slugify(f.teams.away.name)}-${ymd(f.fixture.date)}`;
    const status = mapFixtureStatus(f.fixture.status.short);
    const { week, stage } = rd;
    const pen = f.score?.penalty ?? {};
    const externalIds = JSON.stringify({ api_sports: String(f.fixture.id) });
    // ONE ROW PER FIXTURE (thu-24). The slug carries the kickoff date, so a
    // fixture the league moved by a day used to be INSERTED again under its new
    // slug, leaving the old row 'scheduled' in the past (35 pairs on PROD,
    // removed by scripts/epl-dedupe-fixtures.mjs). The provider's fixture id is
    // the identity: an existing row is updated in place and KEEPS its slug, so
    // a shared link survives a reschedule.
    const existing = await sql`
      SELECT id FROM matches
       WHERE league_id = ${leagueId} AND external_ids->>'api_sports' = ${String(f.fixture.id)}
       ORDER BY data_provider_synced_at DESC NULLS LAST, id DESC LIMIT 1`;
    if (existing.length) {
      await sql`
        UPDATE matches SET
          kickoff_at = ${f.fixture.date}, status = ${status},
          home_score = ${f.goals?.home ?? null}, away_score = ${f.goals?.away ?? null},
          home_penalties = ${pen.home ?? null}, away_penalties = ${pen.away ?? null},
          season_year = ${c.season}, week = ${week}, stage = ${stage}, venue = ${f.fixture.venue?.name ?? null},
          external_ids = ${externalIds}::jsonb, data_provider_synced_at = now(), updated_at = now()
         WHERE id = ${existing[0].id}`;
      upserted += 1;
      continue;
    }
    // A slug another league already holds is never taken over: the conflict
    // updates only a row of THIS league.
    const ins = await sql`
      INSERT INTO matches (league_id, slug, home_team_id, away_team_id,
                           kickoff_at, status, home_score, away_score, home_penalties, away_penalties,
                           season_year, week, stage, venue, external_ids, data_provider_synced_at)
      VALUES (${leagueId}, ${matchSlug}, ${homeId}, ${awayId},
              ${f.fixture.date}, ${status}, ${f.goals?.home ?? null}, ${f.goals?.away ?? null},
              ${pen.home ?? null}, ${pen.away ?? null},
              ${c.season}, ${week}, ${stage}, ${f.fixture.venue?.name ?? null},
              ${externalIds}::jsonb, now())
      ON CONFLICT (slug) DO UPDATE SET
        kickoff_at = EXCLUDED.kickoff_at, status = EXCLUDED.status,
        home_score = EXCLUDED.home_score, away_score = EXCLUDED.away_score,
        home_penalties = EXCLUDED.home_penalties, away_penalties = EXCLUDED.away_penalties,
        season_year = EXCLUDED.season_year, week = EXCLUDED.week, stage = EXCLUDED.stage,
        venue = EXCLUDED.venue, external_ids = EXCLUDED.external_ids,
        data_provider_synced_at = EXCLUDED.data_provider_synced_at, updated_at = now()
       WHERE matches.league_id = EXCLUDED.league_id
      RETURNING id`;
    if (!ins.length) {
      skipped += 1;
      skippedReasons.push(`fixture ${f.fixture?.id}: slug ${matchSlug} belongs to another league`);
      continue;
    }
    upserted += 1;
  }
  return { upserted, skipped, notCarried, skippedReasons };
}

export async function upsertEplFixtures(leagueId, teamIdMap) {
  return upsertSoccerFixtures('epl', leagueId, teamIdMap, await apiSports.fixtures(EPL_LEAGUE_API_ID, EPL_SEASON));
}

/**
 * One league's whole sync, in order. Safe to re-run; returns a ledger-ready
 * summary. TWO REQUESTS (teams + fixtures), whichever the league. `client`
 * and `sql` are injectable - the tests drive recorded payloads through it.
 */
export async function syncSoccerLeague(slug, { client = apiSports, sql = defaultSql } = {}) {
  const c = cfgOf(slug);
  const [apiTeams, fixtures] = [await client.teams(c.apiId, c.season), await client.fixtures(c.apiId, c.season)];
  const leagueId = await upsertSoccerLeague(slug, { sql });
  // The clubs the carried fixtures name - every /teams club for the EPL.
  const only = slug === 'epl' ? null : new Set(fixtures
    .filter((f) => { const r = fixtureRound(slug, f.league?.round); return !r.skip && !r.unknown; })
    .flatMap((f) => [f.teams?.home?.id, f.teams?.away?.id]));
  const teams = await upsertSoccerTeams(slug, leagueId, apiTeams, { sql, only });
  const fx = await upsertSoccerFixtures(slug, leagueId, teams, fixtures, { sql });
  return { leagueId, teams: teams.size, fixtures: fx.upserted, skipped: fx.skipped,
    ...(fx.notCarried ? { notCarried: fx.notCarried } : {}),
    skippedReasons: fx.skippedReasons.slice(0, 5), requests: 2 };
}

/** The Premier League's sync - the cron's first call, unchanged in effect. */
export async function syncEpl() {
  return syncSoccerLeague('epl');
}

/** The Champions League's (ucl, fri-3): two more requests a day. */
export async function syncUcl() {
  return syncSoccerLeague('ucl');
}
