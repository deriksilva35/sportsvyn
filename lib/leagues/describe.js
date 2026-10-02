// lib/leagues/describe.js - the words a league card, the INVITED card and
// /j/<key> say about a league. PURE: rows in, strings out.

import { gameLabel, startLabel, SCORING_LABEL, FORMAT_LABEL } from './settings.js';

const SPAN_WORD = { daily: 'a winner every day', weekly: 'a winner every week', season: 'all season' };

/** Has the league's first counted period begun? (null starts_at = not anchored = not started) */
export const hasStarted = (lg, now = new Date()) => lg?.starts_at != null && new Date(lg.starts_at) <= new Date(now);

const plural = (n, one, many) => `${n} ${Number(n) === 1 ? one : many}`;

/** "The Daily, Pick'em · all season · from @mikey" */
export function inviteLine(lg) {
  const parts = [];
  if (lg?.games?.length) parts.push(lg.games.map(gameLabel).join(', '));
  if (SPAN_WORD[lg?.span]) parts.push(SPAN_WORD[lg.span]);
  if (lg?.owner_handle) parts.push(`from @${lg.owner_handle}`);
  return parts.join(' · ');
}

/** "Rank points · Table · 4 of 12 members" */
export function rulesLine(lg) {
  return [SCORING_LABEL[lg?.scoring], FORMAT_LABEL[lg?.format], `${lg?.members ?? 0} of ${lg?.max_members ?? '?'} members`]
    .filter(Boolean).join(' · ');
}

/** The card's foot: "9 members · starts Sat, Oct 3" / "9 members · live". */
export function cardMeta(lg, now = new Date()) {
  const n = plural(lg?.members ?? 0, 'member', 'members');
  if (hasStarted(lg, now)) return `${n} · live`;
  const when = startLabel({ startsAt: lg?.starts_at ? new Date(lg.starts_at).toISOString() : null, startWeek: lg?.start_week ?? null });
  return when ? `${n} · starts ${when}` : n;
}

/** When the door shuts, for the /j page: null when it never does. */
export function joinWindowLine(lg, now = new Date()) {
  if (lg?.late_joins) return 'Joins stay open all season';
  if (hasStarted(lg, now)) return null;
  const when = startLabel({ startsAt: lg?.starts_at ? new Date(lg.starts_at).toISOString() : null, startWeek: lg?.start_week ?? null });
  return when ? `Joins close when it starts, ${when}` : null;
}
