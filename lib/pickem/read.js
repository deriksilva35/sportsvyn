// lib/pickem/read.js - what the ghost surfaces may know before the game ships.
//
// THE FIRST-KICKOFF LAW ON COPY: no surface hardcodes a lock weekday. When a
// board exists, its snapshotted locks_at is the only truth; before one
// exists, firstLockLabel() derives the same fact from the schedule via
// boardPlan() (relay 2c-fix item 1) - the read-only half of the same
// creation the cron will eventually run - rather than a static line that
// ages the moment a real season moves past it.

import { sql } from '../db.js';

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
/**
 * THE NEXT LOCK IS A GAME'S KICKOFF, not the contest's close (rolling lock).
 * The soonest kickoff still ahead on any unsettled board; the board's own
 * locks_at (its last kickoff) is only the outer bound of the search.
 */
export async function nextLock({ sport = null, now = new Date() } = {}) {
  const t = new Date(now).toISOString();
  const r = await sql`
    SELECT min((g->>'kickoff_at')::timestamptz) AS ko
      FROM contests c CROSS JOIN LATERAL jsonb_array_elements(c.board) g
     WHERE c.game_type = 'pickem' AND NOT c.settled AND c.locks_at >= ${t}::timestamptz
       AND (${sport}::text IS NULL OR c.sport = ${sport})
       AND (g->>'kickoff_at')::timestamptz >= ${t}::timestamptz`;
  return r[0]?.ko ?? null;
}

/**
 * The label a ghost surface renders: derived from a real contest when one
 * exists, else derived from the SCHEDULE via boardPlan()'s read-only plan
 * (relay 2c-fix item 1 - no static fallback survives this file). Sport
 * defaults to 'cfb' for the derivation only when none is given, matching
 * this function's own long-standing default surface. Null only when
 * genuinely nothing is scheduled for that sport at all.
 */
export async function firstLockLabel({ sport = null, now = new Date() } = {}) {
  const locksAt = await nextLock({ sport, now }).catch(() => null);
  if (locksAt) return lockLabel(locksAt);
  const { boardPlan } = await import('./create.js');
  const { plan } = await boardPlan({ leagueSlug: sport ?? 'cfb', now }).catch(() => ({ plan: null }));
  return plan ? lockLabel(plan.firstKickoff ?? plan.locksAt) : null;
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
