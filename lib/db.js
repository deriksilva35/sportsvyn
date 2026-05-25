/**
 * lib/db.js — Neon Postgres client.
 *
 * Exposes a `sql` tagged-template helper backed by Neon's HTTP driver.
 * Queries run as one-shot HTTPS fetch requests — there is no connection
 * pool to open, manage, or close, which suits Vercel Fluid Compute /
 * serverless execution.
 *
 * Interpolated values (sql`... ${x} ...`) are sent as bound parameters,
 * not string-concatenated — safe from SQL injection.
 *
 * Scope (Phase 0): single-statement queries only. Interactive,
 * multi-statement transactions (Neon `Pool` / `Client` over WebSockets)
 * are deferred to Phase 1 if a flow needs them.
 */

import { neon } from '@neondatabase/serverless';

if (!process.env.DATABASE_URL) {
  throw new Error('DATABASE_URL not set in environment');
}

export const sql = neon(process.env.DATABASE_URL);
