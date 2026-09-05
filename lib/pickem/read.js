// lib/pickem/read.js - what the ghost surfaces may know before the game ships.
//
// THE FIRST-KICKOFF LAW ON COPY: no surface hardcodes a lock weekday. When a
// board exists, its snapshotted locks_at is the only truth; until then the one
// sanctioned static line below carries the derived-once fact. Both render
// through lockLabel() so the static line and the first live derivation cannot
// disagree.

import { sql } from '../db.js';

/** The corrected static line, used ONLY while no pickem contest exists. */
export const FIRST_LOCK_FALLBACK = 'Sat Aug 29, noon ET';

const FMT = new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/New_York',
  weekday: 'short', month: 'short', day: 'numeric',
  hour: 'numeric', minute: '2-digit',
});

/** 'Sat Aug 29, noon ET' - exactly the fallback's grammar, from a timestamp. */
export function lockLabel(locksAt) {
  const parts = Object.fromEntries(FMT.formatToParts(new Date(locksAt)).map((p) => [p.type, p.value]));
  const clock = parts.minute === '00' && parts.hour === '12'
    ? (parts.dayPeriod === 'PM' ? 'noon' : 'midnight')
    : `${parts.hour}:${parts.minute} ${parts.dayPeriod}`;
  return `${parts.weekday} ${parts.month} ${parts.day}, ${clock} ET`;
}

/**
 * The next Pick'em lock still ahead, or null before the first board exists.
 * Caught to null by callers like every ghost read - a missing board must
 * never cost the page.
 */
export async function nextLock({ now = new Date() } = {}) {
  const r = await sql`
    SELECT locks_at FROM contests
     WHERE game_type = 'pickem' AND locks_at >= ${new Date(now).toISOString()}
     ORDER BY locks_at ASC LIMIT 1`;
  return r[0]?.locks_at ?? null;
}

/** The label a ghost surface renders: derived when a board exists, else the
 * sanctioned static line. */
export async function firstLockLabel({ now = new Date() } = {}) {
  const locksAt = await nextLock({ now }).catch(() => null);
  return locksAt ? lockLabel(locksAt) : FIRST_LOCK_FALLBACK;
}

/**
 * The lock, stated short: "Sat noon ET".
 *
 * lockLabel() spells the date out - "Sat Aug 29, noon ET" - which is right on
 * the board itself, where the date is the thing you are orienting by. In a
 * dashboard row it is the part that gets clipped, and the DAY plus the TIME is
 * what a reader actually needs: the date is already on the board they are being
 * sent to. Same formatter, same noon/midnight handling, fewer words.
 */
export function shortLockLabel(locksAt) {
  const parts = Object.fromEntries(FMT.formatToParts(new Date(locksAt)).map((p) => [p.type, p.value]));
  const clock = parts.minute === '00' && parts.hour === '12'
    ? (parts.dayPeriod === 'PM' ? 'noon' : 'midnight')
    : `${parts.hour}:${parts.minute} ${parts.dayPeriod}`;
  return `${parts.weekday} ${clock} ET`;
}
