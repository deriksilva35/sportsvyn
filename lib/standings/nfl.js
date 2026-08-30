// lib/standings/nfl.js — BDL /nfl/v1/standings -> team_records.
//
// THE ENDPOINT LIES ABOUT ITSELF, AND THE CALENDAR IS THE ONLY HONEST GATE.
// balldontlie's docs say /nfl/v1/standings "retrieves regular season team
// standings". Asked for season=2026 on 30 Aug 2026 — eleven days before Week 1
// — it returned 32 rows with 3-4 games played each, 49 games league-wide, and
// playoff_seed populated on a 1-2 team. That is the PRESEASON. Storing it
// unlabelled would print a preseason mark on a team page as "the record".
//
// So season_type is decided HERE, from when the regular season actually
// starts, and never from the payload or the documentation. And the start date
// is READ FROM OUR OWN SCHEDULE rather than hardcoded: matches already holds
// every REG fixture with a real kickoff, so the gate moves with the schedule
// instead of rotting in a constant.

import { sql } from '../db.js';
import { upsertRecords } from './cfb.js';

const BASE = 'https://api.balldontlie.io';

/** "1-2" / "10-6-1" -> [w, l, t]. A blank or malformed value is all-null. */
export function parseRecord(str) {
  const m = /^(\d+)-(\d+)(?:-(\d+))?$/.exec(String(str ?? '').trim());
  return m ? [Number(m[1]), Number(m[2]), m[3] == null ? 0 : Number(m[3])] : [null, null, null];
}

/**
 * The regular season's first kickoff, from our own matches table.
 *
 * NULL means we hold no REG schedule for that season yet, and the caller must
 * treat the answer as unknown rather than guessing 'regular'.
 */
export async function regularSeasonStart(leagueId, season) {
  const [r] = await sql`
    SELECT min(kickoff_at) AS at FROM matches
     WHERE league_id = ${leagueId} AND season_year = ${season} AND season_phase = 'REG'`;
  return r?.at ?? null;
}

/**
 * Which season_type a standings snapshot describes.
 *
 * BEFORE the first regular-season kickoff, whatever the endpoint returns is
 * preseason by construction — there is no other football to have played.
 */
export function seasonTypeFor(now, regStart) {
  if (regStart == null) return null;
  return new Date(now).getTime() < new Date(regStart).getTime() ? 'preseason' : 'regular';
}

/** One BDL standings row -> our record row. PURE. */
export function toRecordRow(s, { teamId, leagueId, season, seasonType, unmapped } = {}) {
  const [cw, cl, ct] = parseRecord(s.conference_record);
  const [dw, dl, dt] = parseRecord(s.division_record);
  const [hw, hl, ht] = parseRecord(s.home_record);
  const [aw, al, at] = parseRecord(s.road_record);
  const known = new Set(['team', 'win_streak', 'points_for', 'points_against', 'playoff_seed',
    'point_differential', 'overall_record', 'conference_record', 'division_record',
    'wins', 'losses', 'ties', 'home_record', 'road_record', 'season']);
  for (const k of Object.keys(s)) if (!known.has(k)) unmapped?.push(k);
  return {
    league_id: leagueId, team_id: teamId, season, season_type: seasonType,
    wins: s.wins ?? 0, losses: s.losses ?? 0, ties: s.ties ?? 0,
    conf_wins: cw, conf_losses: cl, conf_ties: ct,
    div_wins: dw, div_losses: dl, div_ties: dt,
    home_wins: hw, home_losses: hl, home_ties: ht,
    away_wins: aw, away_losses: al, away_ties: at,
    // NFL plays no neutral-site regular-season games we track as such; the
    // provider sends none, so these stay NULL rather than 0.
    neutral_wins: null, neutral_losses: null, neutral_ties: null,
    points_for: s.points_for ?? null,
    points_against: s.points_against ?? null,
    // SIGNED, AS SENT. -1 is one loss, 3 is three straight wins. Taking an
    // absolute value here would discard the direction.
    streak: s.win_streak ?? null,
    playoff_seed: s.playoff_seed ?? null,
    conference: s.team?.conference ?? null,
    division: s.team?.division ?? null,
    classification: null,
    data_provider: 'bdl',
  };
}

async function teamMap(leagueId) {
  const rows = await sql`
    SELECT id, abbreviation, external_ids->>'bdl_team_id' AS pid FROM teams
     WHERE league_id = ${leagueId}`;
  const byId = new Map(), byAbbr = new Map();
  for (const r of rows) {
    if (r.pid) byId.set(r.pid, r.id);
    if (r.abbreviation) byAbbr.set(r.abbreviation.toUpperCase(), r.id);
  }
  return { byId, byAbbr };
}

export function bdlStandingsFetcher({ base = BASE } = {}) {
  return async (season) => {
    const key = process.env.BDL_API_KEY;
    if (!key) throw new Error('BDL_API_KEY missing in env');
    const res = await fetch(`${base}/nfl/v1/standings?season=${season}`, {
      headers: { Authorization: key },
    });
    if (!res.ok) throw new Error(`BDL ${res.status} on /nfl/v1/standings?season=${season}`);
    return (await res.json()).data ?? [];
  };
}

export async function syncNflStandings(leagueId, season, {
  fetchStandings, now = new Date(), dryRun = false,
} = {}) {
  const summary = {
    provider: 'bdl', season, requests: 1, rows: 0, matched: 0,
    noTeam: 0, written: 0, seasonType: null, regularSeasonStart: null,
    unmapped: [], dryRun,
  };
  const regStart = await regularSeasonStart(leagueId, season);
  summary.regularSeasonStart = regStart ? new Date(regStart).toISOString() : null;
  const seasonType = seasonTypeFor(now, regStart);
  summary.seasonType = seasonType;
  // NO SCHEDULE, NO LABEL, NO WRITE. Guessing 'regular' here is exactly the
  // mistake the whole gate exists to prevent.
  if (seasonType == null) { summary.reason = 'no-regular-schedule-held'; return summary; }

  const raw = await (fetchStandings ?? bdlStandingsFetcher())(season);
  summary.rows = raw.length;
  const { byId, byAbbr } = await teamMap(leagueId);

  const batch = [];
  for (const s of raw) {
    const teamId = byId.get(String(s.team?.id))
      ?? byAbbr.get(String(s.team?.abbreviation ?? '').toUpperCase());
    if (teamId == null) { summary.noTeam += 1; continue; }
    summary.matched += 1;
    batch.push(toRecordRow(s, { teamId, leagueId, season, seasonType, unmapped: summary.unmapped }));
  }
  summary.unmapped = [...new Set(summary.unmapped)];
  if (!dryRun) summary.written = await upsertRecords(batch);
  return summary;
}
