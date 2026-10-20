/**
 * POST /api/coins/drop - drop coins into this week's drums (Rules v0.1 s4).
 *
 * Body: { prize_key, qty } or { drops: [{ prize_key, qty }, ...] } (the confirm
 * sheet sends every drum at once). Validated on the server against the coins
 * in hand, in one guarded INSERT (lib/coins/drum.js dropCoins). A drop is
 * final: there is no un-drop endpoint, by the rules.
 *
 * 404 unless COINS=on. Signed in, past the age gate; 18+ to drop (403).
 */

import { auth } from '@/auth';
import { sql } from '@/lib/db';
import { ageGateResponse } from '@/lib/auth/ageGateDb';
import { coinsEnabled } from '@/lib/coins/mint';
import { dropCoins } from '@/lib/coins/drum';

export const dynamic = 'force-dynamic';

export async function POST(request) {
  if (!coinsEnabled()) return new Response('Not found', { status: 404 });
  const session = await auth();
  const userId = session?.user?.id ?? null;
  if (userId == null) return Response.json({ error: 'unauthenticated' }, { status: 401 });
  const ageRefused = await ageGateResponse(userId); if (ageRefused) return ageRefused;
  const body = await request.json().catch(() => ({}));
  const r = await dropCoins({ userId, body, db: sql });
  if (!r.ok) return Response.json({ error: r.error }, { status: r.status });
  return Response.json(r);
}
