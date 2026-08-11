/**
 * lib/auth/welcomeSheetLedger.js - did the first-launch sheet appear, and what
 * did the user do with it?
 *
 * WHY THIS EXISTS. Between 8 and 10 August, 14 accounts arrived through the app
 * and 11 of them never started a draft. The entry path was traced and no defect
 * was found: the free tier is open, the pool is current, and one of those users
 * demonstrably loaded /sim five times and toured history, tracker and account
 * without drafting. But the WelcomeSheet fires for exactly that cohort - shell,
 * IAP on, not a member - it is the FIRST thing a new account sees, it is modal,
 * and NOTHING recorded whether it appeared or how it was got rid of. The one
 * screen standing between a paid install and the draft button was the one screen
 * with no evidence at all.
 *
 * SAME FAILURE-HONESTY AS THE EMAIL LEDGER. A row opens when the sheet renders
 * and closes when it is dismissed, carrying WHICH control did it. An unclosed
 * row is not missing data - it is the finding: the sheet went up and the session
 * ended with it still there. That is precisely the shape a stall would take, and
 * under the old arrangement it was indistinguishable from nothing happening.
 *
 * NOTHING HERE MAY COST A SIGNUP OR A RENDER. Every function swallows its own
 * failures and returns null. An unrecorded appearance is a gap in analytics; a
 * lobby that fails to paint is a lost user, and this is the screen that cohort
 * already struggles to get past.
 *
 * Rides in sync_runs under source='welcome-sheet', the same ledger the pollers
 * and the welcome email use - one table to read when asking "what happened".
 */

import { sql } from '../db.js';

export const SOURCE = 'welcome-sheet';

/**
 * The controls that can close the sheet. Recorded rather than inferred, because
 * "they pressed Start drafting" and "they tapped the backdrop to make it go
 * away" are different facts about the same dismissal, and only one of them says
 * the copy did its job.
 */
export const DISMISS_CONTROLS = ['primary', 'backdrop', 'escape', 'purchase'];

export function isDismissControl(v) {
  return typeof v === 'string' && DISMISS_CONTROLS.includes(v);
}

/** Open a row when the sheet renders. Returns its id, or null. */
export async function recordSheetShown(userId) {
  if (userId == null) return null;
  try {
    const r = await sql`
      INSERT INTO sync_runs (source, kind, started_at, ok, summary)
      VALUES (${SOURCE}, 'shown', now(), false,
              ${JSON.stringify({ userId, outcome: 'shown' })}::jsonb)
      RETURNING id`;
    return r[0]?.id ?? null;
  } catch (e) {
    console.error('[welcome-sheet] could not open a row', { userId, message: e?.message });
    return null;
  }
}

/**
 * Close it with the control that did the dismissing.
 *
 * A row id we do not have is not an error worth surfacing - the open may simply
 * have failed - so this returns quietly rather than writing an orphan.
 */
export async function recordSheetDismissed(id, control) {
  if (id == null) return false;
  const via = isDismissControl(control) ? control : 'unknown';
  try {
    await sql`
      UPDATE sync_runs
         SET finished_at = now(), ok = true,
             summary = summary || ${JSON.stringify({ outcome: 'dismissed', via })}::jsonb
       WHERE id = ${id} AND source = ${SOURCE}`;
    return true;
  } catch (e) {
    console.error('[welcome-sheet] could not close a row', { id, via, message: e?.message });
    return false;
  }
}

/**
 * How long a sheet may stay open before the session is assumed over.
 *
 * Generous on purpose: this is a screen somebody might genuinely sit and read.
 * The number only decides when an open row becomes evidence rather than noise.
 */
export const OPEN_AFTER_MINUTES = 30;

/**
 * What the sheet ledger says.
 *
 * `neverDismissed` is the whole point of the exercise. Everything else is
 * context for reading it.
 */
export async function welcomeSheetSummary() {
  const [shown, byControl, open] = await Promise.all([
    sql`SELECT count(*)::int AS n,
               count(DISTINCT (summary->>'userId')::int)::int AS users
          FROM sync_runs WHERE source = ${SOURCE}`,
    sql`SELECT COALESCE(summary->>'via', '(open)') AS via, count(*)::int AS n
          FROM sync_runs WHERE source = ${SOURCE}
         GROUP BY 1 ORDER BY 2 DESC`,
    sql`SELECT id, (summary->>'userId')::int AS user_id, started_at
          FROM sync_runs
         WHERE source = ${SOURCE}
           AND summary->>'outcome' = 'shown'
           AND started_at < now() - make_interval(mins => ${OPEN_AFTER_MINUTES})
         ORDER BY started_at DESC LIMIT 25`,
  ]);
  return {
    shown: shown[0]?.n ?? 0,
    users: shown[0]?.users ?? 0,
    byControl: byControl.map((r) => ({ via: r.via, n: r.n })),
    neverDismissed: open,
    openAfterMinutes: OPEN_AFTER_MINUTES,
  };
}
