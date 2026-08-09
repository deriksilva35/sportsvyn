/**
 * POST /api/admin/topic-draft  { prompt, league? }
 *
 * `league` is one of lib/topicDraftLeagues.js's slugs and defaults to the World
 * Cup, which is what every existing caller of this route was implicitly asking
 * for - so a script written before migration 060 keeps producing exactly the
 * draft it produced before. An unrecognised league is a 400, not a fallback:
 * silently writing a World Cup draft for a caller that asked for the NFL is the
 * kind of wrong that only shows up after publication.
 *
 * Programmatic trigger for the prompt-attached topic_draft pipeline. Auth gate
 * copies the cron routes' shape (Bearer token -> 401), but keyed on ADMIN_SECRET
 * because this is admin-triggered, not a cron. Runs lib/topicDraft.js inline and
 * returns a JSON summary. The admin UI's Generate button uses a Server Action
 * (repo-native admin pattern) rather than this route; the route exists for
 * scripted / out-of-band triggers. NEVER auto-publishes.
 *
 * maxDuration is 300 (not the cron default 60): a 1200-1800 word generation plus
 * a planner call plus Tavily can exceed 60s.
 */

import { runTopicDraft } from '@/lib/topicDraft';
import { TOPIC_DRAFT_LEAGUE_SLUGS, WC_LEAGUE_SLUG } from '@/lib/topicDraftLeagues';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

export async function POST(request) {
  const authHeader = request.headers.get('authorization');
  if (!process.env.ADMIN_SECRET || authHeader !== `Bearer ${process.env.ADMIN_SECRET}`) {
    return new Response('Unauthorized', { status: 401 });
  }

  let body;
  try { body = await request.json(); }
  catch { return Response.json({ error: 'invalid json body' }, { status: 400 }); }

  const prompt = (body?.prompt ?? '').toString().trim();
  if (!prompt) return Response.json({ error: 'prompt required' }, { status: 400 });

  const league = (body?.league ?? WC_LEAGUE_SLUG).toString();
  if (!TOPIC_DRAFT_LEAGUE_SLUGS.includes(league)) {
    return Response.json({ error: `unknown league: ${league}`, allowed: TOPIC_DRAFT_LEAGUE_SLUGS }, { status: 400 });
  }

  try {
    const r = await runTopicDraft(prompt, { leagueSlug: league });
    return Response.json({
      ok: r.ok,
      draft_id: r.draftId,
      status: r.status,
      league,
      article_type: r.plan?.article_type ?? null,
      resolved_entities: r.resolved,
      unresolved_entities: r.unresolved,
      sources_count: r.sources?.length ?? 0,
      validation: r.validation,
    });
  } catch (err) {
    return Response.json({ ok: false, error: String(err?.message ?? err) }, { status: 500 });
  }
}
