// lib/nba/dayRules.js - the day board's PURE vocabulary, safe for a client
// component (no db import). lib/nba/dayPickem.js re-exports it.
import { NOT_PLAYED } from '../mlb/status.js';

/** Statuses that make a game VOID on a day board: not played, for everyone. */
export const VOID_STATUSES = Object.freeze([...NOT_PLAYED, 'postponed']);
export const isVoidStatus = (s) => VOID_STATUSES.includes(String(s ?? ''));

/** 'YYYY-MM-DD' -> 'Tue Oct 20'. A calendar date, not a clock: formatted at
 * UTC noon so no zone can move it a day. Null for anything else. */
export function dayLabel(dayEt) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(dayEt ?? ''))) return null;
  return new Intl.DateTimeFormat('en-US', {
    timeZone: 'UTC', weekday: 'short', month: 'short', day: 'numeric',
  }).format(new Date(`${dayEt}T12:00:00Z`)).replace(',', '');
}
