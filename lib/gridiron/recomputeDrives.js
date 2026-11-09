// lib/gridiron/recomputeDrives.js - PURE. What scripts/recompute-nfl-drives.mjs
// changes on one game: the stored NFL drive envelopes (matches.metadata.drives)
// brought level with lib/gridiron/plays.js driveYardsFor, from the game's own stored
// plays - no BDL fetch. (drive-4)
//
// ONLY ONE FIGURE DEPENDS ON THE FIX: an envelope's `yards`, and only when the drive
// ended on a made field goal. playCount, startYardsToGoal, clocks and result do not
// read the kick; plays.drive_id / drive_number / play_number group rows and carry no
// yards; the win-probability inputs read each play's own yards_to_goal / down /
// distance. So nothing else is recomputed.

import { driveYardsFor } from './plays.js';

/**
 * @param envelopes  matches.metadata.drives as held
 * @param plays      the game's stored rows: drive_id, play_type, play_number, yards_to_goal
 * @returns {{ drives: object[], changes: {driveId, old, new}[] }}  drives is a NEW array
 */
export function recomputeEnvelopes(envelopes, plays) {
  const kickOf = new Map();
  for (const p of plays ?? []) {
    if (p.play_type !== 'field-goal-good' || p.drive_id == null) continue;
    const held = kickOf.get(String(p.drive_id));
    if (!held || Number(p.play_number) > Number(held.play_number)) kickOf.set(String(p.drive_id), p);
  }
  const changes = [];
  const drives = (Array.isArray(envelopes) ? envelopes : []).map((e) => {
    const kick = e && kickOf.get(String(e.driveId));
    if (!kick || e.result !== 'Field goal') return e;
    const next = driveYardsFor(e.startYardsToGoal, { type_slug: 'field-goal-good', start_yards_to_endzone: kick.yards_to_goal });
    if (next == null || next === e.yards) return e;
    changes.push({ driveId: e.driveId, old: e.yards ?? null, new: next });
    return { ...e, yards: next };
  });
  return { drives, changes };
}
