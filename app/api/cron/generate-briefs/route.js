/**
 * /api/cron/generate-briefs — Tier 1 auto-brief sweep cron.
 *
 * Schedule: every 2 minutes (vercel.json).
 * Auth: Bearer ${CRON_SECRET}, same shape as poll-live + refresh-odds + poll-lineups.
 *
 * Candidate predicate:
 *   matches.status='final'
 *   AND kickoff_at > now() - 6h          (no retroactive briefing on first deploy)
 *   AND NOT EXISTS auto-brief row        (idempotent self-healing)
 *   ORDER BY kickoff_at DESC
 *   LIMIT 5                              (per-sweep cap; bad day can't fan out)
 *
 * For each candidate:
 *   1. generateBriefFromDb reads is_current=true events/lineups/stats + matches
 *      → assembles envelope → two Anthropic attempts gated by aiBrief.js's
 *      5 validation gates → fallback to deterministic template if both fail.
 *      A renderable row is always produced (validation_status='passed' or
 *      'fallback').
 *   2. INSERT ... ON CONFLICT DO NOTHING into match_briefs. The conflict
 *      target is the partial unique index from migration 024
 *      (idx_match_briefs_one_auto_per_match) — exactly-once even under
 *      racing sweeps.
 *   3. Per-match try/catch: a hard error (timeout, etc.) on one fixture
 *      cannot abort the rest. The errored match stays in the candidate set
 *      and gets retried on the next sweep.
 *
 * Tier-1-only contract (spec brand-safety commitment #2):
 *   - Imports ONLY generateBriefFromDb from lib/aiBrief.js.
 *   - Writes ONLY to match_briefs.
 *   - Zero references to match_drafts, aiDraft, Tavily, or any editorial
 *     coverage flag. Tier 2 has its own separate cron path (not built).
 *
 * LEAGUE ALLOWLIST. The candidate predicate had no league filter, which was
 * correct while `matches` held nothing but soccer and became a live hazard the
 * moment it did not. PROD now carries 285 final NFL games and 934 final CFB
 * games, and a full 2026 schedule on top; the first real gridiron kickoff (CFB
 * Week 0, Aug 29) would put a football game inside the 6-hour window and this
 * cron would brief it within two minutes.
 *
 * It would not crash - aiBrief always produces a renderable row - and that is
 * the problem. assembleEnvelopeFromDb reads match_events, match_lineups and
 * match_statistics, which have ZERO gridiron rows, so the model would receive a
 * score, two team names, and three empty arrays, and the deterministic fallback
 * would write a brief with nothing in it. A thin brief that renders is worse
 * than no brief: it looks like coverage.
 *
 * The allowlist is explicit and positive rather than a "not nfl, not cfb"
 * exclusion, so a league added later is silently OUT until somebody decides it
 * is in. Gridiron briefs are a designed build for when live play-by-play exists
 * for those leagues, not something this sweep should back into.
 */

import { sql } from '@/lib/db';
import { generateBriefFromDb } from '@/lib/aiBrief';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const PER_SWEEP_CAP = 5;

// Every league whose matches carry the event/lineup/statistic rows the Tier 1
// envelope reads. Adding a slug here is a statement that its data exists.
export const BRIEF_LEAGUE_SLUGS = [
  'fifa-wc-2026',
  'international-friendlies',
  'concacaf-gold-cup',
  'africa-cup-of-nations',
];

export async function GET(request) {
  const authHeader = request.headers.get('authorization');
  if (
    !process.env.CRON_SECRET ||
    authHeader !== `Bearer ${process.env.CRON_SECRET}`
  ) {
    return new Response('Unauthorized', { status: 401 });
  }

  const candidates = await sql`
    SELECT m.id, m.slug
      FROM matches m
      JOIN leagues l ON l.id = m.league_id
     WHERE l.slug = ANY(${BRIEF_LEAGUE_SLUGS}::text[])
       AND m.status = 'final'
       AND m.kickoff_at > now() - interval '6 hours'
       AND NOT EXISTS (
         SELECT 1 FROM match_briefs b
          WHERE b.match_id = m.id AND b.kind = 'auto'
       )
     ORDER BY m.kickoff_at DESC
     LIMIT ${PER_SWEEP_CAP}
  `;

  const results = [];

  for (const m of candidates) {
    try {
      const brief = await generateBriefFromDb(m.id);

      const inserted = await sql`
        INSERT INTO match_briefs (
          match_id, kind,
          headline, paragraph_1, paragraph_2, paragraph_3,
          model, raw_response, validation_status, published_at
        ) VALUES (
          ${m.id}, 'auto',
          ${brief.headline}, ${brief.paragraph_1}, ${brief.paragraph_2}, ${brief.paragraph_3},
          ${brief.model},
          ${brief.raw_response ? JSON.stringify(brief.raw_response) : null}::jsonb,
          ${brief.validation_status},
          now()
        )
        ON CONFLICT (match_id) WHERE kind = 'auto' DO NOTHING
        RETURNING id, validation_status
      `;

      if (inserted[0]) {
        results.push({
          match_id: m.id,
          slug: m.slug,
          outcome: 'inserted',
          brief_id: inserted[0].id,
          validation_status: inserted[0].validation_status,
        });
      } else {
        // Race: another sweep beat us between the candidate SELECT and the
        // INSERT. Partial unique index rejected the duplicate. Not an error.
        results.push({
          match_id: m.id,
          slug: m.slug,
          outcome: 'skipped-conflict',
        });
      }
    } catch (err) {
      console.error(
        `generate-briefs: match ${m.id} (${m.slug}) failed —`,
        err,
      );
      results.push({
        match_id: m.id,
        slug: m.slug,
        outcome: 'error',
        error: String(err?.message ?? err),
      });
    }
  }

  return Response.json({
    candidates: candidates.length,
    inserted: results.filter((r) => r.outcome === 'inserted').length,
    skipped_conflict: results.filter((r) => r.outcome === 'skipped-conflict').length,
    errors: results.filter((r) => r.outcome === 'error').length,
    results,
  });
}
