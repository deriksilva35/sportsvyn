/**
 * POST /api/draft/start - claim the week's ranked entry and open the room.
 *
 * START IS CONSUMED, AND THE CLAIM COMES FIRST (ruling D7). openRankedRoom
 * (lib/draft/entry.js) writes the contest_entries row BEFORE the room, and the
 * room is created already linked to it in one statement. A request that dies
 * between the two leaves a claimed entry with no room - nobody has seen a
 * board, so the next tap opens the room for that claim, and at lock it is a
 * DNF. A room with no claim, which would be a free look at the board, cannot
 * be produced by any order of failures.
 */
import { auth } from '@/auth';
import { currentDraftContest, DRAFT_CONFIG } from '@/lib/draft/contest';
import { openRankedRoom } from '@/lib/draft/entry';
import { ageGateResponse } from '@/lib/auth/ageGateDb';

export const dynamic = 'force-dynamic';

export async function POST(request) {
  const session = await auth();
  const userId = session?.user?.id ?? null;
  if (userId == null) return Response.json({ error: 'unauthorized' }, { status: 401 });
  const ageRefused = await ageGateResponse(userId); if (ageRefused) return ageRefused;

  let body; try { body = await request.json(); } catch { body = {}; }
  const seat = Number(body?.seat);
  if (!Number.isInteger(seat) || seat < 1 || seat > DRAFT_CONFIG.teamsCount) {
    return Response.json({ error: 'bad seat' }, { status: 400 });
  }

  const contest = await currentDraftContest();
  if (!contest) return Response.json({ error: 'no board' }, { status: 404 });
  if (contest.settled) return Response.json({ error: 'settled' }, { status: 409 });
  if (new Date(contest.locks_at).getTime() <= Date.now()) {
    return Response.json({ error: 'locked' }, { status: 409 });
  }

  // RANKED BYPASSES THE SIM'S ENTITLEMENT GATES, deliberately. The 3-free limit
  // and the members-only custom config exist to price the practice range; a
  // ranked week is one draft against one fixed config and is not a sandbox.
  //
  // ALREADY CLAIMED WITH A ROOM? openRankedRoom sends them back to it rather
  // than refusing - a reload must not read as a lockout.
  const opened = await openRankedRoom(contest, Number(userId), seat);
  if (!opened.ok) {
    return Response.json({ error: opened.reason ?? 'could not start' }, { status: 400 });
  }
  return Response.json({ ok: true, draftId: opened.draftId, ...(opened.resumed ? { resumed: true } : {}) });
}
