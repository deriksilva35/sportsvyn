// lib/house/accounts.js - the five rows in `users` that are the house.
//
// IDEMPOTENT AND SELF-HEALING. Called by the cron on every tick: it creates
// what is missing and repairs what has drifted, so the accounts cannot be
// half-made by a failed run and cannot lose their flag to a manual edit.
//
// MATCHED ON HANDLE, NOT ON A STORED ID. There is no seed file and no id to
// keep in sync between environments - DEV and PROD will hold different
// numbers and both are correct. The handle IS the identity, which is also
// what makes it worth reserving (lib/daily/handles.js RESERVED).
//
// NO EMAIL, NO AUTH PROVIDER, NO DEVICE TOKEN. Measured: `id` is the only
// NOT NULL column on users, nothing outside lib/account.js's deletion path
// joins accounts or sessions, and audienceFor selects from device_tokens - so
// an account with none is simply never in a push audience. A house account
// cannot sign in and is not supposed to be able to.

import { PERSONAS, PARKED } from './personas.js';

/** Every house account, shipped and parked, as it should exist. */
const ALL = [...PERSONAS, ...PARKED];

/**
 * Create anything missing, repair anything drifted.
 * @returns {Promise<{byKey: Map<string, number>, created: string[], repaired: string[]}>}
 */
export async function ensureHouseAccounts(sql) {
  const handles = ALL.map((p) => p.handle);
  const rows = await sql`
    SELECT id, handle, name, is_house FROM users WHERE handle = ANY(${handles})`;
  const byHandle = new Map(rows.map((r) => [r.handle, r]));

  const created = [];
  const repaired = [];
  for (const p of ALL) {
    const existing = byHandle.get(p.handle);
    if (!existing) {
      const [row] = await sql`
        INSERT INTO users (handle, name, is_house, first_seen_context)
        VALUES (${p.handle}, ${p.name}, true, 'house')
        RETURNING id, handle`;
      byHandle.set(p.handle, { ...row, name: p.name, is_house: true });
      created.push(p.handle);
      continue;
    }
    // THE FLAG AND THE NAME ARE REPAIRED, THE HANDLE NEVER IS - the handle is
    // how we found the row, so there is nothing to correct about it, and a
    // rename would orphan every entry this account has already filed.
    if (existing.is_house !== true || existing.name !== p.name) {
      await sql`UPDATE users SET is_house = true, name = ${p.name} WHERE id = ${existing.id}`;
      repaired.push(p.handle);
    }
  }

  const byKey = new Map(ALL.map((p) => [p.key, byHandle.get(p.handle).id]));
  return { byKey, created, repaired };
}

/** The house user ids, for a reader that wants to mark rows without a join. */
export async function houseUserIds(sql) {
  const rows = await sql`SELECT id FROM users WHERE is_house`;
  return new Set(rows.map((r) => Number(r.id)));
}
