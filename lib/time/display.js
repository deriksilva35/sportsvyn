// lib/time/display.js - EVERY DISPLAYED CLOCK TIME AND DATE, IN ONE PLACE.
//
// THE RULE (sun-16 item B): a time a reader sees is in THE READER'S zone and
// says which zone that is. The lobby printed Eastern under a header naming the
// viewer's zone, /october printed Pacific, the MLB game page printed EDT - three
// clocks for one first pitch. Every surface now formats through this file.
//
// THE tz CONTRACT, the same one lib/time/standaloneLabel.js always had:
//   tz === null       the FALLBACK the server emits when it does not know the
//                     reader's zone (no sv_tz cookie yet): Eastern, and the
//                     label says "ET" - never an unlabelled guess.
//   tz === undefined  the running environment's own zone (in a browser, the
//                     reader's).
//   tz a string       that IANA zone.
// READ WITH `'tz' in opts`, NEVER A DESTRUCTURING DEFAULT. `{ tz = null }`
// fires for undefined too, so "the viewer's zone" silently became Eastern -
// thu-26 on StandaloneTime, and again on the Play lobby (lib/games/playTime.js)
// until this file: /games read "first lock Sat 7:30 AM" in Los Angeles and in
// London alike.
//
// WHAT IS NOT IN HERE: sports-day RULES. Which ET "game day" a game belongs to,
// the October / Six / NBA day, settle windows - those stay Eastern on purpose,
// in their own modules (lib/time/zoneGuard.test.mjs keeps the list). This file
// answers "how does this instant read to this reader", nothing else.
//
// PURE: no React, no next/headers. The client islands (components/time/
// ViewerTz.js and the Standalone* components) and server code both import it.

/** The fallback zone's IANA id - the only display-side spelling of it. */
export const FALLBACK_TZ = 'America/New_York';
/** And its label. A fallback is always labelled. */
export const FALLBACK_LABEL = 'ET';

const tzOf = (opts) => ('tz' in (opts ?? {}) ? opts.tz : null);

/** Intl options for a zone under the contract above. */
export function zoneOpt(tz) {
  if (tz === null) return { timeZone: FALLBACK_TZ };
  return tz ? { timeZone: tz } : {};
}

const asDate = (iso) => {
  if (iso == null || iso === '') return null;
  const d = iso instanceof Date ? iso : new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d;
};

const partsOf = (fmt, d) => {
  const out = {};
  for (const p of fmt.formatToParts(d)) if (!(p.type in out)) out[p.type] = p.value;
  return out;
};

/**
 * The zone's short label at an instant: "PDT", "EST", "BST", "CEST", "UTC".
 *
 * en-US KNOWS AMERICAN ABBREVIATIONS ONLY. For Europe/London it says "GMT+1",
 * which is true and reads like an error. When en-US falls back to a GMT offset
 * we ask en-GB, which knows "BST"/"CEST"; if that is an offset too, the offset
 * stands - it is still the honest answer.
 */
export function zoneAbbr(iso, tz) {
  if (tz === null) return FALLBACK_LABEL;
  const d = asDate(iso) ?? new Date();
  try {
    const us = partsOf(new Intl.DateTimeFormat('en-US', { ...zoneOpt(tz), timeZoneName: 'short' }), d).timeZoneName ?? '';
    if (!/^GMT[+-]/.test(us)) return us;
    const gb = partsOf(new Intl.DateTimeFormat('en-GB', { ...zoneOpt(tz), timeZoneName: 'short' }), d).timeZoneName ?? '';
    return gb && !/^GMT[+-]/.test(gb) ? gb : us;
  } catch { return ''; }
}

/**
 * "5:15 PM PDT" / "Thu 5:15 PM PDT" / "5:15 PM".
 *
 * THE DAY AND THE HOUR COME FROM ONE Intl CALL - a second formatter for the
 * weekday is how "Sun 11:30 PM" becomes "Mon 11:30 PM" across a midnight.
 *
 * @param {{weekday?: boolean, zone?: boolean, tz?: string|null}} opts
 *   weekday  prepend "Thu " - for boards whose rows span days.
 *   zone     false drops the label - when the screen states it once elsewhere.
 */
