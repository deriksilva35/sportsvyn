// lib/syncFixture.js — shared single-fixture upsert + poll logger. Used by
// both scripts/import-fixture.mjs and the /api/sync/fixture/[id] route so
// the CLI tool and the live poller stay in sync.
//
// Every invocation writes exactly one sync_log row — including failures.
// A failed poll is itself data we want to see in the post-match timeline
// (replay-match.mjs). The log write is best-effort: if it fails (DB down,
// etc.) we console.error and proceed, so the underlying sync error is
// what surfaces to the caller.
//
// Idempotent on the data path: friendlies league, both teams, and the
// match each use ON CONFLICT DO UPDATE on their natural keys. Re-running
// refreshes API-controlled fields and leaves editorial / denormalized
// columns alone.

import { sql } from './db.js';
import { apiSports } from './apiSports.js';
import { syncMatchEvents } from './events.js';

const FRIENDLIES_API_ID = 10;
const FRIENDLIES_SLUG = 'international-friendlies';

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

function mapStatus(short) {
  const out = STATUS_MAP[short];
  if (!out) throw new Error(`Unknown API-Sports status code: ${short}`);
  return out;
}

function ymd(iso) {
  return new Date(iso).toISOString().slice(0, 10);
}

async function upsertFriendliesLeague() {
  const externalIds = JSON.stringify({ api_sports: String(FRIENDLIES_API_ID) });
  const rows = await sql`
    INSERT INTO leagues (
      slug, name, short_name, sport, season_type,
      external_ids, data_provider_synced_at
    )
    VALUES (
      ${FRIENDLIES_SLUG}, 'International Friendlies', 'Friendlies',
      'soccer', 'friendly',
      ${externalIds}::jsonb, now()
    )
    ON CONFLICT (slug) DO UPDATE SET
      name = EXCLUDED.name,
      short_name = EXCLUDED.short_name,
      sport = EXCLUDED.sport,
      season_type = EXCLUDED.season_type,
      external_ids = EXCLUDED.external_ids,
      data_provider_synced_at = EXCLUDED.data_provider_synced_at,
      updated_at = now()
    RETURNING id
  `;
  return rows[0].id;
}

async function upsertTeam(leagueId, apiTeam) {
  const slug = slugify(apiTeam.name);
  const externalIds = JSON.stringify({ api_sports: String(apiTeam.id) });
  const rows = await sql`
    INSERT INTO teams (
      league_id, slug, name, short_name, abbreviation,
      external_ids, data_provider_synced_at
    )
    VALUES (
      ${leagueId}, ${slug}, ${apiTeam.name}, ${apiTeam.name}, NULL,
      ${externalIds}::jsonb, now()
    )
    ON CONFLICT (league_id, slug) DO UPDATE SET
      name = EXCLUDED.name,
      short_name = EXCLUDED.short_name,
      external_ids = EXCLUDED.external_ids,
      data_provider_synced_at = EXCLUDED.data_provider_synced_at,
      updated_at = now()
    RETURNING id
  `;
  return rows[0].id;
}

// Best-effort sync_log write. Never throws — if logging fails it's
// console.error'd and the original sync error (or success) is what the
// caller sees.
async function writeSyncLog({ fixtureId, status, minute, homeScore, awayScore, eventsCount, error }) {
  try {
    const raw = error
      ? null
      : JSON.stringify({
          status: status ?? null,
          minute: minute ?? null,
          goals: { home: homeScore ?? null, away: awayScore ?? null },
          events_count: eventsCount ?? null,
        });
    const errMsg = error
      ? String(error?.message ?? error).slice(0, 4000)
      : null;
    await sql`
      INSERT INTO sync_log (
        fixture_id, status, minute, home_score, away_score, raw, error
      )
      VALUES (
        ${fixtureId},
        ${status ?? null},
        ${minute ?? null},
        ${homeScore ?? null},
        ${awayScore ?? null},
        ${raw}::jsonb,
        ${errMsg}
      )
    `;
  } catch (logErr) {
    console.error('writeSyncLog failed:', logErr);
  }
}

