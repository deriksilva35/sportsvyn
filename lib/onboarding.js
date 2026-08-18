// lib/onboarding.js - who gets the onboarding sheet, and what it asks. PURE.
//
// THE HANDLE IS THE ONLY REQUIRED STEP, and that is both a product rule and an
// App Store one. Email and name are optional with an equal-weight SKIP; a sheet
// that will not let you past without an address is a sheet Apple can reject and
// a reader can only resent. The handle is different: it is the name that
// appears next to a score on a public board, and "Player 3f9c" is a worse
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
  const h = user.handle;
  return h == null || String(h).trim() === '';
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

export const STEPS = ['handle', 'email', 'name'];
