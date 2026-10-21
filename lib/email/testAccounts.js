// lib/email/testAccounts.js - OWNER / HOUSE / TEST ACCOUNTS GET THE DAILY EMAIL (tue-4).
//
// Until tue-4 the morning audience dropped every house account and every owner
// address. Now an owner / house / test account is MAILED when its address is a
// real, deliverable mailbox, and dropped only for a reason that is written down:
//
//   no-address      nothing to send to
//   malformed       not an address
//   placeholder     example.com / .org / .net, *.example, .test, .invalid,
//                   .local, .localhost, localhost, a "test." host, or a
//                   sentinel local part (mtest-, bouncetest-, sentinel, probe-)
//   opted-out       email_opted_out_at is set, or "Morning email" is OFF at /you
//   hard-bounced    lib/email/suppression.js
//
// House accounts stay out of the PUBLIC numbers (played count, top players,
// leaderboards) exactly as before - that is a separate query in morningSend.js
// and is untouched. This module is pure: the audience query and the report both
// call testAccountVerdict.

const RESERVED_DOMAINS = new Set(['example.com', 'example.org', 'example.net', 'localhost']);
const RESERVED_SUFFIXES = ['.test', '.invalid', '.local', '.localhost', '.example', '.internal'];
const SENTINEL_LOCAL = /^(mtest|bouncetest|sentinel|probe|fixture|fake|dummy)([-_.+]|$)|sentinel/i;

/** PURE: { ok, reason } for one address. reason is null when ok. */
export function addressVerdict(address) {
  const a = String(address ?? '').trim().toLowerCase();
  if (!a) return { ok: false, reason: 'no-address' };
  const m = /^([^@\s]+)@([^@\s]+\.[^@\s]+|localhost)$/.exec(a);
  if (!m) return { ok: false, reason: 'malformed' };
  const [, local, domain] = m;
  if ([...RESERVED_DOMAINS].some((d) => domain === d || domain.endsWith(`.${d}`))) return { ok: false, reason: 'placeholder' };
  if (RESERVED_SUFFIXES.some((s) => domain.endsWith(s))) return { ok: false, reason: 'placeholder' };
  if (domain.split('.').includes('test') || domain.startsWith('test.')) return { ok: false, reason: 'placeholder' };
  if (SENTINEL_LOCAL.test(local)) return { ok: false, reason: 'placeholder' };
  return { ok: true, reason: null };
}

/**
 * PURE: the verdict for one owner / house / test account.
 * { email, optedOut, pref, bounced } -> { ok, reason }.
 */
export function testAccountVerdict({ email = null, optedOut = false, pref = null, bounced = false } = {}) {
  const v = addressVerdict(email);
  if (!v.ok) return v;
  if (optedOut || pref === false) return { ok: false, reason: 'opted-out' };
  if (bounced) return { ok: false, reason: 'hard-bounced' };
  return { ok: true, reason: null };
}
