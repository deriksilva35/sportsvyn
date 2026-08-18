'use server';

/**
 * app/actions/onboarding.js — steps 2 and 3 of the onboarding sheet.
 *
 * STEP 1 IS NOT HERE. The handle is claimed through the existing
 * app/actions/handle.js claimHandle, unchanged - it already has the validation,
 * the denylist, the cooldown and the uniqueness index behind it, and a second
 * claim path would be a second place for those rules to drift.
 *
 * AUTH EMAIL IS NEVER WRITTEN. users.email resolves sign-in for the nineteen
 * magic-link accounts; onboarding touches contact_email only. See migration
 * 069 for why that separation is not optional.
 *
 * EVERY ACTION FAILS SOFT. Onboarding must never be the thing that stops
 * somebody using the app - the worst outcome of a failure here is that we do
 * not have their address.
 */

import { auth } from '@/auth';
import { sql } from '@/lib/db';
import { validateContactEmail, normalizeName } from '@/lib/onboarding';

async function currentUserId() {
  const session = await auth();
  const id = session?.user?.id ?? null;
  return id == null ? null : Number(id);
}

/** Store a contact address. Optional by design; refusal is never fatal. */
export async function saveContactEmail(raw) {
  const userId = await currentUserId();
  if (userId == null) return { ok: false, reason: 'unauthenticated' };

  const v = validateContactEmail(raw);
  if (!v.ok) return { ok: false, reason: v.reason };

  try {
    await sql`
      UPDATE users SET contact_email = ${v.value}, contact_email_at = now()
       WHERE id = ${userId}`;
    return { ok: true, email: v.value };
  } catch {
    return { ok: false, reason: 'could not save' };
  }
}

/** Store a display name. Blank is a SKIP, not a clear - it writes nothing. */
export async function saveName(raw) {
  const userId = await currentUserId();
  if (userId == null) return { ok: false, reason: 'unauthenticated' };
  const name = normalizeName(raw);
  if (!name) return { ok: true, skipped: true };
  try {
    await sql`UPDATE users SET name = ${name} WHERE id = ${userId}`;
    return { ok: true, name };
  } catch {
    return { ok: false, reason: 'could not save' };
  }
}

/**
 * Mark the sheet finished.
 *
 * RECORD-KEEPING, NOT THE GATE. The sheet's trigger is `handle IS NULL`, so a
 * claimed handle already closes it; this only answers "did they come through
 * the flow", which the trigger cannot tell you afterwards. Set-once so a
 * reopened sheet does not move the date.
 */
export async function completeOnboarding() {
  const userId = await currentUserId();
  if (userId == null) return { ok: false, reason: 'unauthenticated' };
  try {
    await sql`UPDATE users SET onboarded_at = now() WHERE id = ${userId} AND onboarded_at IS NULL`;
    return { ok: true };
  } catch {
    return { ok: false, reason: 'could not save' };
  }
}
