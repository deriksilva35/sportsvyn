// lib/run/alerts.js - three moments, and no more.
//
//   ROUND OPEN     a global fact - the same sentence for everyone - so it
//                  rides the bulk notifyEvent() path, like pickem-open.
//   24H NUDGE      per recipient, and ONLY IF UNSET: a reminder to somebody
//                  who has already set their nine is noise, and the one
//                  thing that makes a reminder ignorable forever.
//   ROUND SETTLED  per recipient: every reader's sentence carries their own
//                  points and their own rank, which one shared payload
//                  cannot say.
//
// The split is the Weekly's, deliberately - lib/push/notify.js's own header
// explains why open is bulk and reminder/settled are personalised, and a
// fourth game inventing a different rule would be the drift that header
// exists to stop.

import { sql } from '../db.js';
import { ROSTER_SIZE, DNF, ROUND_LABEL } from './rules.js';
import { competitionRank } from '../games/rank.js';

/** Who has NOT set a full nine, with the round's own lock. */
export async function unsetForRound(contestId) {
  const [c] = await sql`SELECT board FROM contests WHERE id = ${contestId}`;
  if (!c) return [];
  const rows = await sql`
    SELECT e.user_id, e.lineup FROM contest_entries e WHERE e.contest_id = ${contestId}`;
  return rows
    .filter((r) => Object.keys(r.lineup ?? {}).length < ROSTER_SIZE)
    .map((r) => ({
      userId: r.user_id,
      eventId: 'run-reminder',
      params: { n_set: String(Object.keys(r.lineup ?? {}).length), of: String(ROSTER_SIZE) },
    }));
}

/**
 * The settled line, per entrant, ranked.
 *
 * A DNF SAYS DNF. "You scored 0" is true and useless; the reader needs to
 * know the nine were never set, because the fix is different.
 */
export async function roundSettleAlerts(contestId) {
  const [c] = await sql`SELECT board, week, meta FROM contests WHERE id = ${contestId}`;
  // AN ALL-VOID CLOSE SENDS NO SETTLE PUSH (ruling sun-10 item 4).
  if (c?.meta?.void_all === true) return [];
  const label = c?.board?.label ?? ROUND_LABEL[c?.board?.round] ?? `Round ${c?.week ?? ''}`;
  const raw = await sql`
    SELECT e.user_id, e.score, e.meta->'run'->>'state' AS state,
           COALESCE(e.submitted_at, e.created_at) AS submitted_at
      FROM contest_entries e WHERE e.contest_id = ${contestId}`;
  if (!raw.length) return [];
  // THE PUSH SAYS THE BOARD'S PLACE (lib/games/rank.js): ties share the
  // higher place. A DNF is not placed.
  const rows = competitionRank(raw, (r) => r.score ?? 0, (r) => r.submitted_at, {
    rankedOf: (r) => (r.state ?? null) !== DNF,
  });
  const scored = rows.filter((r) => (r.state ?? null) !== DNF);
  const best = scored.length ? Number(scored[0].score) : null;
  return rows.map((r) => ({
    userId: r.user_id,
    eventId: r.state === DNF ? 'run-dnf' : 'run-settled',
    params: r.state === DNF
      ? { round: label, best: best == null ? '-' : String(best) }
      : {
        round: label,
        pts: String(r.score == null ? 0 : Number(r.score)),
        rank: ordinal(r.rank),
        field: String(rows.length),
        best: best == null ? '-' : String(best),
      },
  }));
}

const ordinal = (n) => {
  const s = ['th', 'st', 'nd', 'rd']; const v = n % 100;
  return n + (s[(v - 20) % 10] ?? s[v] ?? s[0]);
};
