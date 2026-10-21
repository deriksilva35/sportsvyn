// lib/email/morningAudience.js - WHO GETS THE MORNING EMAIL (ruling thu-1).
//
//   (a) any game action in the last 30 days, OR
//   (b) an account created in the last 14 days, OR
//   (c) "Morning email" turned ON at /you (users.morning_email = true).
// Dormant accounts get nothing. ON TOP OF THAT, the broadcast's own exclusions:
// unsubscribed (email_opted_out_at), house accounts, the owner's addresses, no
// address at all, and a hard bounce (lib/email/suppression.js). Turned OFF at
// /you (morning_email = false) is never mailed, whatever (a) or (b) say.
//
// "A GAME ACTION" is what the 16 Oct count measured: a Daily run, a contest
// entry created / updated / submitted, a Survivor pick made by hand (not auto),
// a draft started, a v1 puzzle entry.
//
// THE PREFERENCE IS READ THROUGH to_jsonb(u), so the same query runs on a
// database that does not have migration 146 yet (the 18 Oct PROD count) - an
// absent column is NULL, which is "the rule decides".

import { hardBouncedAddresses, norm } from './suppression.js';
import { testAccountVerdict } from './testAccounts.js';

export const ACTIVE_DAYS = 30;
export const NEW_DAYS = 14;

/** PURE: the rule for one account. */
export function morningEligible({ pref = null, playedDaysAgo = null, ageDays = null, optedOut = false, house = false, owner = false, bounced = false, hasAddress = true } = {}) {
  if (!hasAddress || optedOut || house || owner || bounced) return false;
  if (pref === false) return false;
  if (pref === true) return true;
  return (playedDaysAgo != null && playedDaysAgo <= ACTIVE_DAYS) || (ageDays != null && ageDays < NEW_DAYS);
}

/**
 * OWNER / HOUSE / TEST ACCOUNTS (tue-4): every account that is a house account or
 * carries an owner address, with the verdict of lib/email/testAccounts.js. They
 * skip the 30-day / 14-day rule - they are mailed whenever the address is a real
 * mailbox - but a hard bounce, an unsubscribe or "Morning email OFF" still wins.
 * -> [{ id, email, house, owner, included, reason }]
 */
export async function testAccountRoster(sql, { owners = [], bounced = null } = {}) {
  const hard = new Set(bounced ?? await hardBouncedAddresses(sql));
  const rows = await sql`
    SELECT u.id, COALESCE(u.contact_email, u.email) AS email, COALESCE(u.is_house, false) AS house,
           (u.email_opted_out_at IS NOT NULL) AS opted_out, (to_jsonb(u)->>'morning_email')::boolean AS pref,
           (lower(COALESCE(u.email, '')) = ANY(${owners}) OR lower(COALESCE(u.contact_email, '')) = ANY(${owners})) AS owner
      FROM users u
     WHERE COALESCE(u.is_house, false)
        OR lower(COALESCE(u.email, '')) = ANY(${owners}) OR lower(COALESCE(u.contact_email, '')) = ANY(${owners})
     ORDER BY u.id`;
  return rows.map((r) => {
    const v = testAccountVerdict({ email: r.email, optedOut: r.opted_out, pref: r.pref, bounced: hard.has(norm(r.email)) });
    return { id: r.id, email: r.email, house: r.house, owner: r.owner, included: v.ok, reason: v.reason };
  });
}

/** The audience: [{ id, email, why: 'active'|'new'|'opted_in'|'test' }]. */
export async function morningAudience(sql, { owners = [] } = {}) {
  const bounced = await hardBouncedAddresses(sql);
  const test = (await testAccountRoster(sql, { owners, bounced })).filter((t) => t.included)
    .map((t) => ({ id: t.id, email: t.email, why: 'test' }));
  const regular = await sql`
    WITH acted AS (
      SELECT user_id u FROM daily_board_runs WHERE COALESCE(completed_at, started_at) >= now() - interval '30 days'
      UNION SELECT user_id FROM contest_entries WHERE GREATEST(created_at, updated_at, COALESCE(submitted_at, created_at)) >= now() - interval '30 days'
      UNION SELECT user_id FROM survivor_picks WHERE picked_at >= now() - interval '30 days' AND NOT auto
      UNION SELECT user_id FROM drafts WHERE started_at >= now() - interval '30 days'
      UNION SELECT user_id FROM puzzle_entries WHERE created_at >= now() - interval '30 days'),
    base AS (
      SELECT u.id, COALESCE(u.contact_email, u.email) AS email, u.created_at,
             (to_jsonb(u)->>'morning_email')::boolean AS pref,
             u.id IN (SELECT u FROM acted) AS active
        FROM users u
       WHERE COALESCE(u.contact_email, u.email) IS NOT NULL
         AND u.email_opted_out_at IS NULL
         AND NOT COALESCE(u.is_house, false)
         AND NOT (lower(COALESCE(u.email, '')) = ANY(${owners}))
         AND NOT (lower(COALESCE(u.contact_email, '')) = ANY(${owners}))
         AND NOT (lower(trim(COALESCE(u.contact_email, u.email))) = ANY(${bounced})))
    SELECT id, email,
           CASE WHEN pref IS TRUE THEN 'opted_in' WHEN active THEN 'active' ELSE 'new' END AS why
      FROM base
     WHERE pref IS NOT FALSE
       AND (pref IS TRUE OR active OR created_at >= now() - interval '14 days')
     ORDER BY id`;
  return [...regular, ...test].sort((a, b) => a.id - b.id);
}
