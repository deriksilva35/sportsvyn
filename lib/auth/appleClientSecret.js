/**
 * appleClientSecret — mint the "client secret" Sign in with Apple demands.
 *
 * Apple is the one OAuth provider whose client secret is not a static
 * string but a short-lived ES256-signed JWT built from three Apple
 * identifiers (team id, key id, the .p8 private key) plus the Services ID
 * as the subject. Auth.js's Apple provider takes the *result* as a plain
 * `clientSecret` string — it does not sign one for you at this version — so
 * we sign it here and hand the token to the provider config.
 *
 * JWT shape (per Apple's "Creating a client secret" doc):
 *   header : { alg: ES256, kid: APPLE_KEY_ID }
 *   iss    : APPLE_TEAM_ID
 *   sub    : APPLE_CLIENT_ID   (the Services ID, com.sportsvyn.web)
 *   aud    : https://appleid.apple.com
 *   iat/exp: now .. now + TTL (Apple caps this at 6 months)
 *
 * getAppleClientSecret() memoizes the signing per serverless instance: the
 * factory in auth.js runs per request, but the secret is valid for months,
 * so we sign once on first use and reuse the token for the instance's life.
 * A cold start mints a fresh one well inside Apple's ceiling.
 */

import { SignJWT, importPKCS8 } from 'jose';

const APPLE_AUD = 'https://appleid.apple.com';

// Comfortably under Apple's 6-month (~15777000s) ceiling. A new instance
// re-signs on its next cold start, long before this window closes.
const CLIENT_SECRET_TTL = '150d';

/**
 * True only when all four Apple env vars are present. auth.js gates the
 * provider on this so a deployment without Apple credentials (e.g. a
 * preview env) still serves magic-link sign-in instead of crashing.
 */
export function appleConfigured() {
  return Boolean(
    process.env.APPLE_TEAM_ID &&
      process.env.APPLE_KEY_ID &&
      process.env.APPLE_CLIENT_ID &&
      process.env.APPLE_PRIVATE_KEY,
  );
}

/**
 * Coerce whatever form the .p8 key is stored in into a PKCS#8 PEM that
 * importPKCS8 accepts. Apple's key downloads as PKCS#8, but env storage
 * mangles it a few predictable ways:
 *
 *   - Full PEM with real newlines            -> used as-is.
 *   - Full PEM with literal "\n" escapes     -> escapes restored to newlines.
 *   - Bare base64 DER, armor stripped        -> re-wrapped at 64 cols with the
 *                                               PKCS#8 BEGIN/END armor added.
 *
 * IMPORTANT: this cannot rescue a value the env loader already TRUNCATED.
 * A multi-line unquoted env value is read only up to its first newline, so
 * the key MUST live on a single logical line (quoted-with-\n PEM, or bare
 * single-line base64). This helper only normalizes a complete value.
 */
export function toPkcs8Pem(raw) {
  const val = raw.includes('\\n') ? raw.replace(/\\n/g, '\n') : raw;
  if (val.includes('-----BEGIN')) return val;
  // Bare base64 DER: strip any whitespace, re-wrap at 64 columns, add armor.
  const b64 = val.replace(/\s+/g, '');
  const wrapped = b64.match(/.{1,64}/g)?.join('\n') ?? b64;
  return `-----BEGIN PRIVATE KEY-----\n${wrapped}\n-----END PRIVATE KEY-----\n`;
}

/**
 * Sign the client-secret JWT from explicit inputs (pure — no env access, so
 * it is unit-testable with a throwaway key pair).
 */
export async function signAppleClientSecret({
  teamId,
  keyId,
  clientId,
  privateKeyPem,
}) {
  const key = await importPKCS8(toPkcs8Pem(privateKeyPem), 'ES256');
  return new SignJWT({})
    .setProtectedHeader({ alg: 'ES256', kid: keyId })
    .setIssuer(teamId)
    .setIssuedAt()
    .setExpirationTime(CLIENT_SECRET_TTL)
    .setAudience(APPLE_AUD)
    .setSubject(clientId)
    .sign(key);
}

let secretPromise = null;

/**
 * Memoized env-backed signer. Returns a Promise resolving to the JWT string
 * Auth.js hands Apple as clientSecret. On a signing failure the cache is
 * cleared so a later request can retry rather than serving a poisoned
 * rejected promise for the instance's whole life.
 */
export function getAppleClientSecret() {
  if (!secretPromise) {
    secretPromise = signAppleClientSecret({
      teamId: process.env.APPLE_TEAM_ID,
      keyId: process.env.APPLE_KEY_ID,
      clientId: process.env.APPLE_CLIENT_ID,
      privateKeyPem: process.env.APPLE_PRIVATE_KEY,
    }).catch((err) => {
      secretPromise = null;
      throw err;
    });
  }
  return secretPromise;
}
