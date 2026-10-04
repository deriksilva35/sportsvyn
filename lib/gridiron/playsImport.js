// lib/gridiron/playsImport.js - backfill play-by-play for one game, either code.
//
// NO POLLER HERE, DELIBERATELY. This module fetches and writes a single game's
// plays on demand. Cadence - when to call it, how often, and how to stop -
// is the next relay's job and is gated on the Aug 29 CFB window proving
// /live/plays populates mid-game. What this relay settles is that the fetch,
// the normalisation and the write are correct, so that the poller relay is only
// a scheduler.
//
// IDEMPOTENT BY CONSTRUCTION: every write is ON CONFLICT (match_id,
// provider_play_id) DO UPDATE, so re-importing a game corrects rows and never
// duplicates them. That is the property the live path will depend on, since a
// live poller re-reads the whole feed on every tick.

import { sql } from '../db.js';
import { makeRunSummary } from './ingest.js';
import {
  normalizeCfbdLive, cfbdDriveSummaries, normalizeBdlPlays, reconstructDrives,
} from './plays.js';
import { cfbdGet as cfbdGetShared } from '../cfbd/client.js';

const BDL_BASE = 'https://api.balldontlie.io';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * CFBD REFUSES CONCURRENCY, NOT VOLUME: /live/plays answers 429 "Too many
 * concurrent requests for this endpoint" when several calls overlap. On
 * 26 Sep, with CFB_PLAYS_ALL's twenty games imported six at a time, nearly
 * every minute of the slate lost 3-7 games to it - their plays fell behind the
 * score and the gamecast, the card line and the win-prob hold all waited.
 * A 429 is retried twice, after ~1 s and ~2 s (jittered, so three workers do
 * not collide again in step); anything else fails as before.
 */
export const CFBD_429_RETRIES = 2;
// The retry now lives in the shared door (lib/cfbd/client.js), which adds the
// 25 s timeout and the call count; this name stays because the live poller
// and the cfbdRetry test import it.
export async function cfbdGet(pathAndQuery, { wait = sleep, deadlineAt = null } = {}) {
  return cfbdGetShared(pathAndQuery, { retry429: CFBD_429_RETRIES, wait, deadlineAt });
}
// deadlineAt (epoch ms): plays-live's hard stop. Without one this is the old
// call exactly - no timeout, 15 s sleeps on a 429. With one, each request is
// bounded by what is left and a 429 sleep that would cross the line throws.
async function bdlGet(pathAndQuery, { deadlineAt = null } = {}) {
  const key = process.env.BDL_API_KEY;
  if (!key) throw new Error('BDL_API_KEY missing in env');
  for (let attempt = 0; attempt < 4; attempt++) {
    const left = deadlineAt == null ? null : Math.floor(deadlineAt - Date.now());
    if (left != null && left <= 0) throw new Error(`BDL budget exhausted before ${pathAndQuery}`);
    const res = await fetch(`${BDL_BASE}${pathAndQuery}`, {
      headers: { Authorization: key },
      ...(left != null ? { signal: AbortSignal.timeout(Math.min(25_000, left)) } : {}),
    });
    if (res.status === 429) {
      if (left != null && Date.now() + 15000 >= deadlineAt) throw new Error(`BDL 429 on ${pathAndQuery}, no budget left to wait`);
      await sleep(15000); continue;
    }
    if (!res.ok) throw new Error(`BDL ${res.status} on ${pathAndQuery}: ${(await res.text()).slice(0, 200)}`);
    return res.json();
  }
  throw new Error(`BDL rate-limited after retries on ${pathAndQuery}`);
}

/** provider team id -> our teams.id, for one league. */
export async function teamMapFor(leagueId, providerKey) {
  const rows = await sql`
    SELECT id, external_ids->>${providerKey} AS pid FROM teams
     WHERE league_id = ${leagueId} AND external_ids ? ${providerKey}`;
  return new Map(rows.map((r) => [r.pid, r.id]));
}

async function matchContext(matchId) {
  const [m] = await sql`
    SELECT m.id, m.league_id, m.slug, m.status, m.home_team_id, m.away_team_id,
           m.external_ids, l.slug AS league
      FROM matches m JOIN leagues l ON l.id = m.league_id
     WHERE m.id = ${matchId}`;
  if (!m) throw new Error(`match ${matchId} not found`);
  return m;
}

