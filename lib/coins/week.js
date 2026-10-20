// lib/coins/week.js - THE DRAWING WEEK (Rules v0.1 s2), PURE.
//
// A week opens Tuesday 09:00:00 Pacific and closes the next Tuesday 08:59:59
// Pacific (the Close); the next week opens at the same instant, so a week is
// the half-open interval [opensAt, closesAt). Pacific, not ET: the rules name
// it, and "9:00 am PT" is what every screen prints.
//
// DST: the open instant is 16:00Z in PDT and 17:00Z in PST. It is found by
// asking the zone, never by a fixed offset - the week of 3 Nov 2026 opens at
// 17:00Z while the week before it opened at 16:00Z.

export const DRAW_TZ = 'America/Los_Angeles';
export const OPEN_HOUR = 9;
const DAY = 86_400_000;

const fmt = new Intl.DateTimeFormat('en-US', {
  timeZone: DRAW_TZ, hourCycle: 'h23', weekday: 'short',
  year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
});
const WEEKDAY = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

/** Pacific wall-clock parts of an instant. */
export function ptParts(at) {
  const p = Object.fromEntries(fmt.formatToParts(new Date(at)).map((x) => [x.type, x.value]));
  return { y: +p.year, m: +p.month, d: +p.day, hour: +p.hour, minute: +p.minute, second: +p.second, dow: WEEKDAY[p.weekday] };
}

/** The instant of 09:00 Pacific on a Pacific calendar date (y, m 1-12, d). */
export function ptNine(y, m, d) {
  // Try PDT (UTC-7) then PST (UTC-8); exactly one reads back as 09:00.
  for (const off of [7, 8]) {
    const t = new Date(Date.UTC(y, m - 1, d, OPEN_HOUR + off));
    const p = ptParts(t);
    if (p.hour === OPEN_HOUR && p.d === d) return t;
  }
  throw new Error(`ptNine: no 09:00 on ${y}-${m}-${d} in ${DRAW_TZ}`);
}

/** The week containing `at`: { opensAt, closesAt } (Dates, half-open). */
export function weekOf(at = new Date()) {
  const p = ptParts(at);
  let back = (p.dow - 2 + 7) % 7;
  if (back === 0 && p.hour < OPEN_HOUR) back = 7;
  // Step on a UTC noon of the Pacific date: whole days, no DST edge.
  const noon = Date.UTC(p.y, p.m - 1, p.d, 12) - back * DAY;
  const a = new Date(noon); const b = new Date(noon + 7 * DAY);
  return {
    opensAt: ptNine(a.getUTCFullYear(), a.getUTCMonth() + 1, a.getUTCDate()),
    closesAt: ptNine(b.getUTCFullYear(), b.getUTCMonth() + 1, b.getUTCDate()),
  };
}

/** Has the Close of the week that opened at `opensAt` passed by `now`? */
export const isClosed = (week, now = new Date()) => new Date(now) >= new Date(week.closes_at ?? week.closesAt);

/** "Tue Oct 27" for a close instant, in Pacific. */
export function closeLabel(at) {
  return new Date(at).toLocaleDateString('en-US', { timeZone: DRAW_TZ, weekday: 'short', month: 'short', day: 'numeric' });
}
