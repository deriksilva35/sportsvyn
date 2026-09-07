'use server';

/**
 * app/actions/confirm.js - "Lock it in" for the Weekly and Pick'em.
 *
 * IT IS A RECEIPT, NOT A SUBMIT, and that distinction is the whole design.
 * Both games autosave: whatever is in the lineup at first kickoff is the
 * entry, confirmed or not. An UNCONFIRMED ENTRY STILL COUNTS AT LOCK,
 * unchanged - nothing in the settle path reads confirmed_at. What this
 * records is that the reader has seen their finished six (or their finished
 * board) and said so, which is the reassurance a save-on-every-tap model
 * otherwise never gives them.
 *
 * NO MIGRATION. confirmed_at lives in contest_entries.meta, which is jsonb
 * and already carries droppedSlot / dnf / pct / roster / room.
 *
 * NESTED MERGE WRITTEN OUT? NOT NEEDED HERE, and the difference is worth
 * naming: `meta || jsonb_build_object('confirmed_at', ...)` sets ONE
 * top-level key and leaves every sibling top-level key intact. The shallow-
 * merge trap in CLAUDE.md is about writing into a NESTED object (metadata ->
 * detail), where || replaces the whole child. This writes at the top level,
 * so || is exactly right.
 */

import { auth } from '@/auth';
import { sql } from '@/lib/db';

async function confirmEntry(contestId, gameType) {
  const session = await auth();
  const userId = session?.user?.id ?? null;
  if (userId == null) return { ok: false, reason: 'unauthenticated' };

  // THE LOCK IS STILL THE LOCK. Confirming a locked week would write a
  // reassurance about an entry that can no longer change, which is at best
  // noise and at worst reads as "this got in" when it did not.
  const [c] = await sql`
    SELECT id, locks_at, settled FROM contests
     WHERE id = ${Number(contestId)} AND game_type = ${gameType}`;
  if (!c) return { ok: false, reason: 'no such contest' };
  if (c.settled || new Date(c.locks_at).getTime() <= Date.now()) {
    return { ok: false, reason: 'locked' };
  }

  const at = new Date().toISOString();
  const rows = await sql`
    UPDATE contest_entries
       SET meta = meta || jsonb_build_object('confirmed_at', ${at}::text),
           updated_at = now()
     WHERE contest_id = ${Number(contestId)} AND user_id = ${Number(userId)}
     RETURNING id`;
  // No row means no entry yet - the caller confirmed before anything saved,
  // which the UI does not offer, but a stale tab could.
  if (!rows.length) return { ok: false, reason: 'no entry' };
  return { ok: true, confirmedAt: at };
}

export async function confirmWeeklyEntry(contestId) {
  return confirmEntry(contestId, 'weekly');
}

export async function confirmPickemEntry(contestId) {
  return confirmEntry(contestId, 'pickem');
}
