/**
 * /api/auth/[...nextauth] — Auth.js v5 catch-all route handler.
 *
 * Exports the GET/POST handlers from auth.js (which itself constructs
 * NextAuth with the Postgres adapter + Resend magic-link provider).
 *
 * Runtime: nodejs — the @auth/pg-adapter uses the `pg`-style query
 * interface and the @neondatabase/serverless Pool relies on Node's
 * WebSocket runtime. Edge runtime would not support either. Pinning
 * explicitly so a default flip in a future Next version can't silently
 * break the adapter path.
 */

import { handlers } from '@/auth';

export const { GET, POST } = handlers;
export const runtime = 'nodejs';
