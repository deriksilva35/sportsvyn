// lib/games/playTime.js - the Play lobby's time and date words, PURE.
//
// ONE ZONE PER SCREEN. Every instant on the Play tab is rendered in the page's
// zone - the sv_tz cookie on the server's first paint, the device's own after
// mount (components/games/PlayWhen.js) - and the header names that same zone
// (components/scores/ZoneLabel). The clock reading itself is lib/time/
// standaloneLabel.js's; this file adds only the two shapes the lobby needs that
// it does not have: a day-month date ("Tue 20 Oct") and "is this today".
//
// tz follows standaloneLabel's contract exactly: null = the ET fallback the
// server emits, undefined = the running environment's zone, a string forces it.

import { standaloneTimeLabel } from '../time/standaloneLabel.js';

const zoneOpt = (tz) => (tz === null ? { timeZone: 'America/New_York' } : tz ? { timeZone: tz } : {});

function parts(iso, tz, opts) {
  const fmt = new Intl.DateTimeFormat('en-GB', { ...opts, ...zoneOpt(tz) });
  return Object.fromEntries(fmt.formatToParts(new Date(iso)).map((p) => [p.type, p.value]));
}

/** "Tue 20 Oct" (weekday) or "20 Oct". */
export function playDateLabel(iso, { tz = null, weekday = true } = {}) {
  if (!iso) return '';
  const p = parts(iso, tz, { weekday: 'short', day: 'numeric', month: 'short' });
  return `${weekday ? `${p.weekday} ` : ''}${p.day} ${p.month}`;
}

/** The calendar day of an instant in a zone, 'YYYY-MM-DD'. */
export function dayIn(iso, tz = null) {
  const p = parts(iso, tz, { year: 'numeric', month: '2-digit', day: '2-digit' });
  return `${p.year}-${p.month}-${p.day}`;
}

/**
 * A lock time on the lobby: "5:15 PM" today, "Sun 10:00 AM" on any other day.
 * The zone suffix is left off - the header states it once for the screen.
 */
export function playTimeLabel(iso, { now, tz = null } = {}) {
  if (!iso) return '';
  const today = now != null && dayIn(iso, tz) === dayIn(now, tz);
  return standaloneTimeLabel(iso, { weekday: !today, zone: false, tz });
}