/**
 * Write normalised plays. The UNIQUE index does the idempotence; the UPDATE
 * branch exists because a live re-read legitimately revises a play (a stat
 * correction, a penalty applied after the fact).
 */
export async function writePlays(matchId, rows) {
  let written = 0;
  for (const p of rows) {
    await sql`
      INSERT INTO plays (
        match_id, provider_play_id, drive_id, drive_number, play_number,
        period, clock, down, distance, yards_to_goal, yards_gained,
        offense_team_id, play_type, text, home_score, away_score, scoring,
        end_down, end_distance, end_yards_to_goal
      ) VALUES (
        ${matchId}, ${p.providerPlayId}, ${p.driveId}, ${p.driveNumber}, ${p.playNumber},
        ${p.period}, ${p.clock}, ${p.down}, ${p.distance}, ${p.yardsToGoal}, ${p.yardsGained},
        ${p.offenseTeamId}, ${p.playType}, ${p.text}, ${p.homeScore}, ${p.awayScore}, ${p.scoring},
        ${p.endDown ?? null}, ${p.endDistance ?? null}, ${p.endYardsToGoal ?? null}
      )
      ON CONFLICT (match_id, provider_play_id) DO UPDATE SET
        drive_id = EXCLUDED.drive_id, drive_number = EXCLUDED.drive_number,
        play_number = EXCLUDED.play_number, period = EXCLUDED.period,
        clock = EXCLUDED.clock, down = EXCLUDED.down, distance = EXCLUDED.distance,
        yards_to_goal = EXCLUDED.yards_to_goal, yards_gained = EXCLUDED.yards_gained,
        offense_team_id = EXCLUDED.offense_team_id, play_type = EXCLUDED.play_type,
        text = EXCLUDED.text, home_score = EXCLUDED.home_score,
        away_score = EXCLUDED.away_score, scoring = EXCLUDED.scoring,
        end_down = EXCLUDED.end_down, end_distance = EXCLUDED.end_distance,
        end_yards_to_goal = EXCLUDED.end_yards_to_goal,
        updated_at = now()`;
    written++;
  }
  return written;
}

/**
 * Drive envelopes ride matches.metadata.drives.
 *
 * THE NESTED MERGE IS WRITTEN OUT IN FULL, per the 14 Aug law: `||` is one
 * level deep, so `metadata || '{"drives":...}'` would replace the whole
 * metadata object's siblings if they were nested under the same key, and
 * appending an object onto an ARRAY silently makes it an element. Here the
 * target is a top-level key holding an array, so the safe form is a plain
 * jsonb_build_object on that key alone - the other top-level keys survive
 * because the merge is at the level they live on.
 */
export async function writeDriveEnvelopes(matchId, drives) {
  await sql`
    UPDATE matches
       SET metadata = COALESCE(metadata, '{}'::jsonb)
                      || jsonb_build_object('drives', ${JSON.stringify(drives)}::jsonb),
           updated_at = now()
     WHERE id = ${matchId}`;
  return drives.length;
}

/** CFB: one request, drives already nested. */
export async function importCfbPlays(matchId, runSummary = makeRunSummary(), { deadlineAt = null } = {}) {
  const m = await matchContext(matchId);
  const gameId = m.external_ids?.cfbd_game_id;
  if (!gameId) throw new Error(`match ${matchId} has no cfbd_game_id`);
  const live = await cfbdGet(`/live/plays?gameId=${gameId}`, { deadlineAt });
  const tmap = await teamMapFor(m.league_id, 'cfbd_team_id');
  const plays = normalizeCfbdLive(live, tmap, runSummary);
  const drives = cfbdDriveSummaries(live, tmap, runSummary);
  const written = await writePlays(matchId, plays);
  await writeDriveEnvelopes(matchId, drives);
  return { matchId, slug: m.slug, code: 'cfb', providerStatus: live?.status ?? null,
    plays: plays.length, written, drives: drives.length, runSummary };
}

/**
 * PURE. BDL rows -> the plays and the drive envelopes the importer writes. One
 * function so that the live importer and the 2026 re-import
 * (scripts/nfl-plays-reimport.mjs) cannot derive them two different ways.
 */
