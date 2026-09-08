// lib/onboarding.js - who gets the onboarding sheet, and what it asks. PURE.
//
// THE HANDLE IS THE ONLY REQUIRED STEP, and that is both a product rule and an
// App Store one. Email and name are optional with an equal-weight SKIP; a sheet
// that will not let you past without an address is a sheet Apple can reject and
// a reader can only resent. The handle is different: it is the name that
// appears next to a score on a public board, and "Anonymous" is a worse
// outcome for them than one required field.
//
// THE TRIGGER IS `handle IS NULL`, nothing else. Not a localStorage flag - that
// re-prompts the same person on a second device, and the brief says never
// again this season. Not a dedicated "seen it" column either: the handle IS the
// completion state, so the two can never disagree. A reader who claimed a
// handle on the Daily months ago is simply never shown the sheet.

/** Apple's private relay domain - a real inbox, but not one a person reads. */
const RELAY = '@privaterelay.appleid.com';

export const isRelayAddress = (email) => String(email ?? '').toLowerCase().endsWith(RELAY);

/**
 * Does this user need onboarding?
 *
 * ONE CONDITION. See the header: the handle is the completion state.
 */
export function needsOnboarding(user) {
  if (!user) return false;
  // THE TRIGGER IS onboarded_at, NOT handle (relay item 3). It used to be
  // `handle IS NULL`, and that was sound while step 1 claimed the handle:
  // finishing the sheet set the very column that dismissed it.
  //
  // Step 1 has moved to the first ranked entry, so this sheet no longer
  // writes `handle` at all - leaving the old trigger in place would have
  // shown it, taken the email and the name, set onboarded_at, and then
  // shown it again on the next page load, forever, to anyone who had not
  // separately claimed a handle. completeOnboarding() (app/actions/
  // onboarding.js) sets onboarded_at, so this is now the column the sheet
  // can actually satisfy.
  return user.onboarded_at == null;
}

/**
 * What step 2 should do with the address we already hold.
 *
 * A REAL ADDRESS IS PREFILLED AND CONFIRMED IN ONE TAP, because we already have
 * it and asking someone to retype what we know is the kind of friction that
 * ends a flow. A RELAY ADDRESS IS NOT PREFILLED: it is a forwarding alias the
 * reader never sees, and putting it in the box would invite them to confirm an
 * address that reaches them today and stops the moment they revoke it in Apple
 * settings. So the field starts empty and the ask is soft.
 *
 * NEITHER BRANCH BLOCKS. `skippable` is true in both.
 */
export function emailStep(user) {
  const auth = user?.email ?? null;
  const existing = user?.contact_email ?? null;
  if (existing) {
    return { mode: 'done', prefill: existing, skippable: true };
  }
  if (auth && !isRelayAddress(auth)) {
    return { mode: 'confirm', prefill: auth, skippable: true };
  }
  return { mode: 'ask', prefill: '', skippable: true };
}

/**
 * Minimal address sanity, client-side courtesy only.
 *
 * DELIBERATELY LOOSE. The only address that matters is one that can receive
 * mail, and no regex decides that - a bounce does. This rejects the shapes that
 * are certainly typos (no @, no dot after it, whitespace) and lets everything
 * else through rather than lecturing somebody about their own address.
 */
export function validateContactEmail(raw) {
  const v = String(raw ?? '').trim();
  if (!v) return { ok: false, reason: 'empty' };
  if (v.length > 254) return { ok: false, reason: 'too long' };
  if (/\s/.test(v)) return { ok: false, reason: 'no spaces in an address' };
  const at = v.indexOf('@');
  if (at < 1 || at !== v.lastIndexOf('@')) return { ok: false, reason: 'needs one @' };
  const domain = v.slice(at + 1);
  if (!domain.includes('.') || domain.startsWith('.') || domain.endsWith('.')) {
    return { ok: false, reason: 'check the domain' };
  }
  return { ok: true, value: v };
}

/** Trim and cap a display name. Empty means "skipped", not "cleared". */
export function normalizeName(raw) {
  const v = String(raw ?? '').trim().replace(/\s+/g, ' ');
  if (!v) return null;
  return v.slice(0, 60);
}

/**
 * The address the broadcast should use.
 *
 * CONTACT WINS WHEN PRESENT. It is the one a person typed into a box that said
 * we would email them; the auth address may be a relay alias that only forwards
 * while Apple says so.
 */
export const preferredEmail = (user) => user?.contact_email ?? user?.email ?? null;

// The handle is no longer one of these - see needsOnboarding above.
export const STEPS = ['email', 'name'];

/**
 * Does this signed-in user already have a handle? The server half of the
 * first-entry gate (components/handle/HandleGate.js).
 *
 * SAME RULE AS needsOnboarding(), INVERTED - deliberately one definition of
 * "has a handle", so the modal and the sheet can never disagree about who is
 * done. Reads the one column; a null userId (signed out) is `true`, because
 * a signed-out reader is already routed to sign-in by every one of these
 * surfaces and must not be shown a handle modal on top of that.
 *
 * CAUGHT TO true. A failed read must not put a modal in front of somebody
 * who has a perfectly good handle - the safe direction here is to let the
 * write through, exactly as the old gate's own read caught to "no sheet".
 */
export async function userHasHandle(userId, sql) {
  if (userId == null) return true;
  const row = await sql`SELECT handle FROM users WHERE id = ${Number(userId)} LIMIT 1`
    .then((r) => r[0] ?? null)
    .catch(() => null);
  if (!row) return true;
  // IT TESTS THE HANDLE. It used to return !needsOnboarding(row), which was
  // sound while needsOnboarding meant `handle IS NULL`. On 6 Sep (2718e30)
  // needsOnboarding moved to `onboarded_at == null` - a column this SELECT
  // never fetched - so the row it was handed always read as un-onboarded and
  // this returned false for EVERY signed-in user, handle or not. 168 people
  // with handles were asked to claim one, through a modal whose action would
  // have renamed them. The onboarding SHEET keeps needsOnboarding and
  // onboarded_at; this gate asks only the question in its name.
  return row.handle != null;
}