// Core sync. Mutates `capture` as it parses fields so the outer
// try/catch in syncFixture() can log whatever was known at crash time.
async function doSync(fixtureApiId, capture) {
  const [fixtures, events] = await Promise.all([
    apiSports.fixture(fixtureApiId),
    apiSports.events(fixtureApiId).catch(() => null),
  ]);
  const f = fixtures[0];
  if (!f) throw new Error(`API-Sports returned no fixture for id ${fixtureApiId}`);

  // Parse derived fields first so capture is populated even if the
  // subsequent DB upserts fail.
  const status = mapStatus(f.fixture.status.short);
  const minute = f.fixture.status.elapsed ?? null;
  const homeScore = f.goals.home ?? null;
  const awayScore = f.goals.away ?? null;
  const eventsCount = events?.length ?? null;

  capture.status = status;
  capture.minute = minute;
  capture.homeScore = homeScore;
  capture.awayScore = awayScore;
  capture.eventsCount = eventsCount;

  const leagueId = await upsertFriendliesLeague();
  const homeTeamId = await upsertTeam(leagueId, f.teams.home);
  const awayTeamId = await upsertTeam(leagueId, f.teams.away);

  const homeSlug = slugify(f.teams.home.name);
  const awaySlug = slugify(f.teams.away.name);
  const datePart = ymd(f.fixture.date);
  const matchSlug = `${homeSlug}-vs-${awaySlug}-${datePart}`;
  const venue = f.fixture.venue?.name ?? null;
  const externalIds = JSON.stringify({ api_sports: String(f.fixture.id) });

  const rows = await sql`
    INSERT INTO matches (
      league_id, slug, home_team_id, away_team_id,
      kickoff_at, status, home_score, away_score,
      stage, group_code, venue, external_ids, data_provider_synced_at
    )
    VALUES (
      ${leagueId}, ${matchSlug}, ${homeTeamId}, ${awayTeamId},
      ${f.fixture.date}, ${status}, ${homeScore}, ${awayScore},
      NULL, NULL, ${venue}, ${externalIds}::jsonb, now()
    )
    ON CONFLICT (slug) DO UPDATE SET
      kickoff_at = EXCLUDED.kickoff_at,
      status = EXCLUDED.status,
      home_score = EXCLUDED.home_score,
      away_score = EXCLUDED.away_score,
      venue = EXCLUDED.venue,
      external_ids = EXCLUDED.external_ids,
      data_provider_synced_at = EXCLUDED.data_provider_synced_at,
      updated_at = now()
    RETURNING id, slug, status, home_score, away_score, kickoff_at
  `;
  const row = rows[0];

  // Persist events (already fetched above; if events is null the atom
  // skips). Best-effort: an events write failure does NOT abort
  // fixture sync — log + continue. Mirrors the events FETCH's existing
  // .catch(() => null) tolerance.
  if (Array.isArray(events) && events.length > 0) {
    try {
      await syncMatchEvents(row.id, events, {
        homeTeamApiId: f.teams.home?.id,
        awayTeamApiId: f.teams.away?.id,
        fixtureApiId,
      });
    } catch (eventsErr) {
      console.error('syncMatchEvents failed (fixture sync continues):', eventsErr);
    }
  }

  return {
    match_id: row.id,
    slug: row.slug,
    status: row.status,
    home_score: row.home_score,
    away_score: row.away_score,
    kickoff_at: row.kickoff_at,
    minute,
    events_count: eventsCount,
    home_team: { id: homeTeamId, name: f.teams.home.name, slug: homeSlug },
    away_team: { id: awayTeamId, name: f.teams.away.name, slug: awaySlug },
    venue,
    league_id: leagueId,
  };
}

export async function syncFixture(fixtureApiId) {
  const capture = {};
  try {
    const result = await doSync(fixtureApiId, capture);
    await writeSyncLog({
      fixtureId: fixtureApiId,
      status: capture.status,
      minute: capture.minute,
      homeScore: capture.homeScore,
      awayScore: capture.awayScore,
      eventsCount: capture.eventsCount,
    });
    return result;
  } catch (err) {
    await writeSyncLog({
      fixtureId: fixtureApiId,
      status: capture.status,
      minute: capture.minute,
      homeScore: capture.homeScore,
      awayScore: capture.awayScore,
      eventsCount: capture.eventsCount,
      error: err,
    });
    throw err;
  }
}
