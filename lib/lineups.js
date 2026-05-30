// lib/lineups.js — match_lineups sync atom for the poll-lineups cron.
//
// API-Sports /fixtures/lineups?fixture=X returns an array of (typically)
// two sides — home at [0], away at [1] — each with team/coach/formation/
// startXI/substitutes. The data appears ~60 min before kickoff (sometimes
// later for lower-coverage friendlies) and is empty otherwise.
//
// syncMatchLineups(matchDbId, fixtureApiId):
//   - Calls apiSports.lineups(fixtureApiId)
//   - Returns { written: 0, hadData: false } when the API hasn't published
//     yet (canonical "not ready" state — NOT an error)
//   - On data: flips prior is_current=true rows to false for both sides
//     and INSERTs two new is_current=true rows (one per side), in one CTE
//     per side. Idempotent — re-running just writes fresh snapshots.
//
// Players are flattened into a single jsonb array per side, with a `role`
// field ('starting' or 'bench') so the page renderer can filter without
// needing two columns. Position + grid (API-Sports's formation-position
// hint) are passed through for a future visual diagram.

import { sql } from './db.js';
import { apiSports } from './apiSports.js';

function normalizePlayer(p, role) {
  if (!p?.player) return null;
  const out = { role };
  if (p.player.number != null) out.number = p.player.number;
  if (p.player.name) out.name = p.player.name;
  if (p.player.pos) out.pos = p.player.pos;
  if (p.player.grid) out.grid = p.player.grid;
  return out.name ? out : null;
}

function normalizeSide(rawSide, teamSide) {
  if (!rawSide) return null;
  const formation = rawSide.formation ?? null;
  const starting = (rawSide.startXI ?? [])
    .map((p) => normalizePlayer(p, 'starting'))
    .filter(Boolean);
  const bench = (rawSide.substitutes ?? [])
    .map((p) => normalizePlayer(p, 'bench'))
    .filter(Boolean);
  if (starting.length === 0) return null;
  return { team_side: teamSide, formation, players: [...starting, ...bench] };
}

export async function syncMatchLineups(matchDbId, fixtureApiId) {
  const raw = await apiSports.lineups(fixtureApiId).catch(() => []);
  if (!Array.isArray(raw) || raw.length < 2) {
    return { written: 0, hadData: false };
  }

  // API-Sports convention: raw[0] = home, raw[1] = away (matches the
  // fixture.teams.home/away order). We trust that convention rather than
  // round-tripping team identity through our DB.
  const home = normalizeSide(raw[0], 'home');
  const away = normalizeSide(raw[1], 'away');
  if (!home || !away) {
    return { written: 0, hadData: false };
  }

  let written = 0;
  for (const side of [home, away]) {
    await sql`
      WITH update_old AS (
        UPDATE match_lineups SET is_current = false
        WHERE match_id = ${matchDbId}
          AND team_side = ${side.team_side}
          AND is_current = true
        RETURNING 1
      )
      INSERT INTO match_lineups (
        match_id, team_side, formation, players, is_current, fetched_at
      ) VALUES (
        ${matchDbId}, ${side.team_side}, ${side.formation},
        ${JSON.stringify(side.players)}::jsonb, true, now()
      )
    `;
    written++;
  }
  return { written, hadData: true };
}
