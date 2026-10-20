/**
 * GET /api/coins/draw/<week id> - THE PUBLISHED DRAW (Rules v0.1 s5: anyone can
 * reproduce the shuffle). The seed, the method, and per drum its tickets in
 * canonical order (handles, or an opaque player number), the shuffled order and
 * the winning ticket positions. Account ids are stripped. Drawn weeks only.
 */
import { sql } from '@/lib/db';
import { coinsEnabled } from '@/lib/coins/mint';

export const dynamic = 'force-dynamic';

export async function GET(_request, { params }) {
  if (!coinsEnabled()) return new Response('Not found', { status: 404 });
  const { week } = await params;
  if (!/^\d+$/.test(String(week))) return new Response('Not found', { status: 404 });
  const [w] = await sql`SELECT id, draw, drawn_at FROM coin_weeks WHERE id = ${Number(week)} AND drawn_at IS NOT NULL`;
  if (!w?.draw) return new Response('Not found', { status: 404 });
  const drums = (w.draw.drums ?? []).map(({ winners, ...d }) => ({ ...d, winners: (winners ?? []).map(({ user_id: _u, ...x }) => x) }));
  return Response.json({
    week: w.id, drawnAt: w.drawn_at, seed: w.draw.seed, method: w.draw.method,
    howToCheck: 'For each drum: r(k) = first 6 bytes of sha256("<seed>|<prize_key>|<k>") as an integer, k = 0,1,2...; uniform(n) rejects r >= 2^48 - (2^48 mod n) and takes r mod n. Fisher-Yates over ticket indices from the last down: j = uniform(i + 1), swap i and j. The first `count` indices of the result win.',
    drums,
  });
}
