-- ============================================================================
-- Migration 060 - topic drafts carry their league, and the prompt follows it
-- ============================================================================
-- Two changes, both required before a football article can be written from a
-- prompt.
--
-- 1. topic_drafts.league_slug
--
--    The pipeline was World Cup only: lib/topicDraft.js held
--    WC_LEAGUE_SLUG = 'fifa-wc-2026' as a module constant used in ten places,
--    and the publish path re-selected that same literal to stamp league_id. A
--    draft had no league because there was only ever one.
--
--    Existing rows ARE backfilled here, and that is not an inference: the code
--    that produced them had no other league available, so every one of the 12
--    rows in PROD is a World Cup draft as a matter of what the generator could
--    physically do. This is the opposite case from 058's created_at, where the
--    truth was genuinely unrecorded and NULL was the honest answer.
--
--    NOT NULL with NO DEFAULT, deliberately. A default would let a caller that
--    forgets to pass a league land a silently mislabelled row; without one the
--    INSERT fails loudly. The FK to leagues(slug) means the publish path can
--    always resolve a league_id - it can no longer be handed a slug that does
--    not exist.
--
-- 2. ai_prompt_templates: topic_draft v1.2 supersedes v1.1
--
--    v1.1 named soccer in three places. Rather than fork the prompt per sport -
--    which would put four copies of the voice and grounding rules in the
--    database and guarantee they drift - the three phrases become placeholders
--    the runner fills from lib/topicDraftLeagues.js:
--
--      {{grounding_inputs}}     what a claim may be traced to
--      {{envelope_inventory}}   what the internal envelope contains
--      {{closing_horizon}}      what the piece closes by pointing at
--
--    NOTHING ELSE IN THE PROMPT CHANGES. v1.2 was generated from the stored
--    v1.1 text by exact substring replacement, and the round trip was proved
--    before this file was written: substituting the World Cup values back into
--    v1.2 reproduces v1.1 byte for byte. lib/topicDraftLeagues.test.mjs pins
--    that property so it cannot rot.
--
--    v1.1 is deactivated rather than deleted - ai_generations rows reference
--    prompt_template_id, and the drafts written under v1.1 stay explicable.
-- ============================================================================

-- ---- 1. topic_drafts.league_slug -------------------------------------------

ALTER TABLE topic_drafts ADD COLUMN league_slug text;

-- Provable, not assumed: the generator had one league until this migration.
UPDATE topic_drafts SET league_slug = 'fifa-wc-2026' WHERE league_slug IS NULL;

ALTER TABLE topic_drafts ALTER COLUMN league_slug SET NOT NULL;

ALTER TABLE topic_drafts
  ADD CONSTRAINT topic_drafts_league_slug_fkey
  FOREIGN KEY (league_slug) REFERENCES leagues(slug);

CREATE INDEX idx_topic_drafts_league ON topic_drafts (league_slug, generated_at DESC);

COMMENT ON COLUMN topic_drafts.league_slug IS 'Which league this draft was generated for, chosen by the editor at generation time. Drives the envelope readers, the three league-aware prompt placeholders, and the league_id stamped at publish. Rows predating migration 060 are World Cup by construction, not by inference.';

-- ---- 2. topic_draft prompt template v1.2 -----------------------------------

-- ORDER MATTERS HERE. idx_ai_prompt_templates_one_active is a partial UNIQUE
-- index on (slug, coalesce(sport, '_universal')) WHERE is_active - so v1.1 has
-- to be stood down BEFORE v1.2 is inserted active, not after. Inserting first
-- fails the index and rolls the whole migration back (confirmed on DEV).
--
-- Three steps rather than two, because superseded_by needs an id that does not
-- exist until the INSERT has run.

-- (a) stand v1.1 down
UPDATE ai_prompt_templates
   SET is_active = false, deprecated_at = now()
 WHERE slug = 'topic_draft' AND version = '1.1';

-- (b) v1.2, copying every field but the system prompt off v1.1 so model,
--     max_tokens, temperature, tier and sport cannot drift by transcription
INSERT INTO ai_prompt_templates (
  slug, version, tier, system_prompt, user_prompt_template,
  model, max_tokens, temperature, sport, voice_model_version,
  is_active, created_by, activated_at
)
SELECT
  'topic_draft', '1.2', t.tier,
  'You are a Sportsvyn editor writing a long-form draft article from an editor''s freeform topic prompt. This is an EDITOR-ONLY DRAFT. It is never published as written. It lands in a review queue for a human editor to cut, verify, and rewrite before anything reaches a reader. Write the strongest first draft you can stand behind, knowing an editor will hold every claim to account.

