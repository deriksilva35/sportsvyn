/**
 * POST /api/draft/start - claim the week's ranked entry and open the room.
 *
 * START IS CONSUMED. The contest_entries row is written BEFORE the draft is
 * created, so a request that dies between the two leaves a claimed entry with
 * no room - a DNF - rather than a room with no claim, which would be a free
 * look at the board. The failure direction is the point.
 */
import { auth } from '@/auth';
import { currentDraftContest, DRAFT_CONFIG } from '@/lib/draft/contest';
import { claimEntry, getDraftEntry } from '@/lib/draft/entry';
import { startCustomDraftFor } from '@/lib/fantasy/drafts';
import { sql } from '@/lib/db';

export const dynamic = 'force-dynamic';

export async function POST(request) {
  const session = await auth();
  const userId = session?.user?.id ?? null;
  if (userId == null) return Response.json({ error: 'unauthorized' }, { status: 401 });

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

  // Already claimed? Send them back to their room rather than refusing - a
  // reload must not read as a lockout.
  const existing = await getDraftEntry(contest.id, Number(userId));
  if (existing?.meta?.draftId) {
    return Response.json({ ok: true, draftId: existing.meta.draftId, resumed: true });
  }

  // RANKED BYPASSES THE SIM'S ENTITLEMENT GATES, deliberately. The 3-free limit
  // and the members-only custom config exist to price the practice range; a
  // ranked week is one draft against one fixed config and is not a sandbox.
  const started = await startCustomDraftFor(Number(userId), DRAFT_CONFIG, seat, { ranked: true });
  if (!started?.ok) {
    return Response.json({ error: started?.reason ?? 'could not start' }, { status: 400 });
  }

  const claim = await claimEntry(contest.id, Number(userId), started.draftId);
  if (!claim.ok) {
    // Lost a race against another tab. Abandon the room we just made rather
    // than leaving an orphan the history page would show as a real draft.
    await sql`UPDATE drafts SET status = 'abandoned' WHERE id = ${started.draftId}`;
    return Response.json({ error: claim.reason, draftId: claim.draftId }, { status: 409 });
  }
  return Response.json({ ok: true, draftId: started.draftId });
}