export function timeLabel(iso, opts = {}) {
  const d = asDate(iso);
  if (!d) return '';
  const { weekday = false, zone = true } = opts;
  const tz = tzOf(opts);
  const v = partsOf(new Intl.DateTimeFormat('en-US', {
    ...(weekday ? { weekday: 'short' } : {}),
    hour: 'numeric', minute: '2-digit', hour12: true,
    ...zoneOpt(tz),
  }), d);
  const day = v.weekday ?? '';
  const time = `${v.hour}:${v.minute} ${v.dayPeriod}`;
  const label = zone ? zoneAbbr(d, tz) : '';
  return `${day ? `${day} ` : ''}${time}${label ? ` ${label}` : ''}`;
}

/**
 * A calendar date in the zone.
 *   order 'md' (default)  "Sun Oct 4"   - the US grammar most surfaces use
 *   order 'dm'            "Sun 4 Oct"   - the Play lobby's
 * weekday false drops the "Sun ".
 */
export function dateLabel(iso, opts = {}) {
  const d = asDate(iso);
  if (!d) return '';
  const { weekday = true, order = 'md' } = opts;
  const v = partsOf(new Intl.DateTimeFormat('en-US', {
    weekday: 'short', month: 'short', day: 'numeric', ...zoneOpt(tzOf(opts)),
  }), d);
  const date = order === 'dm' ? `${v.day} ${v.month}` : `${v.month} ${v.day}`;
  return `${weekday ? `${v.weekday} ` : ''}${date}`;
}

/** "Sun Oct 4 · 1:00 PM PDT" - date and time from ONE call, zone labelled. */
export function dateTimeLabel(iso, opts = {}) {
  const d = asDate(iso);
  if (!d) return '';
  const tz = tzOf(opts);
  const v = partsOf(new Intl.DateTimeFormat('en-US', {
    weekday: 'short', month: 'short', day: 'numeric',
    hour: 'numeric', minute: '2-digit', hour12: true, ...zoneOpt(tz),
  }), d);
  const { zone = true } = opts;
  const label = zone ? zoneAbbr(d, tz) : '';
  return `${v.weekday} ${v.month} ${v.day} · ${v.hour}:${v.minute} ${v.dayPeriod}${label ? ` ${label}` : ''}`;
}

/** The calendar day an instant falls on in the zone, 'YYYY-MM-DD' (or ''). */
export function dayKeyIn(iso, opts = {}) {
  const d = asDate(iso);
  if (!d) return '';
  const v = partsOf(new Intl.DateTimeFormat('en-US', {
    year: 'numeric', month: '2-digit', day: '2-digit', ...zoneOpt(tzOf(opts)),
  }), d);
  return `${v.year}-${v.month}-${v.day}`;
}

/** "Sunday" - the weekday, in full, in the zone. */
export function weekdayLong(iso, opts = {}) {
  const d = asDate(iso);
  if (!d) return '';
  return new Intl.DateTimeFormat('en-US', { weekday: 'long', ...zoneOpt(tzOf(opts)) }).format(d);
}

/**
 * "5h 12m" / "12m" / "under 1m" - the time left until an instant, in whole
 * minutes, floored. A DURATION, so it is the same in every zone; a caller
 * that also names the instant uses timeLabel() beside it. null past it.
 */
export function untilLabel(iso, now = new Date()) {
  const d = asDate(iso); const n = asDate(now);
  if (!d || !n) return null;
  const left = d.getTime() - n.getTime();
  if (left <= 0) return null;
  if (left < 60_000) return 'under 1m';
  const mins = Math.floor(left / 60_000);
  const h = Math.floor(mins / 60);
  return h > 0 ? `${h}h ${mins % 60}m` : `${mins}m`;
}
