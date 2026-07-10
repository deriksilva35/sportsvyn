-- ============================================================================
-- Migration 043 - allow article type 'feature'
-- ============================================================================
-- Published topic drafts land in articles as type 'feature' (semantic h2/p body,
-- author Sportsvyn, AI-draft provenance). The existing articles_type_check did
-- not include 'feature', so the publish path was blocked. Drop and re-add the
-- constraint with 'feature' appended; the other values are unchanged.
-- ============================================================================

ALTER TABLE articles DROP CONSTRAINT articles_type_check;

ALTER TABLE articles ADD CONSTRAINT articles_type_check
  CHECK (type = ANY (ARRAY[
    'recap', 'preview', 'profile', 'rankings', 'edge', 'essay', 'newsletter', 'feature'
  ]::text[]));
