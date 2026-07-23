/**
 * lib/auth/emailOtp.js — 6-digit email OTP bound to the Auth.js verification token.
 *
 * The magic link and the code are two redemption paths for the SAME token:
 *   · auth.js sendVerificationRequest generates the code, stores its hash in
 *     email_otp alongside token_hash = sha256(rawToken + AUTH_SECRET) — which
 *     equals verification_token.token for that send — plus the token's own expiry.
 *   · redeemEmailCode() verifies the code, confirms the link is still unspent
 *     (the verification_token row still exists), then creates a database session
 *     and DELETES both rows. So whichever path is used first consumes the token;
 *     the other stops working.
 *
 * Security: 6 digits, 10-minute expiry (the token's maxAge), 5 wrong attempts
 * invalidate the token, single-use, constant-time hash compare, code never stored
 * in plaintext. This module is DB-only (no cookies) so it is unit-testable; the
 * server action (app/actions/emailOtp.js) sets the session cookie.
 */

import crypto from 'node:crypto';

export const CODE_TTL_SECONDS = 600; // 10 minutes — must match the Resend provider maxAge
export const MAX_ATTEMPTS = 5;

// sha256(value + secret) hex. Matches Auth.js's hashToken (createHash), so a
// token_hash computed here equals the verification_token.token it stored.
export function sha256(value, secret) {
  return crypto.createHash('sha256').update(`${value}${secret}`).digest('hex');
}

export function generateCode() {
  return String(crypto.randomInt(0, 1_000_000)).padStart(6, '0');
}

export function normalizeEmail(email) {
  return String(email ?? '').trim().toLowerCase();
}

function safeEqualHex(aHex, bHex) {
  let a; let b;
  try { a = Buffer.from(aHex, 'hex'); b = Buffer.from(bHex, 'hex'); } catch { return false; }
  return a.length > 0 && a.length === b.length && crypto.timingSafeEqual(a, b);
}

// Store the code (hashed) for a just-sent verification token. Independent of the
// adapter's verification_token insert — no ordering dependency. Housekeeps the
// identifier's expired rows.
export async function attachCode(sql, { identifier, tokenHash, codeHash, expires }) {
  const id = normalizeEmail(identifier);
  await sql`DELETE FROM email_otp WHERE identifier = ${id} AND expires < now()`;
  await sql`
    INSERT INTO email_otp (identifier, token_hash, code_hash, expires, attempts)
    VALUES (${id}, ${tokenHash}, ${codeHash}, ${expires}, 0)
    ON CONFLICT (identifier, token_hash)
      DO UPDATE SET code_hash = EXCLUDED.code_hash, expires = EXCLUDED.expires, attempts = 0`;
}

async function consume(sql, identifier, tokenHash) {
  await sql`DELETE FROM verification_token WHERE identifier = ${identifier} AND token = ${tokenHash}`;
  await sql`DELETE FROM email_otp WHERE identifier = ${identifier} AND token_hash = ${tokenHash}`;
}

// Verify a 6-digit code. DB-only. On success: creates a sessions row and consumes
// the token (deletes verification_token + email_otp) so the magic link dies too.
// Returns { ok, reason?, remaining?, sessionToken?, sessionExpires?, userId? }.
export async function redeemEmailCode(sql, {
  email, code, secret, now = new Date(), sessionMaxAgeMs = 30 * 24 * 3600 * 1000,
}) {
  const identifier = normalizeEmail(email);
  const cleanCode = String(code ?? '').replace(/\D/g, '');
  if (cleanCode.length !== 6) return { ok: false, reason: 'invalid' };

  const rows = await sql`
    SELECT token_hash, code_hash, expires, attempts FROM email_otp
    WHERE identifier = ${identifier} AND expires > ${now.toISOString()}
    ORDER BY expires DESC LIMIT 1`;
  const otp = rows[0];
  if (!otp) return { ok: false, reason: 'invalid' };

  // Single-use coordination with the magic link: if the token row is gone, the
  // link was already used (or attempts were exhausted) — the code is spent.
  const linkAlive = await sql`
    SELECT 1 FROM verification_token WHERE identifier = ${identifier} AND token = ${otp.token_hash} LIMIT 1`;
  if (!linkAlive.length) {
    await sql`DELETE FROM email_otp WHERE identifier = ${identifier} AND token_hash = ${otp.token_hash}`;
    return { ok: false, reason: 'invalid' };
  }

  if (otp.attempts >= MAX_ATTEMPTS) {
    await consume(sql, identifier, otp.token_hash);
    return { ok: false, reason: 'too_many' };
  }

  if (!safeEqualHex(otp.code_hash, sha256(cleanCode, secret))) {
    const upd = await sql`
      UPDATE email_otp SET attempts = attempts + 1
      WHERE identifier = ${identifier} AND token_hash = ${otp.token_hash} RETURNING attempts`;
    const attempts = upd[0]?.attempts ?? MAX_ATTEMPTS;
    if (attempts >= MAX_ATTEMPTS) {
      await consume(sql, identifier, otp.token_hash);
      return { ok: false, reason: 'too_many' };
    }
    return { ok: false, reason: 'wrong', remaining: MAX_ATTEMPTS - attempts };
  }

  // Correct — resolve/create the user, mark verified, create a DB session, consume.
  let user = (await sql`SELECT id FROM users WHERE email = ${identifier} LIMIT 1`)[0];
  if (!user) {
    user = (await sql`INSERT INTO users (email, "emailVerified") VALUES (${identifier}, ${now.toISOString()}) RETURNING id`)[0];
  } else {
    await sql`UPDATE users SET "emailVerified" = ${now.toISOString()} WHERE id = ${user.id} AND "emailVerified" IS NULL`;
  }
  const sessionToken = crypto.randomUUID();
  const sessionExpires = new Date(now.getTime() + sessionMaxAgeMs);
  await sql`INSERT INTO sessions ("sessionToken", "userId", expires) VALUES (${sessionToken}, ${user.id}, ${sessionExpires.toISOString()})`;
  await consume(sql, identifier, otp.token_hash);
  return { ok: true, userId: user.id, sessionToken, sessionExpires };
}
