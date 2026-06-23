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
import { syncMatchStatistics } from './statistics.js';
import { resolveTeamFlagAssets } from './teamFlags.js';

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

  // Resolve abbreviation + flag_svg_path BEFORE the upsert. The /fixtures
  // payload only carries {id, name, logo, winner} — no team.code — so
  // when syncFixture runs (live-poll or import-fixture path) we cross-
  // look-up against any prior teams row sharing this api_sports id (the
  // WC import populates these via /teams, which DOES carry team.code).
  // Canonicalization in resolveTeamFlagAssets fixes the Iran/Iraq IRA
  // collision so they resolve to distinct flags. Same helper backfill-
  // flags.mjs uses — single source of truth for collision policy.
  const { abbreviation, flag_svg_path } = await resolveTeamFlagAssets(
    apiTeam.id,
    { ownAbbreviation: apiTeam.code ?? null },
  );

  const rows = await sql`
    INSERT INTO teams (
      league_id, slug, name, short_name, abbreviation, flag_svg_path,
      external_ids, data_provider_synced_at
    )
    VALUES (
      ${leagueId}, ${slug}, ${apiTeam.name}, ${apiTeam.name},
      ${abbreviation}, ${flag_svg_path},
      ${externalIds}::jsonb, now()
    )
    ON CONFLICT (league_id, slug) DO UPDATE SET
      name = EXCLUDED.name,
      short_name = EXCLUDED.short_name,
      -- Fill-if-NULL only. Self-heals rows the old upsertTeam wrote at
      -- NULL on their next sync, but cannot clobber a hand-fixed
      -- abbreviation or a manual flag override. Legacy bad-data fixes
      -- (e.g. existing Iran/Iraq rows storing 'IRA') are the backfill
      -- script's job, not this UPSERT's.
      abbreviation  = COALESCE(teams.abbreviation,  EXCLUDED.abbreviation),
      flag_svg_path = COALESCE(teams.flag_svg_path, EXCLUDED.flag_svg_path),
      external_ids  = EXCLUDED.external_ids,
      data_provider_synced_at = EXCLUDED.data_provider_synced_at,
      updated_at    = now()
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
  // Stats throttle (poll-cost reduction, NOT a freshness concession on
  // the live feed). If match_statistics was fetched for this match within
  // the last 5 minutes, skip the per-tick apiSports.statistics call this
  // tick. Aggregate totals (possession, shots on/off, corners) don't
  // change minute-to-minute; 5-min freshness is editorially indistinguish-
  // able from every-minute.
  //
  // Fixture + events STAY every tick — freshness-critical for score,
  // status, and the Key Moments timeline. This throttle only affects the
  // 3rd of the three concurrent calls (the stats one), cutting the
  // per-live-match cost from 3 calls/min to 2 calls/min for 4 of every
  // 5 ticks (~33% reduction on live matches).
  //
  // One extra SELECT per tick to check freshness. The query is indexed
  // (match_id is FK) and folds the matches lookup + match_statistics
  // freshness check into a single round-trip with EXISTS.
  const freshness = await sql`
    SELECT m.id
      FROM matches m
     WHERE m.external_ids->>'api_sports' = ${String(fixtureApiId)}
       AND EXISTS (
         SELECT 1 FROM match_statistics ms
          WHERE ms.match_id = m.id
            AND ms.is_current = true
            AND ms.fetched_at > now() - interval '5 minutes'
       )
     LIMIT 1
  `;
  const skipStatsThisTick = freshness.length > 0;

  const [fixtures, events, statistics] = await Promise.all([
    apiSports.fixture(fixtureApiId),
    apiSports.events(fixtureApiId).catch(() => null),
    skipStatsThisTick
      ? Promise.resolve(null)
      : apiSports.statistics(fixtureApiId).catch(() => null),
  ]);
  const f = fixtures[0];
  if (!f) throw new Error(`API-Sports returned no fixture for id ${fixtureApiId}`);

  // Parse derived fields first so capture is populated even if the
  // subsequent DB upserts fail.
  const statusShort = f.fixture.status.short ?? null;
  const status = mapStatus(statusShort);
  const minute = f.fixture.status.elapsed ?? null;
  const homeScore = f.goals.home ?? null;
  const awayScore = f.goals.away ?? null;
  const eventsCount = events?.length ?? null;

  capture.status = status;
  capture.statusShort = statusShort;
  capture.minute = minute;
  capture.homeScore = homeScore;
  capture.awayScore = awayScore;
  capture.eventsCount = eventsCount;

  // Resolve the fixture's actual league. If a matches row already exists for
  // this api_sports fixture id, reuse its league_id so the live poller
  // updates in place. Otherwise fall back to friendlies (the historical
  // default for the import-fixture path). Without this, every poll of a
  // WC / Gold Cup / other-competition fixture forked a parallel friendlies
  // row (root cause of the Czech v South Africa m_id=12674 shadow).
  const existingLeague = await sql`
    SELECT m.league_id
      FROM matches m
     WHERE m.external_ids->>'api_sports' = ${String(fixtureApiId)}
     LIMIT 1
  `;
  const leagueId = existingLeague.length > 0
    ? existingLeague[0].league_id
    : await upsertFriendliesLeague();
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

  // Persist statistics — same best-effort discipline as events. Pre-kickoff
  // the array is empty (the atom returns hadData:false and skips). Mid-match
  // each side carries ~18 stat entries; the atom flips prior is_current rows
  // to false and inserts a fresh snapshot per side.
  if (Array.isArray(statistics) && statistics.length >= 2) {
    try {
      await syncMatchStatistics(row.id, statistics, {
        homeTeamApiId: f.teams.home?.id,
        awayTeamApiId: f.teams.away?.id,
        fixtureApiId,
      });
    } catch (statsErr) {
      console.error('syncMatchStatistics failed (fixture sync continues):', statsErr);
    }
  }

  return {
    match_id: row.id,
    slug: row.slug,
    status: row.status,
    status_short: statusShort,
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
