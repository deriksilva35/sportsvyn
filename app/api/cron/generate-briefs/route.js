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
 */

import { sql } from '@/lib/db';
import { generateBriefFromDb } from '@/lib/aiBrief';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const PER_SWEEP_CAP = 5;

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
     WHERE m.status = 'final'
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
