// lib/october/alerts.js - "your five", once, when the day is graded.
//
// ONE ALERT A DAY, AT SETTLE. Not per slot: five notifications for one card
// would be the flap the fold rule exists to stop, and four of them would say
// "still waiting on two games". The day's final line is the one moment the
// whole card is a fact.
//
// IT GOES THROUGH dispatch, like every other push in this product - the
// audience, the preference gate and the send accounting are all its, and this
// module's only job is the SENTENCE.

import { sql } from '../db.js';
import { DNF } from './rules.js';

/**
 * PURE. The line the alert carries.
 *
 * A DNF SAYS DNF. "You scored 0" would be true and useless; the reader needs
 * to know it was an empty slot rather than a bad day, because the fix is
 * different.
 */
export function dayLine({ state, points, rank, of, best }) {
  if (state === DNF) {
    return {
      title: 'October · DNF',
      body: `A slot was empty at first pitch, so today does not count. ${best != null ? `Best card today ${best}.` : ''}`.trim(),
    };
  }
  const place = rank != null && of != null ? ` · ${ordinal(rank)} of ${of}` : '';
  return {
    title: `October · ${points} points`,
    body: `Your five are in${place}.${best != null ? ` Best card today ${best}.` : ''}`,
  };
}

const ordinal = (n) => {
  const s = ['th', 'st', 'nd', 'rd']; const v = n % 100;
  return n + (s[(v - 20) % 10] ?? s[v] ?? s[0]);
};

/**
 * Everyone who played the day, as notifyPersonalized() wants them:
 * { userId, params } against one of the two October copy templates.
 *
 * PER-RECIPIENT, NOT BULK, for the same reason the Weekly's settled push is:
 * every reader's sentence carries their own points and their own rank, and
 * one shared payload cannot say either.
 *
 * ONLY PEOPLE WHO ACTUALLY ENTERED. A reader who did not play October today
 * gets nothing - a "you scored 0" for a card they never opened is a
 * notification about somebody else's game.
 */
export async function daySettleAlerts(contestId) {
  const [c] = await sql`SELECT puzzle_date FROM contests WHERE id = ${contestId}`;
  const day = c?.puzzle_date ?? null;
  const rows = await sql`
    SELECT e.user_id, e.score, e.meta->'october'->>'state' AS state
      FROM contest_entries e WHERE e.contest_id = ${contestId}
     ORDER BY e.score DESC NULLS LAST`;
  if (!rows.length) return [];
  const scored = rows.filter((r) => (r.state ?? null) !== DNF);
  const best = scored.length ? Number(scored[0].score) : null;
  const of = rows.length;
  return rows.map((r, i) => ({
    userId: r.user_id,
    eventId: r.state === DNF ? 'october-dnf' : 'october-settled',
    params: r.state === DNF
      ? { day: pretty(day), best: fmt(best) }
      : {
        day: pretty(day), pts: fmt(r.score == null ? 0 : Number(r.score)),
        rank: ordinal(i + 1), field: String(of), best: fmt(best),
      },
  }));
}

const fmt = (v) => (v == null ? '-' : String(v));
const pretty = (d) => (d
  ? new Date(`${String(d).slice(0, 10)}T12:00:00Z`)
    .toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' })
  : 'The day');
