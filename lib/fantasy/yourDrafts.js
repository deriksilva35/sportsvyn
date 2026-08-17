// lib/fantasy/yourDrafts.js - "Your drafts", split by what you can DO with each.
//
// NOTHING SHOULD BE REACHABLE ONLY BY REMEMBERING A URL. That is the whole
// brief. getDraftHistory already returned every row a user owns; what was
// missing was a surface that told them apart, because "resume this", "read
// this" and "re-enter this room" are three different actions and a flat list
// asks the reader to work out which is which from a status column.
//
// THREE BUCKETS, and the order is by urgency rather than by date:
//   open      a mock you walked away from mid-draft    -> RESUME
//   tracker   a real draft you were tracking at a table -> RE-ENTER
//   done      finished mocks, newest first              -> the board and a grade
//
// ABANDONED ROOMS ARE EXCLUDED. They spent their entitlement (see
// getDraftsUsed) but there is nothing to return to, and a list of dead rooms
// reads as clutter rather than history.

const MODE = (d) => (d.mode ?? 'sim');

export function splitDrafts(rows = []) {
  const open = [];
  const tracker = [];
  const done = [];
  for (const d of rows) {
    if (d.status === 'abandoned') continue;
    const row = {
      id: d.id,
      status: d.status,
      mode: MODE(d),
      // The label a reader recognises the room by. A custom config has no name
      // worth printing, so the shape is the name: "12-team PPR".
      label: d.config_name && d.config_name !== 'Custom'
        ? d.config_name
        : `${d.teams_count ?? '?'}-team ${String(d.scoring_format ?? '').toUpperCase()}`.trim(),
      teams: d.teams_count ?? null,
      scoring: d.scoring_format ?? null,
      seat: d.pick_position ?? null,
      picks: d.pick_count ?? 0,
      grade: d.grade ?? null,
      startedAt: d.started_at ?? null,
      completedAt: d.completed_at ?? null,
      href: `/sim/draft/${d.id}`,
    };
    if (MODE(d) === 'tracker') tracker.push(row);
    else if (d.status === 'in_progress') open.push(row);
    else done.push(row);
  }
  return { open, tracker, done };
}

/** A short, honest date for a history row. Absent rather than "Invalid Date". */
export function draftDate(iso) {
  const d = new Date(iso ?? NaN);
  if (!Number.isFinite(d.getTime())) return null;
  return d.toLocaleDateString('en-US', { timeZone: 'America/New_York', month: 'short', day: 'numeric' });
}

/**
 * What a row invites you to do. The verb IS the difference between the buckets,
 * so it lives here rather than being re-derived in JSX on two surfaces.
 */
export function draftAction(row) {
  if (row.mode === 'tracker') return row.status === 'in_progress' ? 'Re-enter' : 'See the board';
  return row.status === 'in_progress' ? 'Resume' : 'See the board';
}
