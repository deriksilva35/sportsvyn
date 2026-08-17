'use server';

// Claim and rename a handle.
//
// THE UNIQUE INDEX IS THE TRUTH, NOT THE LOOKUP. checkHandle() is advisory by
// nature: two people can pass it on the same name in the same second. So the
// write catches 23505 and reports "taken" from the constraint rather than
// trusting a SELECT it did a moment earlier.
//
// A FREED HANDLE IS BLOCKED FOR 30 DAYS. Without that the moderation path is
// self-defeating - force-rename an abusive handle and the same person reclaims
// it half a minute later, or a bystander grabs a name a rival just lost.

import { auth } from '@/auth';
import { sql } from '@/lib/db';
import {
  validateHandle, canonical, canRename, renameAvailableAt, RECLAIM_BLOCK_DAYS,
} from '@/lib/daily/handles';

async function blockedByCooldown(lower) {
  const r = await sql`
    SELECT 1 FROM handle_history
     WHERE lower(handle) = ${lower}
       AND released_at IS NOT NULL
       AND released_at > now() - (${RECLAIM_BLOCK_DAYS} || ' days')::interval
     LIMIT 1`;
  return r.length > 0;
}

/** Advisory availability, for the input's live state. */
export async function checkHandle(raw) {
  const v = validateHandle(raw);
  if (!v.ok) return { ok: false, reason: v.reason, message: v.message };

  const session = await auth();
  const userId = session?.user?.id ?? null;

  const taken = await sql`SELECT id FROM users WHERE lower(handle) = ${v.canonical} LIMIT 1`;
  if (taken.length && String(taken[0].id) !== String(userId)) {
    return { ok: false, reason: 'taken', message: 'Taken.' };
  }
  if (await blockedByCooldown(v.canonical)) {
    return { ok: false, reason: 'cooldown', message: 'Recently released - try again later.' };
  }
  return { ok: true, message: 'Available' };
}

export async function claimHandle(raw) {
  const session = await auth();
  const userId = session?.user?.id ?? null;
  if (userId == null) return { ok: false, message: 'Sign in first.' };

  const v = validateHandle(raw);
  if (!v.ok) return { ok: false, reason: v.reason, message: v.message };

  const me = (await sql`SELECT handle, handle_changed_at FROM users WHERE id = ${userId}`)[0];
  if (!me) return { ok: false, message: 'No such account.' };

  // Renaming to the same name is a no-op, not a cooldown burn.
  if (canonical(me.handle) === v.canonical) return { ok: true, handle: me.handle, unchanged: true };

  if (me.handle && !canRename(me.handle_changed_at)) {
    const at = renameAvailableAt(me.handle_changed_at);
    return {
      ok: false,
      reason: 'cooldown',
      message: `You can change your handle again on ${at.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}.`,
    };
  }
  if (await blockedByCooldown(v.canonical)) {
    return { ok: false, reason: 'cooldown', message: 'Recently released - try again later.' };
  }

  try {
    await sql`
      UPDATE users SET handle = ${v.handle}, handle_changed_at = now() WHERE id = ${userId}`;
  } catch (e) {
    // 23505 from idx_users_handle_lower: somebody won the race between the
    // check and the write. The constraint is the answer, not the lookup.
    if (String(e?.code) === '23505') return { ok: false, reason: 'taken', message: 'Taken.' };
    throw e;
  }

  if (me.handle) {
    await sql`
      UPDATE handle_history SET released_at = now(), reason = COALESCE(reason, 'renamed')
       WHERE user_id = ${userId} AND lower(handle) = ${canonical(me.handle)} AND released_at IS NULL`;
  }
  await sql`INSERT INTO handle_history (user_id, handle) VALUES (${userId}, ${v.handle})`;
  return { ok: true, handle: v.handle };
}
