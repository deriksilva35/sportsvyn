// app/api/market/props - the props board's rows, on demand (market-diet, sun-13).
//
// /market used to carry every prop row inside the static page; LINES, the
// default view, read none of them. The PROPS tab now asks here instead:
//
//   ?f=<all|nfl|cfb|epl>          every priced prop in that league
//   ?game=<match id>              one game's sheet (the game dropdown)
//   &part=charts                  the Charts view's ten-game history
//
// THE WIRE IS lib/market/propsWire.js: game fields once per game, rows as
// tuples, no chart history, labels and context derived in the browser.
//
// PUBLIC AND CACHED AT THE EDGE. Nothing here is per-reader - the same rows
// /market showed everyone - so one answer per minute serves every reader:
// s-maxage=60 with five minutes of stale-while-revalidate. The rows are read
// through the per-instance memo in lib/market/cachedReads.js, the one that
// already absorbs a minute of /market traffic per league.
//
// A SMALL KEY SPACE BY CONSTRUCTION. parsePropsQuery accepts one canonical
// spelling per answer - one of f / game, values from an allowlist, a game only
// if it is priced right now - and refuses everything else with a cheap 400
// before any read. The answers that touch the database number 4 + the priced
// games (x2 with part=charts); a crawler walking other combinations gets a
// refusal that costs nothing and is itself cached.
import { cachedPropsBoardRows, cachedPropsGames } from '@/lib/market/cachedReads';
import { parsePropsQuery, packProps, packCharts, PROPS_CACHE_CONTROL } from '@/lib/market/propsWire';

const REFUSAL_CACHE_CONTROL = 'public, s-maxage=300';

export async function GET(request) {
  const params = new URL(request.url).searchParams;
  // The shape is checked before anything is read: a malformed query costs
  // no database round trip, not even the games list.
  const shape = parsePropsQuery(params, null);
  if (!shape.ok && shape.status === 400) {
    return Response.json({ error: shape.error }, { status: 400, headers: { 'Cache-Control': REFUSAL_CACHE_CONTROL } });
  }
  let rows;
  let q = shape;
  try {
    if (params.has('game')) {
      const ids = (await cachedPropsGames()).map((g) => Number(g.matchId));
      q = parsePropsQuery(params, ids);
      if (!q.ok) {
        return Response.json({ error: q.error }, { status: q.status, headers: { 'Cache-Control': 'public, s-maxage=60' } });
      }
    }
    const all = await cachedPropsBoardRows(q.game != null ? 'all' : q.f);
    rows = q.game != null ? all.filter((r) => r.matchId === q.game) : all;
  } catch {
    return Response.json({ error: 'read failed' }, { status: 503, headers: { 'Cache-Control': 'no-store' } });
  }
  const body = q.part === 'charts' ? packCharts(rows) : packProps(rows);
  return Response.json(body, { headers: { 'Cache-Control': PROPS_CACHE_CONTROL } });
}
