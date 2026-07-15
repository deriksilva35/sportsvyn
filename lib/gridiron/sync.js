// lib/gridiron/sync.js — league / team / game sync for the gridiron feeds
// (NFL via BallDontLie, CFB via CollegeFootballData). SCOPE: teams +
// team_season_membership + games ONLY. No player rows, no stats, no PBP — those
// await a schema-design pass.
//
// Conventions reused from the soccer sync (lib/syncFixture.js), NOT reinvented:
//   - leagues upsert ON CONFLICT (slug); teams upsert ON CONFLICT (league_id,
//     slug) so a name/city shared across leagues (NFL vs CFB) is two distinct,
//     league-scoped rows — never a shared row.
//   - external_ids stored as { provider_id: String(id) } jsonb.
//   - all datetimes go through ingest.toUtc(); statuses through ingest.mapStatus;
//     season phase through ingest.skipRule. No ad-hoc Date()/AT TIME ZONE here.
//
// Idempotency: games upsert by (league_id, external_ids->>'<provider>_game_id'),
// backed by the migration-045 partial unique indexes as the guard rail. Re-runs
// UPDATE in place, never duplicate.
//
// Per-quarter scores: matches has no period-score column and WC rows leave
// metadata = {} (no soccer shape to follow), so line scores land in metadata
// jsonb as { line_scores: { home: [...], away: [...] } }.
//
// CFB FBS/FCS policy: syncCfbTeams imports FBS teams only. A game with one FBS
// side and one FCS side IS ingested (it is a real game on the FBS team's
// schedule); the FCS opponent is created as a minimal stub team flagged
// metadata.gridiron_stub = true + metadata.classification, so schedules stay
// complete without importing all of FCS. FCS-vs-FCS games are skipped
// (out of launch scope).

import { sql } from '../db.js';
import { toUtc, mapStatus, skipRule, makeRunSummary } from './ingest.js';

const BDL_BASE = 'https://api.balldontlie.io';
const CFBD_BASE = 'https://apinext.collegefootballdata.com';
const NFL_SLUG = 'nfl';
const CFB_SLUG = 'cfb';

