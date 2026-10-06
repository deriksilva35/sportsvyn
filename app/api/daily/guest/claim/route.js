/**
 * POST /api/daily/guest/claim - move this device's finished guest run onto the
 * signed-in account. Signed in only. The page does the same on load after a
 * sign-in; this is the explicit door. Expiry, double-claim and "the account
 * already played that board" are decided by claimGuestRuns, in SQL.
 */
import { cookies } from 'next/headers';
import { auth } from '@/auth';
import { sql } from '@/lib/db';
import { ageGateResponse } from '@/lib/auth/ageGateDb';
import { GUEST_COOKIE, verifyDevice, claimGuestRuns } from '@/lib/daily/guestRuns';

export const dynamic = 'force-dynamic';

export async function POST() {
  const session = await auth();
  const userId = session?.user?.id ?? null;
  if (userId == null) return Response.json({ error: 'unauthorized' }, { status: 401 });
  const ageRefused = await ageGateResponse(userId); if (ageRefused) return ageRefused;
  const deviceId = verifyDevice((await cookies()).get(GUEST_COOKIE)?.value);
  const r = await claimGuestRuns(sql, { deviceId, userId: Number(userId) });
  return Response.json({ ok: r.ok, claimed: r.claimed, reason: r.reason });
}
