// lib/gridiron/playsReimport.js - the diff and the batched write behind
// scripts/nfl-plays-reimport.mjs. Kept out of the script so the test can drive
// both against DEV without a network fetch.

/** The row the dry run prints before/after for (relay fri-4: winprob_log 11198). */
export const SHOWCASE = Object.freeze({
  'nfl-2026-reg-w3-phi-chi': { providerPlayId: '4018729631513', label: 'PHI@CHI goal-line interception (winprob_log 11198)' },
});

const n = (v) => (v == null ? null : Number(v));
const canon = (v) => JSON.stringify(v, (k, x) => (x && typeof x === 'object' && !Array.isArray(x)
  ? Object.fromEntries(Object.keys(x).sort().map((key) => [key, x[key]])) : x));

/**
 * PURE. What a re-derivation would change for one game.
 *   stored      plays rows as held (provider_play_id, drive_*, offense_team_id, play_type, end_*)
 *   plays       the normaliser's rows for the same game (normalizeBdlPlays shape)
 *   storedDrives / drives   the envelope arrays, held and new
 * Returns counts plus `changed` (the normalised rows whose stored copy differs)
 * and `missing` (normalised rows with no stored copy).
 */
export function diffGame(stored, plays, storedDrives, drives) {
  const held = new Map((stored ?? []).map((r) => [String(r.provider_play_id), r]));
  const offenseByType = {};
  let driveMoved = 0, endFilled = 0;
  const changed = []; const missing = [];
  for (const p of plays ?? []) {
    const s = held.get(String(p.providerPlayId));
    if (!s) { missing.push(p); continue; }
    const off = n(s.offense_team_id) !== n(p.offenseTeamId);
    const drv = (s.drive_id ?? null) !== (p.driveId ?? null) || n(s.drive_number) !== n(p.driveNumber) || n(s.play_number) !== n(p.playNumber);
    const end = n(s.end_down) !== n(p.endDown) || n(s.end_distance) !== n(p.endDistance) || n(s.end_yards_to_goal) !== n(p.endYardsToGoal);
    if (off) offenseByType[p.playType ?? '(none)'] = (offenseByType[p.playType ?? '(none)'] ?? 0) + 1;
    if (drv) driveMoved++;
    if (end) endFilled++;
    if (off || drv || end) changed.push(p);
  }
  // jsonb hands keys back in its own order, so envelopes are compared with keys sorted.
  const envelopesChanged = canon(storedDrives ?? null) !== canon(drives ?? null);
  return { offenseByType, driveMoved, endFilled, changed, missing, envelopesChanged };
}

/**
 * ONE STATEMENT PER BATCH, not one per row: the changed rows of a game go up
 * as parallel arrays and are joined back on (match_id, provider_play_id).
 * Only the derived columns are written - text, scores, down and spot are the
 * feed's and are left to the importer. Plain columns, no jsonb.
 */
export async function applyGame(sql, matchId, plays, diff, { batch = 500 } = {}) {
  const rows = diff?.changed ?? [];
  let updated = 0;
  for (let i = 0; i < rows.length; i += batch) {
    const b = rows.slice(i, i + batch);
    const res = await sql`
      UPDATE plays p
         SET drive_id = u.drive_id, drive_number = u.drive_number, play_number = u.play_number,
             offense_team_id = u.offense_team_id,
             end_down = u.end_down, end_distance = u.end_distance, end_yards_to_goal = u.end_yards_to_goal,
             updated_at = now()
        FROM unnest(${b.map((p) => String(p.providerPlayId))}::text[],
                    ${b.map((p) => p.driveId ?? null)}::text[],
                    ${b.map((p) => n(p.driveNumber))}::int[],
                    ${b.map((p) => n(p.playNumber))}::int[],
                    ${b.map((p) => n(p.offenseTeamId))}::int[],
                    ${b.map((p) => n(p.endDown))}::int[],
                    ${b.map((p) => n(p.endDistance))}::int[],
                    ${b.map((p) => n(p.endYardsToGoal))}::int[])
             AS u(provider_play_id, drive_id, drive_number, play_number, offense_team_id, end_down, end_distance, end_yards_to_goal)
       WHERE p.match_id = ${matchId} AND p.provider_play_id = u.provider_play_id
      RETURNING p.id`;
    updated += res.length;
  }
  return { updated };
}
