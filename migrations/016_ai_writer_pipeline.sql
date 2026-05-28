-- ============================================================================
-- Migration 016 — AI Writer Pipeline (prompt templates + generation log)
-- ============================================================================
-- Purpose: Versioned prompt templates and a generation log for the AI Writer
--          Pipeline (Tier 1 Brief + Tier 2 Draft). Powers reproducibility,
--          debugging, editor review workflow, and prompt iteration tracking.
-- Powers:  - AI Writer Pipeline operational backbone (per spec May 27 2026)
--          - 7 locked prompt templates: match_brief, match_draft, rankings_
--            blurb, top_5_editorial, stats_framing, team_outlook, player_
--            outlook
--          - Editor review CMS (pending_review queue + approval/rejection)
--          - Voice Bible versioning cascade
-- ============================================================================

-- Versioned prompt templates
CREATE TABLE ai_prompt_templates (
  id              serial PRIMARY KEY,
  slug            text NOT NULL,                            -- 'team_outlook' | 'player_outlook' | 'match_brief' | 'match_draft' | 'rankings_blurb' | 'top_5_editorial' | 'stats_framing'
  version         text NOT NULL,                            -- '1.0', '1.0.1', '1.1', etc.

  -- Tier classification
  tier            text NOT NULL CHECK (tier IN ('tier_1_brief', 'tier_2_draft')),

  -- Prompt content
  system_prompt   text NOT NULL,                            -- The Sportsvyn voice + sport-specific rules + banned constructions
  user_prompt_template text NOT NULL,                       -- Templated with placeholder vars: {{team_name}}, {{recent_results}}, etc.

  -- Configuration
  model           text NOT NULL DEFAULT 'claude-sonnet-4-20250514',
  max_tokens      integer NOT NULL DEFAULT 1500,
  temperature     numeric(3,2) DEFAULT 0.7,

  -- Sport scope
  sport           text,                                     -- 'soccer' | 'nfl' | 'nba' | 'mlb' | NULL (universal)

  -- Voice Bible binding
  voice_model_version text NOT NULL DEFAULT '1.0',          -- which Voice Bible version this prompt assumes

  -- Lifecycle
  is_active       boolean NOT NULL DEFAULT true,
  superseded_by   integer REFERENCES ai_prompt_templates(id),

  -- Author + dates
  created_by      text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  activated_at    timestamptz,
  deprecated_at   timestamptz,

  UNIQUE (slug, version, sport)
);

CREATE INDEX idx_ai_prompt_templates_active ON ai_prompt_templates(slug, sport, is_active) WHERE is_active = true;
CREATE INDEX idx_ai_prompt_templates_tier ON ai_prompt_templates(tier);

-- Only one active version per (slug, sport)
CREATE UNIQUE INDEX idx_ai_prompt_templates_one_active
  ON ai_prompt_templates(slug, COALESCE(sport, '_universal'))
  WHERE is_active = true;

COMMENT ON TABLE ai_prompt_templates IS 'Versioned prompt templates per the AI Writer Pipeline spec May 27 2026. 7 templates locked: 5 universal (match_brief, match_draft, rankings_blurb, top_5_editorial, stats_framing) and 2 added in the design session (team_outlook, player_outlook). Sport-specific overrides bind to soccer/nfl/nba/mlb when written.';
COMMENT ON COLUMN ai_prompt_templates.voice_model_version IS 'The Voice Bible version this prompt was authored against. When the Voice Bible bumps to v1.1, all active prompts are flagged for review/republication. Shows in the "v1.0 voice model" byline on generated content.';


