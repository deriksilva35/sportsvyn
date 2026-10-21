// lib/email/schedule.js - THE PACIFIC CLOCK, ALL YEAR (tue-4).
//
// Vercel crons are UTC only, so a fixed "0 15 * * *" is 8 AM PDT but 7 AM PST
// after DST ends (Sun 1 Nov 2026). Instead the crons fire HOURLY and each firing
// asks the Pacific clock (Intl America/Los_Angeles) whether it is the hour to
// act: the real send at 8, the owner preview at 6. A Pacific hour occurs once
// a day at these hours (the repeated hour on fall-back day is 1 AM), and the
// per-day ledgers (morning-email per user, morning-preview per day) make a
// double firing mail nobody twice.

export const PACIFIC = 'America/Los_Angeles';
export const SEND_HOUR_PT = 8;
export const PREVIEW_HOUR_PT = 6;

/** PURE: the hour (0-23) on the Pacific clock at this instant. */
export function pacificHour(now = new Date()) {
  const h = new Intl.DateTimeFormat('en-US', { timeZone: PACIFIC, hour: 'numeric', hourCycle: 'h23' }).format(new Date(now));
  return Number(h);
}

/** PURE: is this instant inside the given Pacific hour? */
export const isPacificHour = (now, hour) => pacificHour(now) === hour;
