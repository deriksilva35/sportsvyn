-- ============================================================================
-- Migration 013 — Match Broadcasters (Where to Watch)
-- ============================================================================
-- Purpose: Per-match per-country broadcaster data.
-- Powers:  - Where to Watch component (pre-match right rail, match card footer,
--            live banner inline) per the Phase 1 locked spec May 27 2026
--          - Homepage match card "Watch on" footer
--          - Team page Next Match Where to Watch
-- ============================================================================

CREATE TABLE match_broadcasters (
  id                      serial PRIMARY KEY,
  match_id                integer NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
  country_code            text NOT NULL,                 -- ISO 3166-1 alpha-2 (e.g., 'US', 'GB', 'AR', 'BR', 'JP')

  broadcaster_name        text NOT NULL,                 -- 'FOX' | 'Telemundo' | 'Peacock' | 'Tubi' | 'BBC One' | 'ITV'
  broadcaster_type        text NOT NULL CHECK (broadcaster_type IN ('tv', 'streaming', 'radio')),

  -- Display priority
  is_primary              boolean NOT NULL DEFAULT false, -- The primary broadcaster shown in volt
  display_order           integer NOT NULL DEFAULT 100,

  -- Optional deep link
  channel_url             text,                          -- Link to streaming service or channel guide
  channel_logo_url        text,                          -- Optional logo for richer display (Phase 1.5)

  -- Language for the broadcast (some countries have multiple language feeds)
  language_code           text,                          -- 'en' | 'es' | 'pt' etc.

  -- Provenance
  data_provider_synced_at timestamptz,
  created_at              timestamptz NOT NULL DEFAULT now(),
  updated_at              timestamptz NOT NULL DEFAULT now(),

  UNIQUE (match_id, country_code, broadcaster_name)
);

CREATE INDEX idx_match_broadcasters_match_country ON match_broadcasters(match_id, country_code, display_order);
CREATE INDEX idx_match_broadcasters_primary ON match_broadcasters(match_id, country_code) WHERE is_primary = true;

-- Ensure only one primary per (match, country)
CREATE UNIQUE INDEX idx_match_broadcasters_one_primary
  ON match_broadcasters(match_id, country_code)
  WHERE is_primary = true;

COMMENT ON TABLE match_broadcasters IS 'Where to watch a match in each country. Phase 1 US-only by spec; the country_code column is forward-compatible. Region selector in the Where to Watch component switches across these rows.';
COMMENT ON COLUMN match_broadcasters.is_primary IS 'The single primary broadcaster per (match, country). Renders in volt across all Where to Watch surfaces. Alternates render in muted/paper-warm.';
