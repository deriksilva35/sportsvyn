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
 *   - Imports ONLY brief generators (lib/aiBrief.js for soccer,
 *     lib/gridiron/gameBrief.js for the NFL).
 *   - Writes ONLY to match_briefs.
 *   - Zero references to match_drafts, aiDraft, Tavily, or any editorial
 *     coverage flag. Tier 2 has its own separate cron path (not built).
 *
 * LEAGUE ALLOWLIST. The candidate predicate had no league filter, which was
 * correct while `matches` held nothing but soccer and became a live hazard the
 * moment it did not. PROD carries 285 final NFL games and 934 final CFB games,
 * and a full 2026 schedule on top; the first real gridiron kickoff (CFB Week 0,
 * Aug 29) would put a football game inside the 6-hour window.
 *
 * It would not have crashed - aiBrief always produces a renderable row - and
 * that was the problem. assembleEnvelopeFromDb reads match_events,
 * match_lineups and match_statistics, which have ZERO gridiron rows, so the
 * model would have received a score, two team names, and three empty arrays,
 * and the deterministic fallback would have written a brief with nothing in it.
 * A thin brief that renders is worse than no brief: it looks like coverage.
 *
 * WHAT CHANGED FOR THE NFL: a gridiron envelope now exists, built from stored
 * scoring plays and player lines rather than from three empty soccer tables. So
 * 'nfl' joins the allowlist and gets routed to it. CFB does not - its feed
 * serves no scoring plays, so its envelope would still be the thin one.
 *
 * The allowlist stays explicit and positive rather than a "not cfb" exclusion,
 * so a league added later is silently OUT until somebody decides it is in.
 *
 * SEPARATELY GATED. GRIDIRON_BRIEFS_ENABLED must be '1' for a football game to
 * be a candidate at all. Shipping the code and turning the writer on are two
 * decisions, and only one of them is a deploy.
 */

import { sql } from '@/lib/db';
import { generateBriefFromDb } from '@/lib/aiBrief';
import { generateGameBrief } from '@/lib/gridiron/gameBrief';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const PER_SWEEP_CAP = 5;

// Every league whose matches carry the rows a Tier 1 envelope reads. Adding a
// slug here is a statement that its data exists.
//
// 'nfl' JOINS ON EVIDENCE, not on schedule. It reads a different envelope
// (lib/gridiron/gameBrief.js) built from gridiron_game_events and
// gridiron_player_lines - real scoring plays and real player lines, both proven
// against served preseason payloads.
//
// 'cfb' STAYS OUT. The college feed has no scoring-play source, so its envelope
// would be a score and two team names: the empty-brief failure this allowlist
// was created to prevent, on 934 final games.
export const BRIEF_LEAGUE_SLUGS = [
  'fifa-wc-2026',
  'international-friendlies',
  'concacaf-gold-cup',
  'africa-cup-of-nations',
  'nfl',
];

// Which envelope a league's games get. Soccer is the default because it is what
// every other slug above is.
const GRIDIRON_SLUGS = new Set(['nfl']);

// The enablement switch. Off by default: an unset variable must never mean
// "start writing", and the environment where this is first true is a decision
// somebody makes, not a side effect of a deploy.
const gridironBriefsEnabled = () => process.env.GRIDIRON_BRIEFS_ENABLED === '1';

/** The slugs eligible on THIS sweep, after the enablement switch. */
export function activeLeagueSlugs(enabled) {
  return enabled ? BRIEF_LEAGUE_SLUGS : BRIEF_LEAGUE_SLUGS.filter((s) => !GRIDIRON_SLUGS.has(s));
}

export async function GET(request) {
  const authHeader = request.headers.get('authorization');
  if (
    !process.env.CRON_SECRET ||
    authHeader !== `Bearer ${process.env.CRON_SECRET}`
  ) {
    return new Response('Unauthorized', { status: 401 });
  }

  const slugs = activeLeagueSlugs(gridironBriefsEnabled());

  const candidates = await sql`
    SELECT m.id, m.slug, l.slug AS league_slug
      FROM matches m
      JOIN leagues l ON l.id = m.league_id
     WHERE l.slug = ANY(${slugs}::text[])
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
      const brief = GRIDIRON_SLUGS.has(m.league_slug)
        ? await generateGameBrief(m.id)
        : await generateBriefFromDb(m.id);

      // A gridiron game whose detail fetch has not landed yet has no scoring
      // plays to describe. generateGameBrief returns null rather than briefing
      // a score, and the candidate stays in the set for the next sweep - which
      // is what happens for the few minutes between a game going final and its
      // final detail fetch.
      if (!brief) {
        results.push({ match_id: m.id, slug: m.slug, outcome: 'skipped-no-data' });
        continue;
      }

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
    skipped_no_data: results.filter((r) => r.outcome === 'skipped-no-data').length,
    errors: results.filter((r) => r.outcome === 'error').length,
    results,
  });
}
