/**
 * /api/cron/prematch-analyst -- Vercel cron target.
 * Schedule: every 30 minutes (see vercel.json).
 *
 * Fires the pre-match analyst pass (Watch Score + two-paragraph Preview)
 * against WC fixtures inside a 72h kickoff window that do not yet have
 * a row. The pass writes ONE articles row per match with type='preview'
 * and score_type='watch'; that single row backs BOTH the editorial
 * Preview column and the Watch Score rail on /match/[slug].
 *
 * Idempotency comes from two layers:
 *   1. Candidate predicate excludes any match that already has a row
 *      (NOT EXISTS over articles type='preview', score_type='watch').
 *   2. lib/aiPrematchRunner.js enforces a freeze invariant: even if the
 *      candidate predicate misses, an existing row makes the runner
 *      return outcome='skipped_exists' without writing.
 *
 * Per-tick spend cap: LIMIT 5 candidates per sweep. A late candidate
 * is caught on the next tick (the freeze guarantees no double-fire).
 * That bounds Anthropic spend per minute under a steady WC slate.
 *
 * Held-row policy: moment_basis in ('cultural', 'geopolitical') inserts
 * with status='preview' and does NOT render on the page until an
 * editor flips it. This cron writes the held row but does not flip it;
 * /admin/prematch is the surface for that decision.
 *
 * No live-match hold here. Pre-match writes target status='scheduled'
 * rows; the runner refuses any match whose status has flipped to live
 * or final, so the cron can run during live play without risk. Live
 * matches are logged for observability, not gated on.
 *
 * Auth: Bearer ${CRON_SECRET}. Same secret as the other crons.
 *
 * Debugging:
 *   ?dry=1   read-only candidate listing; zero Anthropic, zero writes.
 *            CRON_SECRET still required.
 *
 * Response shape:
 *   { ok: true,
 *     fired:           [{ match_id, slug, outcome, status?, moment_basis?, composite?, article_id? }],
 *     skipped:         [{ match_id, slug, outcome, ...details }],
 *     candidates_seen: number,
 *     live_at_run:     [{ match_id, status, kickoff_at }],
 *     timing_ms,
 *     dryRun
 *   }
 */

import { sql } from '@/lib/db';
import { runAndPublishPrematchForMatch } from '@/lib/aiPrematchRunner';

export const dynamic = 'force-dynamic';
// One LLM call per fire (~17-22s observed) + DB writes + readback.
// LIMIT 5 caps to ~2 minutes worst case. 120s gives headroom for slow
// Anthropic responses and SQL round-trip wobble without ever stalling
// at the Vercel ceiling.
export const maxDuration = 120;

const WC_LEAGUE_SLUG = 'fifa-wc-2026';
const PER_SWEEP_CAP  = 5;
// 72-hour kickoff window. Generates the preview 1-3 days before kickoff
// so the page has real content well ahead of any social/share/search
// load. Lineups are not consumed by the generator, so this window does
// not depend on the poll-lineups cron's 1h-pre-KO cadence.
const KICKOFF_WINDOW_HOURS = 72;

export async function GET(request) {
  const authHeader = request.headers.get('authorization');
  if (
    !process.env.CRON_SECRET ||
    authHeader !== `Bearer ${process.env.CRON_SECRET}`
  ) {
    return new Response('Unauthorized', { status: 401 });
  }

  const url = new URL(request.url);
  const dryRun = url.searchParams.get('dry') === '1';
  const t0 = Date.now();

  try {
    // Observability only: log any live WC match. Pre-match writes target
    // scheduled rows and the runner refuses live/final/cancelled, so the
    // cron is safe during live play. The log keeps that auditable.
    const liveRows = await sql`
      SELECT m.id AS match_id, m.status, m.kickoff_at
        FROM matches m
        JOIN leagues lg ON lg.id = m.league_id
       WHERE lg.slug = ${WC_LEAGUE_SLUG}
         AND m.status = 'live'
    `;

    // Candidate predicate: same as scripts/backfill-prematch-prod.mjs.
    // Both teams non-null excludes TBD knockout slots that have not yet
    // been resolved by /api/cron/resolve-bracket.
    const candidates = await sql`
      SELECT m.id, m.slug, m.kickoff_at,
             ht.name AS home, at.name AS away
        FROM matches m
        JOIN leagues lg ON lg.id = m.league_id
        JOIN teams ht ON ht.id = m.home_team_id
        JOIN teams at ON at.id = m.away_team_id
       WHERE lg.slug = ${WC_LEAGUE_SLUG}
         AND m.status = 'scheduled'
         AND m.home_team_id IS NOT NULL AND m.away_team_id IS NOT NULL
         AND m.kickoff_at > now()
         AND m.kickoff_at < now() + (${KICKOFF_WINDOW_HOURS} || ' hours')::interval
         AND NOT EXISTS (
           SELECT 1 FROM articles a
            WHERE a.match_id = m.id AND a.type = 'preview' AND a.score_type = 'watch'
         )
       ORDER BY m.kickoff_at ASC
       LIMIT ${PER_SWEEP_CAP}
    `;

    if (dryRun) {
      const dryResult = {
        ok: true,
        fired: [],
        skipped: [],
        candidates_seen: candidates.length,
        candidate_list: candidates.map((c) => ({
          match_id: c.id,
          slug: c.slug,
          kickoff_at: c.kickoff_at,
          matchup: `${c.home} v ${c.away}`,
        })),
        live_at_run: liveRows,
        timing_ms: Date.now() - t0,
        dryRun: true,
      };
      console.log('[prematch-analyst:dry]', JSON.stringify({
        candidates_seen: candidates.length,
        live_count: liveRows.length,
        timing_ms: dryResult.timing_ms,
      }));
      return Response.json(dryResult);
    }

    const fired = [];
    const skipped = [];

    for (const c of candidates) {
      let r;
      try {
        r = await runAndPublishPrematchForMatch(c.id);
      } catch (err) {
        skipped.push({
          match_id: c.id,
          slug: c.slug,
          outcome: 'crashed',
          error: String(err?.message ?? err),
        });
        continue;
      }
      const base = { match_id: c.id, slug: c.slug, outcome: r.outcome };
      if (r.outcome === 'generated') {
        fired.push({
          ...base,
          status: r.status,
          moment_basis: r.moment_basis,
          composite: r.composite,
          article_id: r.article_id,
        });
      } else {
        skipped.push({ ...base, ...r });
      }
    }

    const result = {
      ok: true,
      fired,
      skipped,
      candidates_seen: candidates.length,
      live_at_run: liveRows,
      timing_ms: Date.now() - t0,
      dryRun: false,
    };
    console.log('[prematch-analyst]', JSON.stringify({
      candidates_seen: candidates.length,
      fired_count: fired.length,
      skipped_count: skipped.length,
      live_count: liveRows.length,
      timing_ms: result.timing_ms,
    }));
    return Response.json(result);
  } catch (err) {
    console.error('[prematch-analyst] error', err);
    return Response.json({
      ok: false,
      message: String(err?.message ?? err),
      stack:   err?.stack ?? null,
    }, { status: 500 });
  }
}