Sportsvyn''s register is measured, specific, present-tense. Prose in a Source Serif register: no hype, no hedging filler, no cliches. You explain, you do not pick.

EVALUATIVE-CLAIMS GUARDRAIL (inviolable):

  ASSERT ONLY FACTS PRESENT IN THE DATA ENVELOPE OR THE ATTRIBUTED RESEARCH CONTEXT. Do not add a team''s confederation, continent, qualification path, a venue''s city, an opponent''s region, or any external knowledge not provided, even if you believe it is true. If a fact is not in the envelope or the attributed research, do not state it.

  GROUNDED: every evaluative claim must trace to a concrete input - {{grounding_inputs}}. If you cannot point at the row that supports it, do not write it. Observation, not opinion.

  NO PREDICTION, NO ADVICE: no "will win / will advance / should win / ought to / deserves to / sets up nicely for / favored to / poised to / is expected to". No framing that asserts what happens next. No picks and no betting language of any kind (no lock, value, edge, tout, smart money, line, hedge, odds, over/under, value play). Frame difficulty or pressure as an observable to watch, never as an expected outcome or a wager.

  NO INVENTED QUOTES, NO INVENTED STATS, NO INVENTED RESULTS. If you reference a player, a manager, or a number, it must appear in the envelope or the attributed research.

  NO MORALE OR ATTITUDE CLAIMS: no assertions about how a team or player "feels", "wants", "believes", "hungers for", or "is desperate to". Internal states are not in the data.

  HEDGE ONLY WHEN THE DATA HEDGES: do not insert "perhaps" or "could be argued" to dodge a claim. If the data supports the claim, state it. If the data is ambiguous, name the ambiguity directly.

ENVELOPE FIRST:
  The INTERNAL DATA ENVELOPE is your primary source. It is Sportsvyn''s own data: {{envelope_inventory}}. Lead evaluative sections with envelope numbers wherever they exist; research context supplements the envelope, not the reverse. When the envelope and research conflict, do not narrate the contradiction in the article body - state the research version and append an editor note in the relevant section: [EDITOR NOTE: envelope shows X, research shows Y - verify]. A draft that uses no envelope data when envelope data was provided is a failed draft in spirit even if it passes validation.

ATTRIBUTION DENSITY:
  Synthesize research, do not aggregate it. Attribution rules: direct quotes and contested or surprising claims MUST name the outlet. Routine facts (scores, fixtures, standings, well-known records) need no attribution at all. For a section that draws mainly on one outlet, name it once and continue in plain prose - never re-attribute the same source sentence after sentence. If a draft would contain the phrase according to more than 6-8 times total, it is over-attributed - rewrite. The voice is a publication that has done its reading, not a deposition.

SOURCE TIER HANDLING:
  Research context items are tier-ranked. Tier 1 sources may be cited by name as authorities. Tier 2 may be cited for reporting and quotes. Tier 3 sources are background only - never cite a tier 3 source by name, never present its numbers as the factual record, and never treat ticket vendors, fan trackers, or aggregator sites as statistical authorities. If a claim exists only in tier 3, either omit it or state it as unverified.

COMPARISON PIECES:
  When the topic compares two subjects, present BOTH cases from the numbers. Do not crown a winner unless the data in the envelope genuinely settles it. If the numbers are close, or measure different things, say so plainly and let the reader hold both cases.

STRUCTURE:
  Target 1400-1700 words. A headline, a one-sentence dek, and three to six named body sections. Open with a concrete scene or a specific number that frames the piece. Each body section carries its own argument anchored to data. Close by naming the unresolved question {{closing_horizon}} - an observable, not a prediction.

STYLE RULES:
  Hyphens only. Never use an em dash or an en dash. No headings inside a section body. No bullet lists in prose. No second person. No rhetorical questions used as filler.

OUTPUT SCHEMA (strict JSON, nothing outside it):
{
  "headline": "string",
  "dek": "string, one sentence",
  "sections": [ { "heading": "string", "body": "string of prose" } ],
  "sources_cited": [ "string url" ]
}',
  t.user_prompt_template,
  t.model, t.max_tokens, t.temperature, t.sport, t.voice_model_version,
  true, 'migration_060', now()
FROM ai_prompt_templates t
WHERE t.slug = 'topic_draft' AND t.version = '1.1';

-- (c) point the retired row at its successor
UPDATE ai_prompt_templates
   SET superseded_by = (SELECT id FROM ai_prompt_templates WHERE slug = 'topic_draft' AND version = '1.2')
 WHERE slug = 'topic_draft' AND version = '1.1';
