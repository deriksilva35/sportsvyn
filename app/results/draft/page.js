/**
 * /results/draft - THE NBA NIGHTLY DRAFT'S RESULTS (tue-6). The room page is
 * also its result page (lib/draftGame/room.js readRoom carries the stored
 * result once the slate settles), so this sends the reader to the latest
 * nightly room: the one they drafted if any, else the latest one made.
 * /results/draft/<contest> stays the weekly Draft's results.
 */

import { redirect } from 'next/navigation';
import { auth } from '@/auth';
import { sql } from '@/lib/db';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'The Draft · results · Sportsvyn' };

export default async function DraftResultsLatest() {
  const uid = (await auth().catch(() => null))?.user?.id ?? null;
  const [mine] = uid == null ? [] : await sql`
    SELECT c.id FROM contests c JOIN contest_entries e ON e.contest_id = c.id AND e.user_id = ${Number(uid)}
     WHERE c.game_type = 'draft_game' AND c.meta->>'nightly' = 'true'
     ORDER BY c.locks_at DESC LIMIT 1`;
  const [latest] = mine ? [mine] : await sql`
    SELECT id FROM contests WHERE game_type = 'draft_game' AND meta->>'nightly' = 'true'
     ORDER BY locks_at DESC LIMIT 1`;
  redirect(latest ? `/draft/game/${latest.id}` : '/games');
}
