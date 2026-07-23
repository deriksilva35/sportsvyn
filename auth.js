/**
 * auth.js — Auth.js v5 (next-auth@beta) configuration.
 *
 * Magic-link passwordless authentication via Resend. Users + sessions
 * persist to our own Neon Postgres (the four adapter tables created in
 * migration 026). Database session strategy (the adapter's default —
 * NOT overridden here on purpose).
 *
 * Function-form export so the Neon Pool is created PER-INVOCATION. The
 * `@neondatabase/serverless` Pool uses WebSockets that do not survive
 * across serverless invocations on Vercel Fluid Compute — a
 * module-level singleton would be wrong. The `() => ({...})` form
 * ensures NextAuth calls the factory each request and we get a fresh
 * Pool tied to that request's lifecycle.
 *
 * trustHost: true — required for Next.js App Router deployments
 * (sets the assumed host from request headers instead of needing an
 * AUTH_URL env var). Standard for Vercel-deployed Auth.js v5.
 *
 * Route protection: NOT via proxy.js. Auth checks run at the
 * server-route layer (page / route handler / Server Action) per
 * CVE-2025-29927 — proxy.js's existing admin Basic Auth gate is
 * independent and untouched.
 */

import NextAuth from 'next-auth';
import PostgresAdapter from '@auth/pg-adapter';
import { Pool } from '@neondatabase/serverless';
import Resend from 'next-auth/providers/resend';
import Apple from 'next-auth/providers/apple';
import { resend, EMAIL_FROM, EMAIL_REPLY_TO } from '@/lib/resend';
import { buildMagicLinkEmail } from '@/lib/emails/magicLink';
import { appleConfigured, getAppleClientSecret } from '@/lib/auth/appleClientSecret';
import { sql } from '@/lib/db';
import { generateCode, sha256, attachCode, CODE_TTL_SECONDS } from '@/lib/auth/emailOtp';

// Async factory: Apple's clientSecret is a signed JWT we mint at config
// time (getAppleClientSecret is memoized, so this awaits real work only on
// the instance's first request). Every Auth.js call site already awaits this
// factory, so returning a Promise here is supported. The Neon Pool stays
// per-invocation for the reason documented above.
export const { handlers, auth, signIn, signOut } = NextAuth(async () => {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });

  const providers = [
    Resend({
      apiKey: process.env.RESEND_API_KEY,
      from: EMAIL_FROM,
      // 10-minute token TTL — shared by the magic link AND the 6-digit code
      // (they are the same verification token). Down from Auth.js's 24h default.
      maxAge: CODE_TTL_SECONDS,
      // Overriding sendVerificationRequest replaces Auth.js's default
      // fetch('https://api.resend.com/emails', ...) entirely. We route
      // through the existing lib/resend.js client so the magic-link
      // email shares the same Resend account, replyTo, and house template
      // shell (see lib/emails/magicLink.js) as the homepage signup
      // confirmation. apiKey above remains set because the provider
      // type definition declares it required even when sendVerification-
      // Request is overridden.
      //
      // Additional redemption path: a 6-digit code bound to THIS token. We
      // store its hash (and token_hash = sha256(rawToken+AUTH_SECRET), which
      // equals verification_token.token) in email_otp, independent of the
      // adapter's token insert. lib/auth/emailOtp.js verifies + consumes it.
      async sendVerificationRequest({ identifier, url, token, expires }) {
        const secret = process.env.AUTH_SECRET;
        const code = generateCode();
        await attachCode(sql, {
          identifier,
          tokenHash: sha256(token, secret),
          codeHash: sha256(code, secret),
          expires,
        });
        const { subject, html, text } = buildMagicLinkEmail({ url, identifier, code });
        await resend.emails.send({
          from: EMAIL_FROM,
          to: identifier,
          replyTo: EMAIL_REPLY_TO,
          subject,
          html,
          text,
        });
      },
    }),
  ];

  // Sign in with Apple, added only when all four Apple env vars are present
  // (a preview deploy without them still serves magic-link sign-in).
  //
  // allowDangerousEmailAccountLinking: someone who first signed in via magic
  // link, then chooses Apple with the SAME email, must land on their existing
  // user row rather than hitting OAuthAccountNotLinked. Auth.js's default
  // refuses cross-provider linking when not already signed in because a
  // provider might assert an unverified email; here that risk does not apply —
  // Apple verifies the address, and the magic-link account already proved the
  // person controls that inbox. So linking by verified email is safe, and the
  // adapter attaches the Apple account to the matched user (handle-login.js).
  //
  // Private-relay addresses (user chose Hide My Email) are just a normal new
  // email: no existing row matches, so a fresh user is created with the relay
  // address, which is the intended outcome. Apple returns the person's name
  // only on first consent; the provider's profile() falls back to the email
  // for the display name on every subsequent sign-in.
  if (appleConfigured()) {
    try {
      const clientSecret = await getAppleClientSecret();
      providers.push(
        Apple({
          clientId: process.env.APPLE_CLIENT_ID,
          clientSecret,
          allowDangerousEmailAccountLinking: true,
        }),
      );
    } catch (err) {
      // A bad/mis-stored Apple key must not take down the whole auth config
      // (magic-link sign-in shares it). Omit Apple, log, keep serving email.
      console.error(
        '[auth] Sign in with Apple disabled — client secret signing failed:',
        err?.message,
      );
    }
  }

  return {
    adapter: PostgresAdapter(pool),
    pages: {
      // Custom branded surfaces. signIn replaces the default
      // /api/auth/signin HTML card; verifyRequest is the post-submit
      // "check your email" landing; error folds the SignInPageErrorParam
      // back into our own signin form's aria-live row instead of using
      // a separate /error route. The wire endpoints
      // (/api/auth/signin/resend, /api/auth/callback/resend) remain
      // functional — pages: only retargets the UI shell, not the API.
      signIn: '/signin',
      verifyRequest: '/signin/check-email',
      error: '/signin',
    },
    providers,
    trustHost: true,
    // Apple returns its OAuth result via a cross-site POST (response_mode=
    // form_post). Auth.js already relaxes the state + nonce cookies to
    // SameSite=None for form_post providers so the sign-in itself survives the
    // cross-site callback — but it leaves the callback-url cookie at
    // SameSite=Lax, so the browser drops it on Apple's POST and the finished
    // sign-in falls back to '/' instead of the user's callbackUrl (in the
    // Draftvyn shell: stranded on the homepage instead of /sim). Magic-link is
    // unaffected — its callback is a same-site GET, so the Lax cookie rides
    // along. Relax ONLY the callback-url cookie to None+Secure (deep-merged
    // onto the default, so the __Secure- name and httpOnly stay intact) so the
    // stored callbackUrl (e.g. /sim, or /sim?shell=sim-app) survives Apple's
    // round trip and reaches the redirect callback. CSRF is still guarded by
    // the untouched csrf-token + state cookies. Production only: SameSite=None
    // requires Secure, which can't be set over local http, and Apple sign-in
    // only runs on HTTPS anyway (local dev signs in with the magic link, which
    // stays same-site + Lax).
    ...(process.env.NODE_ENV === 'production'
      ? {
          cookies: {
            callbackUrl: {
              options: { sameSite: 'none', secure: true },
            },
          },
        }
      : {}),
  };
});
