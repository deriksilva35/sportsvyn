-- ============================================================================
-- Migration 052 — sync_runs (durable home for gridiron poller run summaries)
-- ============================================================================
-- The standing NFL/CFB ingest pollers (Vercel crons) record every tick here:
--   · run summaries (jsonb) — was ephemeral stdout, now durable
--   · "last ok baseline/games run" lookups (smart-tick cadence)
--   · alert rate-limit markers (kind='alert')
--   · CFBD budget ground truth (x-calllimit-remaining captured into summary)
--
-- source: the sync stream, e.g. 'nfl-games' | 'cfb-games' | 'nfl-stats' |
--         'gridiron-teams'. kind: 'live-poll' | 'baseline' | 'noop' |
--         'skipped-locked' | 'teams' | 'stats' | 'alert'.
-- Reversible: DROP TABLE sync_runs.
-- ============================================================================

CREATE TABLE sync_runs (
  id          serial      PRIMARY KEY,
  source      text        NOT NULL,
  kind        text        NOT NULL,
  started_at  timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  ok          boolean     NOT NULL DEFAULT false,
  summary     jsonb,
  error       text
);

-- Covers both the "last ok run for a source" cadence lookup and the
-- per-source alert-marker (kind='alert') rate-limit lookup.
CREATE INDEX idx_sync_runs_source_kind ON sync_runs (source, kind, started_at DESC);
