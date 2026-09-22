'use server';

// app/actions/seriesPickem.js - save-on-change for the MLB round board. The
// action is a thin door: auth, then lib/mlb/seriesPickem owns every rule (the
// round lock included - the server clock is the only clock).

import { auth } from '@/auth';
import { saveSeriesPick } from '@/lib/mlb/seriesPickem';

export async function saveSeriesPickAction(contestId, seriesKey, teamId) {
  const session = await auth();
  const userId = session?.user?.id ?? null;
  if (userId == null) return { ok: false, reason: 'signed_out' };
  return saveSeriesPick(Number(userId), Number(contestId), String(seriesKey), Number(teamId));
}
