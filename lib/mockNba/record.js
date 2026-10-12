// lib/mockNba/record.js - what the NBA mock keeps on the server (sun-7).
//
// 1. EVERY FINISHED MOCK, ANONYMOUSLY (nba_mock_drafts): the setup and the pick
//    order - no user id, no IP, nothing that names the reader. ~300 of these are
//    the raw material for a real "SV ADP" (docs/reports/2026-10-11-mock-nba-2.md).
// 2. A SIGNED-IN READER'S SETUP (nba_mock_settings): the next mock opens with it.
//    A guest's setup stays in their browser (localStorage), never here.

import { sql as defaultSql } from '../db.js';
import { TEAMS_MIN, TEAMS_MAX } from './settings.js';
import { SCORING_PRESETS } from './scoring.js';
import { ROSTER_PRESETS } from './roster.js';
import { SCORING_PRESETS as NFL_SCORING } from '../mockNfl/scoring.js';
import { ROSTER_PRESETS as NFL_ROSTERS } from '../mockNfl/roster.js';
import { SPORTS } from './setupChoice.js';

// PER SPORT (mon-3): the NFL mock records and saves through the same doors, with
// its own scoring and roster keys; the tables carry a sport column (migration 140).
const KEYS = {
  nba: { scoring: new Set([...Object.keys(SCORING_PRESETS), 'custom']), roster: new Set([...Object.keys(ROSTER_PRESETS), 'custom']) },
  nfl: { scoring: new Set([...Object.keys(NFL_SCORING), 'custom']), roster: new Set([...Object.keys(NFL_ROSTERS), 'custom']) },
};
const sportOf = (s) => (s in KEYS ? s : 'nba');
const GRADE_RX = /^(A\+|A-|A|B\+|B-|B|C\+|C|D)$/;

/** A finished mock from the browser -> a clean row, or null (refused). PURE. */
export function cleanMockRecord(raw) {
  const r = raw && typeof raw === 'object' ? raw : {};
  if (r.sport != null && !(r.sport in KEYS)) return null;
  const sport = sportOf(r.sport);
  const teams = Number(r.teams); const rounds = Number(r.rounds); const seat = Number(r.userSeat);
  if (!Number.isInteger(teams) || teams < TEAMS_MIN || teams > TEAMS_MAX) return null;
  if (!Number.isInteger(rounds) || rounds < 1 || rounds > 36) return null;
  if (!Number.isInteger(seat) || seat < 1 || seat > teams) return null;
  if (!KEYS[sport].scoring.has(r.scoring) || !KEYS[sport].roster.has(r.roster)) return null;
  const picks = Array.isArray(r.picks) ? r.picks.map(Number) : [];
  if (picks.length !== teams * rounds || picks.some((x) => !Number.isInteger(x) || x <= 0)) return null;
  if (new Set(picks).size !== picks.length) return null;
  const grade = GRADE_RX.test(r.grade ?? '') ? r.grade : null;
  return { sport, teams, rounds, scoring: r.scoring, roster: r.roster, userSeat: seat, grade, picks };
}

export async function recordMock(row, { sql = defaultSql } = {}) {
  const [r] = await sql`
    INSERT INTO nba_mock_drafts (sport, teams, rounds, scoring, roster, user_seat, grade, picks)
    VALUES (${row.sport ?? 'nba'}, ${row.teams}, ${row.rounds}, ${row.scoring}, ${row.roster}, ${row.userSeat}, ${row.grade}, ${row.picks})
    RETURNING id`;
  return Number(r.id);
}

// NBA and NFL setups live in their own tables (nba_mock_settings, nfl_mock_settings
// - migration 141): one row per account in each.
export async function saveMockSettings(userId, settings, { sql = defaultSql, sport = 'nba' } = {}) {
  const sp = sportOf(sport);
  const s = JSON.stringify(SPORTS[sp].normalize(settings));
  if (sp === 'nfl') {
    await sql`
      INSERT INTO nfl_mock_settings (user_id, settings, updated_at) VALUES (${userId}, ${s}::jsonb, now())
      ON CONFLICT (user_id) DO UPDATE SET settings = EXCLUDED.settings, updated_at = now()`;
  } else {
    await sql`
      INSERT INTO nba_mock_settings (user_id, settings, updated_at) VALUES (${userId}, ${s}::jsonb, now())
      ON CONFLICT (user_id) DO UPDATE SET settings = EXCLUDED.settings, updated_at = now()`;
  }
  return JSON.parse(s);
}

/** The reader's saved setup (normalised), or null. */
export async function readMockSettings(userId, { sql = defaultSql, sport = 'nba' } = {}) {
  const sp = sportOf(sport);
  const [r] = sp === 'nfl'
    ? await sql`SELECT settings FROM nfl_mock_settings WHERE user_id = ${userId}`
    : await sql`SELECT settings FROM nba_mock_settings WHERE user_id = ${userId}`;
  return r ? SPORTS[sp].normalize(r.settings) : null;
}

export async function clearMockSettings(userId, { sql = defaultSql, sport = 'nba' } = {}) {
  if (sportOf(sport) === 'nfl') await sql`DELETE FROM nfl_mock_settings WHERE user_id = ${userId}`;
  else await sql`DELETE FROM nba_mock_settings WHERE user_id = ${userId}`;
}
