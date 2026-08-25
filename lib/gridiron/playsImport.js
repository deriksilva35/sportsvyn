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

const BDL_BASE = 'https://api.balldontlie.io';
const CFBD_BASE = 'https://apinext.collegefootballdata.com';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function cfbdGet(pathAndQuery) {
  const key = process.env.CFBD_API_KEY;
  if (!key) throw new Error('CFBD_API_KEY missing in env');
  const res = await fetch(`${CFBD_BASE}${pathAndQuery}`, { headers: { Authorization: `Bearer ${key}` } });
  if (!res.ok) throw new Error(`CFBD ${res.status} on ${pathAndQuery}: ${(await res.text()).slice(0, 200)}`);
  return res.json();
}
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

/** provider team id -> our teams.id, for one league. */
async function teamMapFor(leagueId, providerKey) {
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
        offense_team_id, play_type, text, home_score, away_score, scoring
      ) VALUES (
        ${matchId}, ${p.providerPlayId}, ${p.driveId}, ${p.driveNumber}, ${p.playNumber},
        ${p.period}, ${p.clock}, ${p.down}, ${p.distance}, ${p.yardsToGoal}, ${p.yardsGained},
        ${p.offenseTeamId}, ${p.playType}, ${p.text}, ${p.homeScore}, ${p.awayScore}, ${p.scoring}
      )
      ON CONFLICT (match_id, provider_play_id) DO UPDATE SET
        drive_id = EXCLUDED.drive_id, drive_number = EXCLUDED.drive_number,
        play_number = EXCLUDED.play_number, period = EXCLUDED.period,
        clock = EXCLUDED.clock, down = EXCLUDED.down, distance = EXCLUDED.distance,
        yards_to_goal = EXCLUDED.yards_to_goal, yards_gained = EXCLUDED.yards_gained,
        offense_team_id = EXCLUDED.offense_team_id, play_type = EXCLUDED.play_type,
        text = EXCLUDED.text, home_score = EXCLUDED.home_score,
        away_score = EXCLUDED.away_score, scoring = EXCLUDED.scoring,
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
export async function importCfbPlays(matchId, runSummary = makeRunSummary()) {
  const m = await matchContext(matchId);
  const gameId = m.external_ids?.cfbd_game_id;
  if (!gameId) throw new Error(`match ${matchId} has no cfbd_game_id`);
  const live = await cfbdGet(`/live/plays?gameId=${gameId}`);
  const tmap = await teamMapFor(m.league_id, 'cfbd_team_id');
  const plays = normalizeCfbdLive(live, tmap, runSummary);
  const drives = cfbdDriveSummaries(live, tmap, runSummary);
  const written = await writePlays(matchId, plays);
  await writeDriveEnvelopes(matchId, drives);
  return { matchId, slug: m.slug, code: 'cfb', providerStatus: live?.status ?? null,
    plays: plays.length, written, drives: drives.length, runSummary };
}

/** NFL: cursor-paginated flat list, drives reconstructed. */
export async function importNflPlays(matchId, runSummary = makeRunSummary()) {
  const m = await matchContext(matchId);
  const gameId = m.external_ids?.bdl_game_id;
  if (!gameId) throw new Error(`match ${matchId} has no bdl_game_id`);
  const rows = [];
  let cursor = null, pages = 0;
  do {
    const j = await bdlGet(`/nfl/v1/plays?game_id=${gameId}&per_page=100${cursor ? `&cursor=${cursor}` : ''}`);
    rows.push(...(j.data ?? []));
    cursor = j.meta?.next_cursor ?? null;
    pages++;
  } while (cursor && pages < 20);

  const tmap = await teamMapFor(m.league_id, 'bdl_team_id');
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
  const written = await writePlays(matchId, plays);
  await writeDriveEnvelopes(matchId, drives);
  return { matchId, slug: m.slug, code: 'nfl', providerStatus: null,
    plays: plays.length, written, drives: drives.length, pages, runSummary };
}

/** Dispatch on the match's own league - no caller needs to know the code. */
export async function importPlaysFor(matchId, runSummary = makeRunSummary()) {
  const m = await matchContext(matchId);
  if (m.league === 'cfb') return importCfbPlays(matchId, runSummary);
  if (m.league === 'nfl') return importNflPlays(matchId, runSummary);
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
