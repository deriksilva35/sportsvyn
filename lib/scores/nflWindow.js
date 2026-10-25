// lib/scores/nflWindow.js - which NFL window a kickoff belongs to, PURE.
//
// THE RULE (Stats tab "Window" filter), from the kickoff's EASTERN wall clock:
//   Monday (any time)                      -> 'mnf'
//   Sunday, 7:00 PM ET or later            -> 'snf'
//   before 3:00 PM ET (any other day)      -> 'early'
//   3:00 PM - 6:59 PM ET (any other day)   -> 'late'
// So a Thursday or Saturday night game, being neither Sunday nor Monday, reads
// by the clock: 8:20 PM ET is 'late'. The rule is Eastern ON PURPOSE - the NFL
// schedules in Eastern ("the 1 PM games"); it is a sports-day rule, not a display
// (the displayed kickoff time goes through lib/time/display.js in the reader's
// zone). This is the one place the tab computes ET.

export const WINDOWS = Object.freeze(['early', 'late', 'snf', 'mnf']);
export const WINDOW_WORDS = Object.freeze({ all: 'All', early: 'Early', late: 'Late', snf: 'SNF', mnf: 'MNF' });

const FMT = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', weekday: 'short', hour: 'numeric', hourCycle: 'h23' });

/** 'early' | 'late' | 'snf' | 'mnf' for a kickoff instant; null when it is not a time. */
export function nflWindow(iso) {
  const t = new Date(iso ?? NaN);
  if (Number.isNaN(t.getTime())) return null;
  const parts = Object.fromEntries(FMT.formatToParts(t).map((p) => [p.type, p.value]));
  const hour = Number(parts.hour) % 24;
  if (parts.weekday === 'Mon') return 'mnf';
  if (parts.weekday === 'Sun' && hour >= 19) return 'snf';
  return hour < 15 ? 'early' : 'late';
}