function slugify(s) {
  return String(s ?? '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---- provider fetch (keys from env; never hardcoded / logged) --------------
async function bdlGet(pathAndQuery) {
  const key = process.env.BDL_API_KEY;
  if (!key) throw new Error('BDL_API_KEY missing in env');
  for (let attempt = 0; attempt < 4; attempt++) {
    const res = await fetch(`${BDL_BASE}${pathAndQuery}`, { headers: { Authorization: key } });
    if (res.status === 429) { await sleep(15000); continue; } // free tier 5/min
    if (!res.ok) throw new Error(`BDL ${res.status} on ${pathAndQuery}: ${(await res.text()).slice(0, 200)}`);
    return res.json();
  }
  throw new Error(`BDL rate-limited (429) after retries on ${pathAndQuery}`);
}
async function cfbdGet(pathAndQuery) {
  const key = process.env.CFBD_API_KEY;
  if (!key) throw new Error('CFBD_API_KEY missing in env');
  const res = await fetch(`${CFBD_BASE}${pathAndQuery}`, { headers: { Authorization: `Bearer ${key}` } });
  if (!res.ok) throw new Error(`CFBD ${res.status} on ${pathAndQuery}: ${(await res.text()).slice(0, 200)}`);
  return res.json();
}

// ---- upserts (house conventions) -------------------------------------------
async function upsertLeague({ slug, name, short_name, sport, season_type, external_ids }) {
  const rows = await sql`
    INSERT INTO leagues (slug, name, short_name, sport, season_type, external_ids, data_provider_synced_at)
    VALUES (${slug}, ${name}, ${short_name}, ${sport}, ${season_type}, ${JSON.stringify(external_ids)}::jsonb, now())
    ON CONFLICT (slug) DO UPDATE SET
      name = EXCLUDED.name, short_name = EXCLUDED.short_name, sport = EXCLUDED.sport,
      season_type = EXCLUDED.season_type, external_ids = EXCLUDED.external_ids,
      data_provider_synced_at = now(), updated_at = now()
    RETURNING id, slug, sport, season_type`;
  return rows[0];
}

async function upsertTeam(leagueId, t) {
  const rows = await sql`
    INSERT INTO teams (
      league_id, slug, name, short_name, abbreviation, external_ids,
      current_conference, current_division, metadata, data_provider_synced_at
    ) VALUES (
      ${leagueId}, ${t.slug}, ${t.name}, ${t.short_name ?? t.name}, ${t.abbreviation ?? null},
      ${JSON.stringify(t.externalIds)}::jsonb, ${t.current_conference ?? null}, ${t.current_division ?? null},
      ${JSON.stringify(t.metadata ?? {})}::jsonb, now()
    )
    ON CONFLICT (league_id, slug) DO UPDATE SET
      name = EXCLUDED.name, short_name = EXCLUDED.short_name,
      abbreviation = COALESCE(EXCLUDED.abbreviation, teams.abbreviation),
      external_ids = teams.external_ids || EXCLUDED.external_ids,
      current_conference = EXCLUDED.current_conference,
      current_division = EXCLUDED.current_division,
      metadata = teams.metadata || EXCLUDED.metadata,
      data_provider_synced_at = now(), updated_at = now()
    RETURNING id`;
  return rows[0].id;
}

async function upsertMembership(leagueId, teamId, seasonYear, { conference, division, conferenceSourceId }) {
  await sql`
    INSERT INTO team_season_membership (league_id, team_id, season_year, conference, division, conference_source_id)
    VALUES (${leagueId}, ${teamId}, ${seasonYear}, ${conference ?? null}, ${division ?? null}, ${conferenceSourceId ?? null})
    ON CONFLICT (league_id, team_id, season_year) DO UPDATE SET
      conference = EXCLUDED.conference, division = EXCLUDED.division,
      conference_source_id = EXCLUDED.conference_source_id, updated_at = now()`;
}

// Game upsert keyed on the provider game id (idempotent; migration-045 partial
// unique index is the DB guard rail). providerKey e.g. 'bdl_game_id'.
async function upsertGame(leagueId, providerKey, providerId, g) {
  const ext = JSON.stringify({ [providerKey]: String(providerId) });
  const existing = (await sql`
    SELECT id FROM matches WHERE league_id = ${leagueId} AND external_ids->>${providerKey} = ${String(providerId)} LIMIT 1`)[0];
  if (existing) {
    await sql`
      UPDATE matches SET
        home_team_id = ${g.homeTeamId}, away_team_id = ${g.awayTeamId},
        kickoff_at = ${g.kickoffAt}, status = ${g.status},
        home_score = ${g.homeScore}, away_score = ${g.awayScore},
        season_year = ${g.seasonYear}, season_phase = ${g.seasonPhase}, week = ${g.week},
        metadata = ${JSON.stringify(g.metadata ?? {})}::jsonb,
        external_ids = matches.external_ids || ${ext}::jsonb,
        data_provider_synced_at = now(), updated_at = now()
      WHERE id = ${existing.id}`;
    return { id: existing.id, inserted: false };
  }
  const rows = await sql`
    INSERT INTO matches (
      league_id, slug, home_team_id, away_team_id, kickoff_at, status,
      home_score, away_score, season_year, season_phase, week, metadata,
      external_ids, data_provider_synced_at
    ) VALUES (
      ${leagueId}, ${g.slug}, ${g.homeTeamId}, ${g.awayTeamId}, ${g.kickoffAt}, ${g.status},
      ${g.homeScore}, ${g.awayScore}, ${g.seasonYear}, ${g.seasonPhase}, ${g.week},
      ${JSON.stringify(g.metadata ?? {})}::jsonb, ${ext}::jsonb, now()
    ) RETURNING id`;
  return { id: rows[0].id, inserted: true };
}

async function teamMap(leagueId, providerKey) {
  const rows = await sql`
    SELECT id, external_ids->>${providerKey} AS pid FROM teams
     WHERE league_id = ${leagueId} AND jsonb_exists(external_ids, ${providerKey})`;
  return new Map(rows.map((r) => [r.pid, r.id]));
}

// ---------------------------------------------------------------------------
// (C.1) League bootstrap
// ---------------------------------------------------------------------------
export async function bootstrapLeagues() {
  const nfl = await upsertLeague({
    slug: NFL_SLUG, name: 'National Football League', short_name: 'NFL',
    sport: 'football', season_type: 'season-and-postseason', external_ids: { bdl_sport: 'nfl' },
  });
  const cfb = await upsertLeague({
    slug: CFB_SLUG, name: 'College Football', short_name: 'CFB',
    sport: 'football', season_type: 'season-and-postseason', external_ids: { cfbd_sport: 'cfb' },
  });
  return { nfl, cfb };
}

// ---------------------------------------------------------------------------
// (C.2) NFL teams  (BDL /nfl/v1/teams)
// ---------------------------------------------------------------------------
export async function syncNflTeams(leagueId, seasonYear = 2025) {
  const { data } = await bdlGet('/nfl/v1/teams');
  let teams = 0, memberships = 0;
  for (const t of data) {
    const teamId = await upsertTeam(leagueId, {
      slug: slugify(t.full_name), name: t.full_name, short_name: t.name, abbreviation: t.abbreviation,
      externalIds: { bdl_team_id: String(t.id) },
      current_conference: t.conference ?? null, current_division: t.division ?? null,
    });
    await upsertMembership(leagueId, teamId, seasonYear, { conference: t.conference ?? null, division: t.division ?? null });
    teams += 1; memberships += 1;
  }
  return { teams, memberships };
}

// ---------------------------------------------------------------------------
// (C.3) CFB teams  (CFBD /teams?year=)  — FBS only
// ---------------------------------------------------------------------------
export async function syncCfbTeams(leagueId, seasonYear = 2025) {
  const all = await cfbdGet(`/teams?year=${seasonYear}`);
  const fbs = all.filter((t) => t.classification === 'fbs');
  let teams = 0, memberships = 0;
  for (const t of fbs) {
    const teamId = await upsertTeam(leagueId, {
      slug: slugify(t.school), name: t.school, short_name: t.school, abbreviation: t.abbreviation ?? null,
      externalIds: { cfbd_team_id: String(t.id) },
      current_conference: t.conference ?? null, current_division: t.division ?? null,
      metadata: { classification: t.classification },
    });
    await upsertMembership(leagueId, teamId, seasonYear, { conference: t.conference ?? null, division: t.division ?? null });
    teams += 1; memberships += 1;
  }
  return { teams, memberships, filteredNonFbs: all.length - fbs.length };
}

// ---------------------------------------------------------------------------
// (D.1) NFL games  (BDL /nfl/v1/games, cursor pagination)
// ---------------------------------------------------------------------------
export async function syncNflGames(leagueId, seasonYear = 2025) {
  const summary = makeRunSummary();
  const tmap = await teamMap(leagueId, 'bdl_team_id');
  let cursor = null, missingTeam = 0;
  do {
    const q = `/nfl/v1/games?seasons[]=${seasonYear}&per_page=100${cursor ? `&cursor=${cursor}` : ''}`;
    const { data, meta } = await bdlGet(q);
    for (const g of data) {
      const phase = g.postseason ? 'POST' : 'REG';
      const sr = skipRule(phase, summary);
      if (sr.skip) continue;
      const status = mapStatus('bdl', 'nfl', g.status, summary);
      if (status == null) continue;
      const kickoffAt = await toUtc(g.date, null, 'bdl');
      if (kickoffAt == null) { summary.timeResolvedFromFallback += 1; continue; }
      const homeTeamId = tmap.get(String(g.home_team.id));
      const awayTeamId = tmap.get(String(g.visitor_team.id));
      if (homeTeamId == null || awayTeamId == null) { missingTeam += 1; continue; }
      const metadata = { line_scores: {
        home: [g.home_team_q1, g.home_team_q2, g.home_team_q3, g.home_team_q4, g.home_team_ot],
        away: [g.visitor_team_q1, g.visitor_team_q2, g.visitor_team_q3, g.visitor_team_q4, g.visitor_team_ot],
      } };
      const slug = `nfl-${seasonYear}-${phase.toLowerCase()}-w${g.week}-${slugify(g.visitor_team.abbreviation)}-${slugify(g.home_team.abbreviation)}`;
      await upsertGame(leagueId, 'bdl_game_id', g.id, {
        slug, homeTeamId, awayTeamId, kickoffAt, status,
        homeScore: g.home_team_score ?? null, awayScore: g.visitor_team_score ?? null,
        seasonYear, seasonPhase: phase, week: g.week, metadata,
      });
      summary.ingested += 1;
    }
    cursor = meta?.next_cursor ?? null;
  } while (cursor);
  return { ...summary, missingTeam };
}

// ---------------------------------------------------------------------------
// (D.2) CFB games  (CFBD /games?year=&seasonType=)  — FBS games; FCS stub policy
// ---------------------------------------------------------------------------
const CFB_PHASE = { regular: 'REG', postseason: 'POST' };

export async function syncCfbGames(leagueId, seasonYear = 2025) {
  const summary = makeRunSummary();
  const tmap = await teamMap(leagueId, 'cfbd_team_id');
  let fcsStubsCreated = 0, skippedNonFbsGame = 0;

  // Resolve or create a team from a game-side payload; FCS opponents become
  // flagged stubs so the FBS team's schedule stays complete.
  async function resolveSide(id, name, conference, classification) {
    const key = String(id);
    if (tmap.has(key)) return tmap.get(key);
    const teamId = await upsertTeam(leagueId, {
      slug: slugify(name), name, short_name: name, externalIds: { cfbd_team_id: key },
      current_conference: conference ?? null,
      metadata: { classification: classification ?? null, gridiron_stub: true },
    });
    await upsertMembership(leagueId, teamId, seasonYear, { conference: conference ?? null });
    tmap.set(key, teamId);
    if (classification !== 'fbs') fcsStubsCreated += 1;
    return teamId;
  }

  for (const st of ['regular', 'postseason']) {
    const games = await cfbdGet(`/games?year=${seasonYear}&seasonType=${st}`);
    for (const g of games) {
      const isFbs = g.homeClassification === 'fbs' || g.awayClassification === 'fbs';
      if (!isFbs) { skippedNonFbsGame += 1; continue; }
      const phase = CFB_PHASE[g.seasonType] ?? CFB_PHASE[st];
      const sr = skipRule(phase, summary);
      if (sr.skip) continue;
      const status = mapStatus('cfbd', 'cfb', { completed: g.completed, startDate: g.startDate, startTimeTBD: g.startTimeTBD }, summary);
      if (status == null) continue;
      const kickoffAt = await toUtc(g.startDate, null, 'cfbd');
      if (kickoffAt == null) { summary.timeResolvedFromFallback += 1; continue; }
      const homeTeamId = await resolveSide(g.homeId, g.homeTeam, g.homeConference, g.homeClassification);
      const awayTeamId = await resolveSide(g.awayId, g.awayTeam, g.awayConference, g.awayClassification);
      const metadata = { line_scores: { home: g.homeLineScores ?? null, away: g.awayLineScores ?? null } };
      const slug = `cfb-${seasonYear}-${phase.toLowerCase()}-w${g.week}-${slugify(g.awayTeam)}-${slugify(g.homeTeam)}`;
      await upsertGame(leagueId, 'cfbd_game_id', g.id, {
        slug, homeTeamId, awayTeamId, kickoffAt, status,
        homeScore: g.homePoints ?? null, awayScore: g.awayPoints ?? null,
        seasonYear, seasonPhase: phase, week: g.week, metadata,
      });
      summary.ingested += 1;
    }
  }
  return { ...summary, fcsStubsCreated, skippedNonFbsGame };
}
