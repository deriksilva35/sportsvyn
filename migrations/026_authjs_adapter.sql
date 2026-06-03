-- ============================================================================
-- Migration 026 — Auth.js v5 PostgreSQL adapter tables
-- ============================================================================
-- Canonical DDL from @auth/pg-adapter (authjs.dev/getting-started/adapters/pg),
-- cross-verified against the adapter's own query strings in
-- node_modules/@auth/pg-adapter/index.js. The adapter binds to these
-- table + column names by EXACT match — camelCase columns ("userId",
-- "emailVerified", "providerAccountId", "sessionToken") MUST be created
-- with their double-quoted form, because Postgres lowercases unquoted
-- identifiers and the adapter's queries quote them.
--
-- Session strategy: database (the adapter's default — we do NOT override
-- session.strategy in auth.js). Sessions land in the `sessions` table;
-- magic-link verification flow lands transient rows in `verification_token`
-- (consumed on successful click).
--
-- Route protection: NOT via proxy.js — auth checks run at the server-route
-- layer (page / route handler / Server Action) per CVE-2025-29927.
-- proxy.js's existing admin Basic Auth gate is independent and untouched.
-- ============================================================================

CREATE TABLE verification_token
(
  identifier TEXT NOT NULL,
  expires TIMESTAMPTZ NOT NULL,
  token TEXT NOT NULL,

  PRIMARY KEY (identifier, token)
);

CREATE TABLE accounts
(
  id SERIAL,
  "userId" INTEGER NOT NULL,
  type VARCHAR(255) NOT NULL,
  provider VARCHAR(255) NOT NULL,
  "providerAccountId" VARCHAR(255) NOT NULL,
  refresh_token TEXT,
  access_token TEXT,
  expires_at BIGINT,
  id_token TEXT,
  scope TEXT,
  session_state TEXT,
  token_type TEXT,

  PRIMARY KEY (id)
);

CREATE TABLE sessions
(
  id SERIAL,
  "userId" INTEGER NOT NULL,
  expires TIMESTAMPTZ NOT NULL,
  "sessionToken" VARCHAR(255) NOT NULL,

  PRIMARY KEY (id)
);

CREATE TABLE users
(
  id SERIAL,
  name VARCHAR(255),
  email VARCHAR(255),
  "emailVerified" TIMESTAMPTZ,
  image TEXT,

  PRIMARY KEY (id)
);
