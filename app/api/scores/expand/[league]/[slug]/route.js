// app/api/scores/expand/[league]/[slug] - the arcade card's expanded view
// (scores-v4 step 2, ruling e): the line score, the key moments (scoring
// plays) and the last five plays, read by the game pages' own readers.
//
// PUBLIC AND CACHED AT THE EDGE: nothing here belongs to a reader, so one
// answer serves everyone - 30 s while live, an hour once final
// (lib/scores/expand.js cacheControlFor). No auth, no writes.
import { readExpand, EXPAND_LEAGUES } from '@/lib/scores/expandRead';
import { cacheControlFor } from '@/lib/scores/expand';

export async function GET(_request, { params }) {
  const { league, slug } = await params;
  if (!EXPAND_LEAGUES.includes(league)) return Response.json({ error: 'unknown league' }, { status: 404 });
  const payload = await readExpand(league, slug).catch(() => undefined);
  if (payload === undefined) return Response.json({ error: 'read failed' }, { status: 503, headers: { 'Cache-Control': 'no-store' } });
  if (!payload) return Response.json({ error: 'not found' }, { status: 404, headers: { 'Cache-Control': 'public, s-maxage=60' } });
  return Response.json(payload, { headers: { 'Cache-Control': cacheControlFor(payload.status) } });
}