-- Generation log (one row per Anthropic API call)
CREATE TABLE ai_generations (
  id                    serial PRIMARY KEY,
  prompt_template_id    integer NOT NULL REFERENCES ai_prompt_templates(id),

  -- What was produced (polymorphic loose ref)
  target_type           text NOT NULL CHECK (target_type IN ('editorial_blurb', 'article', 'match_brief')),
  target_id             integer,                            -- editorial_blurbs.id, articles.id, etc.

  -- Input
  input_data            jsonb NOT NULL,                     -- raw input fed to template
  resolved_user_prompt  text NOT NULL,                      -- fully-resolved prompt sent to API
  resolved_system_prompt text,                              -- system prompt at time of call (in case template changed)

  -- Output
  raw_response          text,                               -- raw API response body
  parsed_output         jsonb,                              -- structured output extracted

  -- Performance / cost
  model                 text NOT NULL,
  input_tokens          integer,
  output_tokens         integer,
  total_tokens          integer GENERATED ALWAYS AS (COALESCE(input_tokens, 0) + COALESCE(output_tokens, 0)) STORED,
  duration_ms           integer,
  estimated_cost_usd    numeric(8,4),

  -- API metadata
  api_request_id        text,                               -- Anthropic's request ID for debugging
  api_stop_reason       text,                               -- 'end_turn' | 'max_tokens' | 'stop_sequence'

  -- Outcome
  status                text NOT NULL DEFAULT 'success' CHECK (status IN (
    'success',
    'api_error',
    'validation_failed',                                    -- generated text failed voice lint or schema check
    'rate_limited'
  )),
  error_message         text,
  validation_errors     jsonb,                              -- voice lint findings, banned constructions etc.

  -- Editor decision (mirrors editorial_blurbs.status for non-blurb generations)
  editor_action         text CHECK (editor_action IN ('pending', 'approved', 'rejected', 'auto_published')),
  editor_action_at      timestamptz,
  editor_action_by      text,
  editor_notes          text,

  created_at            timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_ai_generations_template ON ai_generations(prompt_template_id, created_at DESC);
CREATE INDEX idx_ai_generations_target ON ai_generations(target_type, target_id);
CREATE INDEX idx_ai_generations_pending ON ai_generations(editor_action, created_at DESC) WHERE editor_action = 'pending';
CREATE INDEX idx_ai_generations_status_errors ON ai_generations(status, created_at DESC) WHERE status != 'success';
CREATE INDEX idx_ai_generations_cost ON ai_generations(created_at DESC, estimated_cost_usd) WHERE estimated_cost_usd IS NOT NULL;

COMMENT ON TABLE ai_generations IS 'One row per Anthropic API call. Captures full input/output for reproducibility, cost tracking, debugging, and editor review. The pending_review queue in admin CMS is driven by editor_action = ''pending''.';
COMMENT ON COLUMN ai_generations.input_data IS 'Snapshot of the data fed to the prompt template (e.g., match events, team form, player stats). Stored verbatim so we can regenerate the exact same prompt later for debugging.';
COMMENT ON COLUMN ai_generations.validation_errors IS 'Output of the voiceLint.js check. Findings like "uses banned construction" or "missing required composite score" appear here. Status becomes ''validation_failed'' if non-empty.';


-- Cross-reference: editorial_blurbs.prompt_template_id → ai_prompt_templates
ALTER TABLE editorial_blurbs
  ADD CONSTRAINT fk_editorial_blurbs_prompt
  FOREIGN KEY (prompt_template_id) REFERENCES ai_prompt_templates(id) ON DELETE SET NULL;


-- Seed the 7 locked prompt template slugs (system_prompt and user_prompt_template
-- are placeholders here; actual prompts live in the Prompt Library v1.0 doc and
-- are inserted/updated by the application during deployment).
INSERT INTO ai_prompt_templates (slug, version, tier, system_prompt, user_prompt_template, sport, created_by) VALUES
  ('match_brief',      '1.0', 'tier_1_brief', '-- See sportsvyn-ai-writer-prompt-library-v1.md', '-- placeholder', NULL, 'design-session-2026-05-27'),
  ('match_draft',      '1.0', 'tier_2_draft', '-- See sportsvyn-ai-writer-prompt-library-v1.md', '-- placeholder', NULL, 'design-session-2026-05-27'),
  ('rankings_blurb',   '1.0', 'tier_2_draft', '-- See sportsvyn-ai-writer-prompt-library-v1.md', '-- placeholder', NULL, 'design-session-2026-05-27'),
  ('top_5_editorial',  '1.0', 'tier_2_draft', '-- See sportsvyn-ai-writer-prompt-library-v1.md', '-- placeholder', NULL, 'design-session-2026-05-27'),
  ('stats_framing',    '1.0', 'tier_2_draft', '-- See sportsvyn-ai-writer-prompt-library-v1.md', '-- placeholder', NULL, 'design-session-2026-05-27'),
  ('team_outlook',     '1.0', 'tier_2_draft', '-- See sportsvyn-ai-writer-prompt-library-v1.md', '-- placeholder', NULL, 'design-session-2026-05-27'),
  ('player_outlook',   '1.0', 'tier_2_draft', '-- See sportsvyn-ai-writer-prompt-library-v1.md', '-- placeholder', NULL, 'design-session-2026-05-27');
