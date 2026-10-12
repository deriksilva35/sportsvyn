// lib/mockNba/setups.js - a signed-in reader's NAMED NBA mock setups (mon-2).
//
// "Save as..." stores the whole setup (lib/mockNba/settings.js - teams, draft
// slot, scoring incl. custom values, roster incl. custom counts, clock; rounds
// follow the roster) under a chosen name. Rename, overwrite and delete; at most
// MAX_SETUPS per account; names unique per account ignoring case. Every write is
// scoped to the owner's user id, so another reader's id is simply not found.

import { sql as defaultSql } from '../db.js';
import { normalizeSettings } from './settings.js';
import { MAX_SETUPS, cleanName } from './setupChoice.js';

export { MAX_SETUPS, NAME_MAX, cleanName, REASON_COPY } from './setupChoice.js';

const shape = (r) => ({ id: Number(r.id), name: r.name, settings: normalizeSettings(r.settings), updatedAt: new Date(r.updated_at).toISOString() });
const taken = (e) => /nba_mock_setups_user_name_idx|duplicate key/i.test(String(e?.message ?? e));

/** The reader's setups, most recently saved first. */
export async function listSetups(userId, { sql = defaultSql } = {}) {
  const rows = await sql`SELECT id, name, settings, updated_at FROM nba_mock_setups WHERE user_id = ${userId} ORDER BY updated_at DESC, id DESC`;
  return rows.map(shape);
}

/** Save a NEW named setup. -> { ok, setup } | { ok: false, reason: 'bad_name' | 'limit' | 'name_taken' }. */
export async function createSetup(userId, name, settings, { sql = defaultSql } = {}) {
  const n = cleanName(name);
  if (!n) return { ok: false, reason: 'bad_name' };
  const s = normalizeSettings(settings);
  try {
    // The count and the insert are one statement, so two quick saves cannot both pass the limit check.
    const rows = await sql`
      INSERT INTO nba_mock_setups (user_id, name, settings)
      SELECT ${userId}, ${n}, ${JSON.stringify(s)}::jsonb
      WHERE (SELECT count(*) FROM nba_mock_setups WHERE user_id = ${userId}) < ${MAX_SETUPS}
      RETURNING id, name, settings, updated_at`;
    if (!rows.length) return { ok: false, reason: 'limit' };
    return { ok: true, setup: shape(rows[0]) };
  } catch (e) {
    if (taken(e)) return { ok: false, reason: 'name_taken' };
    throw e;
  }
}

/** Overwrite a setup's settings (and optionally its name). -> { ok, setup } | { ok: false, reason }. */
export async function updateSetup(userId, id, { name, settings } = {}, { sql = defaultSql } = {}) {
  const n = name === undefined ? undefined : cleanName(name);
  if (n === null) return { ok: false, reason: 'bad_name' };
  const s = settings === undefined ? null : JSON.stringify(normalizeSettings(settings));
  try {
    const rows = await sql`
      UPDATE nba_mock_setups
         SET name = COALESCE(${n ?? null}, name),
             settings = COALESCE(${s}::jsonb, settings),
             updated_at = now()
       WHERE id = ${id} AND user_id = ${userId}
       RETURNING id, name, settings, updated_at`;
    if (!rows.length) return { ok: false, reason: 'not_found' };
    return { ok: true, setup: shape(rows[0]) };
  } catch (e) {
    if (taken(e)) return { ok: false, reason: 'name_taken' };
    throw e;
  }
}

export async function deleteSetup(userId, id, { sql = defaultSql } = {}) {
  const rows = await sql`DELETE FROM nba_mock_setups WHERE id = ${id} AND user_id = ${userId} RETURNING id`;
  return rows.length ? { ok: true } : { ok: false, reason: 'not_found' };
}
