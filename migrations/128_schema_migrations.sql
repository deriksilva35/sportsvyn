-- 128_schema_migrations.sql - THE MIGRATION LEDGER (sun-18 item 4).
--
-- NUMBER 128 IS PROVISIONAL. It is (highest file + 1) as the tree will stand
-- after Tuesday's stack: signin-rate-limit brings 126_auth_throttle and
-- ties-everywhere brings 127_contest_entries_submitted_at. If that changes,
-- rename this file to the right number; nothing else needs to move, because
-- lib/migrations/ledger.mjs finds it by its *_schema_migrations.sql suffix.
--
-- One row per numbered migration a database has had:
--   number      the file's number; the PRIMARY KEY is what makes a second
--               apply of one number (a race, or a duplicate file) fail.
--   name        the file name (081 is "081_news_items.sql + 081_news_feeds_seed.sql",
--               the one grandfathered two-file number).
--   checksum    sha256 (hex) of the file bytes. A file whose bytes no longer
--               match is REFUSED by scripts/apply-migrations.mjs.
--   applied_at  when it ran. NULL for rows written by the one-time backfill
--               (scripts/migrations-backfill.mjs): those migrations ran before
--               the ledger existed and nobody recorded when.
--   applied_by  who ran it (os user@host of the apply script), when known.
--   ledgered_at when this row was written.
--   note        'backfilled ...' for backfilled rows, else NULL.
--
-- BOOTSTRAP: the apply script creates this table by applying THIS FILE when
-- the table is absent, in one transaction with this file's own ledger row -
-- so the DDL lives here and nowhere else. IF NOT EXISTS keeps a re-run inert.
-- Additive; reversible by DROP TABLE schema_migrations.

CREATE TABLE IF NOT EXISTS schema_migrations (
  number      integer     PRIMARY KEY,
  name        text        NOT NULL,
  checksum    text        NOT NULL CHECK (checksum ~ '^[0-9a-f]{64}$'),
  applied_at  timestamptz,
  applied_by  text,
  ledgered_at timestamptz NOT NULL DEFAULT now(),
  note        text
);

COMMENT ON TABLE schema_migrations IS 'Migration ledger: one row per numbered migrations/NNN_*.sql applied to this database. Written by scripts/apply-migrations.mjs (and once by scripts/migrations-backfill.mjs, applied_at NULL). checksum = sha256 of the file bytes; a changed file is refused.';
