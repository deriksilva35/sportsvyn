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
import { resend, EMAIL_FROM, EMAIL_REPLY_TO } from '@/lib/resend';
import { buildMagicLinkEmail } from '@/lib/emails/magicLink';

export const { handlers, auth, signIn, signOut } = NextAuth(() => {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
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
    providers: [
      Resend({
        apiKey: process.env.RESEND_API_KEY,
        from: EMAIL_FROM,
        // Overriding sendVerificationRequest replaces Auth.js's default
        // fetch('https://api.resend.com/emails', ...) entirely. We route
        // through the existing lib/resend.js client so the magic-link
        // email shares the same Resend account, replyTo, and house template
        // shell (see lib/emails/magicLink.js) as the homepage signup
        // confirmation. apiKey above remains set because the provider
        // type definition declares it required even when sendVerification-
        // Request is overridden.
        async sendVerificationRequest({ identifier, url }) {
          const { subject, html, text } = buildMagicLinkEmail({ url, identifier });
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
    ],
    trustHost: true,
  };
});