export function nflPlaysAndDrives(rows, tmap, runSummary = null) {
  const plays = normalizeBdlPlays(rows, tmap, runSummary);
  const grouped = reconstructDrives(rows, runSummary);
  const drives = grouped.map((d, i) => ({
    driveId: d.driveId, driveNumber: i + 1,
    offenseTeamId: tmap.get(String(d.offenseBdlTeamId)) ?? null,
    offenseName: d.offenseAbbr, playCount: d.playCount, yards: d.yards,
    duration: null,                        // BDL publishes no drive clock
    startPeriod: d.startPeriod, startClock: d.startClock,
    startYardsToGoal: d.startYardsToGoal,
    endPeriod: d.endPeriod, endClock: d.endClock, result: d.result,
  }));
  return { plays, drives };
}

/** BDL /nfl/v1/plays for one game, every page. Returns { rows, pages }. */
export async function fetchBdlPlays(gameId, { deadlineAt = null } = {}) {
  const rows = [];
  let cursor = null, pages = 0;
  do {
    const j = await bdlGet(`/nfl/v1/plays?game_id=${gameId}&per_page=100${cursor ? `&cursor=${cursor}` : ''}`, { deadlineAt });
    rows.push(...(j.data ?? []));
    cursor = j.meta?.next_cursor ?? null;
    pages++;
  } while (cursor && pages < 20);
  return { rows, pages };
}

/** NFL: cursor-paginated flat list, drives reconstructed. */
export async function importNflPlays(matchId, runSummary = makeRunSummary(), { deadlineAt = null } = {}) {
  const m = await matchContext(matchId);
  const gameId = m.external_ids?.bdl_game_id;
  if (!gameId) throw new Error(`match ${matchId} has no bdl_game_id`);
  const { rows, pages } = await fetchBdlPlays(gameId, { deadlineAt });

  const tmap = await teamMapFor(m.league_id, 'bdl_team_id');
  const { plays, drives } = nflPlaysAndDrives(rows, tmap, runSummary);
  const written = await writePlays(matchId, plays);
  await writeDriveEnvelopes(matchId, drives);
  return { matchId, slug: m.slug, code: 'nfl', providerStatus: null,
    plays: plays.length, written, drives: drives.length, pages, runSummary };
}

/** Dispatch on the match's own league - no caller needs to know the code. */
export async function importPlaysFor(matchId, runSummary = makeRunSummary(), { deadlineAt = null } = {}) {
  const m = await matchContext(matchId);
  if (m.league === 'cfb') return importCfbPlays(matchId, runSummary, { deadlineAt });
  if (m.league === 'nfl') return importNflPlays(matchId, runSummary, { deadlineAt });
  throw new Error(`no plays provider for league ${m.league}`);
}

/** Every stored play of a game, in order, shaped as the render model wants. */
export async function playsFor(matchId) {
  const rows = await sql`
    SELECT provider_play_id, drive_id, drive_number, play_number, period, clock,
           down, distance, yards_to_goal, yards_gained, offense_team_id,
           play_type, text, home_score, away_score, scoring
      FROM plays WHERE match_id = ${matchId}
     ORDER BY drive_number NULLS LAST, play_number NULLS LAST, id`;
  return rows.map((r) => ({
    providerPlayId: r.provider_play_id, driveId: r.drive_id,
    driveNumber: r.drive_number, playNumber: r.play_number,
    period: r.period, clock: r.clock, down: r.down, distance: r.distance,
    yardsToGoal: r.yards_to_goal, yardsGained: r.yards_gained,
    offenseTeamId: r.offense_team_id, playType: r.play_type, text: r.text,
    homeScore: r.home_score, awayScore: r.away_score, scoring: r.scoring,
  }));
}

/**
 * Everything the gamecast needs for one match, assembled. `asOf` truncates the
 * play list to simulate a mid-game state - see simulateAsOf() for exactly what
 * that does and does not prove.
 */
export async function gamecastFor(matchId, { asOf = null } = {}) {
  const [m] = await sql`
    SELECT m.id, m.slug, m.status, m.home_team_id, m.away_team_id, m.metadata,
           l.slug AS league
      FROM matches m JOIN leagues l ON l.id = m.league_id WHERE m.id = ${matchId}`;
  if (!m) return null;
  const teams = await sql`
    SELECT id, abbreviation FROM teams WHERE id = ANY(${[m.home_team_id, m.away_team_id]})`;
  return {
    match: m,
    teamAbbr: new Map(teams.map((t) => [t.id, t.abbreviation])),
    drives: Array.isArray(m.metadata?.drives) ? m.metadata.drives : [],
    plays: await playsFor(matchId),
    asOf,
  };
}
