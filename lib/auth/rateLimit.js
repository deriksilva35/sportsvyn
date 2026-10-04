/**
 * lib/auth/rateLimit.js - caps on sign-in email sends, and the per-email
 * wrong-code window (RULING sun-12 item 2, SECURITY).
 *
 * Before this, every POST to /api/auth/signin/resend sent an email (unlimited
 * mail to any address, on our Resend bill), and the only wrong-code limit was
 * 5 per CODE: asking for a new code gave a fresh 5, so the guess budget per
 * account was unbounded. Both are now rolling-window counts over one ledger,
 * auth_throttle (migration 126). DB-only and clock-injectable (`now`), so the
 * windows are tested by moving the clock, not by waiting.
 *
 * THE NUMBERS, in one place:
 *
 *   SEND_PER_EMAIL  5 / rolling hour. A real person needs one code, two if the
 *                   first went to spam, three if they mistyped the address and
 *                   came back. Five leaves room for that and still caps what
 *                   anyone can make us send to one inbox at 120 a day.
 *   SEND_PER_IP    20 / rolling hour. One address can be a household, an
 *                   office or a phone carrier's NAT, so it is four people each
 *                   using their whole per-email allowance. It is the cap that
 *                   stops one machine cycling through MANY addresses, which the
 *                   per-email cap cannot see.
 *   FAIL_PER_EMAIL 10 wrong codes / rolling 24h. Two full codes' worth of the
 *                   per-code limit (5, MAX_ATTEMPTS in emailOtp.js, unchanged).
 *                   At 10 guesses a day against a 1-in-1,000,000 code, a
 *                   brute force needs ~190 years for even odds.
 *
 * Both caps count sends to ANY address, existing account or not, so a refusal
 * says nothing about whether an account exists.
 *
 * FAILS OPEN. If the ledger cannot be read or written (the table missing on a
 * deploy that beat its migration, a database blip), the send or the
 * verification goes ahead and the error is logged. A throttle that fails
 * closed turns a database hiccup into nobody being able to sign in.
 */

export const AUTH_LIMITS = Object.freeze({
  SEND_PER_EMAIL: Object.freeze({ max: 5, windowMs: 60 * 60 * 1000 }),
  SEND_PER_IP: Object.freeze({ max: 20, windowMs: 60 * 60 * 1000 }),
  FAIL_PER_EMAIL: Object.freeze({ max: 10, windowMs: 24 * 60 * 60 * 1000 }),
});

// No window is longer than 24h; two days keeps a margin for reading the log.
const RETAIN_MS = 2 * 24 * 60 * 60 * 1000;

export function normalizeIdentifier(email) {
  return String(email ?? '').trim().toLowerCase();
}

/**
 * The caller's IP, the way Vercel hands it to a function: x-forwarded-for's
 * FIRST hop (Vercel sets the header itself, overwriting anything the client
 * sent), else x-real-ip. Accepts a Headers object or a plain object. Returns
 * null when neither is present (local dev, a script) - the per-IP cap is then
 * skipped, the per-email cap still applies.
 */
export function clientIp(headers) {
  if (!headers) return null;
  const get = (k) => (typeof headers.get === 'function' ? headers.get(k) : headers[k] ?? headers[k.toLowerCase()]);
  const xff = get('x-forwarded-for');
  if (xff) {
    const first = String(xff).split(',')[0].trim();
    if (first) return first.slice(0, 64);
  }
  const real = get('x-real-ip');
  if (real && String(real).trim()) return String(real).trim().slice(0, 64);
  return null;
}

const iso = (d) => new Date(d).toISOString();

/**
 * Reserve one send. Writes the ledger row FIRST, then counts the rows that came
 * before it, so two simultaneous requests cannot both read "4 of 5" and both
 * send: the later id sees the earlier one. A refused request keeps its row
 * with refused = true, which the counts ignore - an attacker hammering a capped
 * address does not push the address's own recovery further out.
 *
 * Returns { ok: true } or { ok: false, reason: 'email' | 'ip' }.
 */
export async function reserveSend(sql, { identifier, ip = null, purpose = 'signin', now = new Date() }) {
  const id = normalizeIdentifier(identifier);
  const at = iso(now);
  await sql`DELETE FROM auth_throttle WHERE at < ${iso(new Date(now).getTime() - RETAIN_MS)}`;
  const [row] = await sql`
    INSERT INTO auth_throttle (kind, identifier, ip, purpose, at)
    VALUES ('send', ${id}, ${ip}, ${purpose}, ${at})
    RETURNING id`;

  const emailSince = iso(new Date(now).getTime() - AUTH_LIMITS.SEND_PER_EMAIL.windowMs);
  const ipSince = iso(new Date(now).getTime() - AUTH_LIMITS.SEND_PER_IP.windowMs);
  const [c] = await sql`
    SELECT
      count(*) FILTER (WHERE identifier = ${id} AND at > ${emailSince})::int AS by_email,
      count(*) FILTER (WHERE ${ip}::text IS NOT NULL AND ip = ${ip} AND at > ${ipSince})::int AS by_ip
    FROM auth_throttle
    WHERE kind = 'send' AND NOT refused AND id < ${row.id} AND at <= ${at}
      AND (identifier = ${id} OR (${ip}::text IS NOT NULL AND ip = ${ip}))`;

  let reason = null;
  if (c.by_email >= AUTH_LIMITS.SEND_PER_EMAIL.max) reason = 'email';
  else if (ip && c.by_ip >= AUTH_LIMITS.SEND_PER_IP.max) reason = 'ip';
  if (!reason) return { ok: true };
  await sql`UPDATE auth_throttle SET refused = true WHERE id = ${row.id}`;
  return { ok: false, reason };
}

/** reserveSend that never throws: a ledger failure allows the send (logged). */
export async function reserveSendSafe(sql, args) {
  try {
    return await reserveSend(sql, args);
  } catch (e) {
    console.error('[auth-throttle] send check failed, allowing', { purpose: args?.purpose, message: e?.message });
    return { ok: true, failedOpen: true };
  }
}

/** One wrong code for this identifier. */
export async function recordFailure(sql, { identifier, ip = null, now = new Date() }) {
  await sql`
    INSERT INTO auth_throttle (kind, identifier, ip, at)
    VALUES ('fail', ${normalizeIdentifier(identifier)}, ${ip}, ${iso(now)})`;
}

/**
 * Wrong codes for this identifier in the last 24h, and whether that locks it.
 * unlocksAt is when the count next drops below the limit: the moment the
 * oldest failure that keeps it at the limit leaves the window.
 * Returns { count, remaining, locked, unlocksAt: Date | null }.
 */
export async function failureState(sql, { identifier, now = new Date() }) {
  const { max, windowMs } = AUTH_LIMITS.FAIL_PER_EMAIL;
  const since = iso(new Date(now).getTime() - windowMs);
  const rows = await sql`
    SELECT at FROM auth_throttle
    WHERE kind = 'fail' AND identifier = ${normalizeIdentifier(identifier)}
      AND at > ${since} AND at <= ${iso(now)}
    ORDER BY at ASC`;
  const count = rows.length;
  const locked = count >= max;
  const unlocksAt = locked ? new Date(new Date(rows[count - max].at).getTime() + windowMs) : null;
  return { count, remaining: Math.max(0, max - count), locked, unlocksAt };
}

/** A correct code ends the episode: the owner proved the inbox. */
export async function clearFailures(sql, { identifier }) {
  await sql`DELETE FROM auth_throttle WHERE kind = 'fail' AND identifier = ${normalizeIdentifier(identifier)}`;
}
