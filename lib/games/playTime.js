// lib/games/playTime.js - the Play lobby's time and date words, PURE.
//
// ONE ZONE PER SCREEN. Every instant on the Play tab is rendered in the page's
// zone - the sv_tz cookie on the server's first paint, the device's own after
// mount (components/games/PlayWhen.js) - and the header names that same zone
// (components/scores/ZoneLabel). The formatting itself is lib/time/display.js;
// this file adds only the lobby's two shapes and "is this today".
//
// tz follows display.js's contract exactly: null = the ET fallback the server
// emits, undefined = the running environment's zone, a string forces it.
//
// READ WITH `'tz' in opts` (sun-16 item B). This file used to destructure
// `{ tz = null }`, and a default fires for undefined too: PlayWhen's
// after-mount "the device's zone" call came out Eastern, so the lobby read
// "first lock Sat 7:30 AM" in Los Angeles and in London under a header naming
// each reader's own zone.

import { timeLabel, dateLabel, dayKeyIn } from '../time/display.js';

const tzOf = (opts) => ('tz' in (opts ?? {}) ? opts.tz : null);

/** "Tue 20 Oct" (weekday) or "20 Oct". */
export function playDateLabel(iso, opts = {}) {
  if (!iso) return '';
  return dateLabel(iso, { tz: tzOf(opts), weekday: opts.weekday ?? true, order: 'dm' });
}

/** The calendar day of an instant in a zone, 'YYYY-MM-DD'. */
export function dayIn(iso, tz = null) {
  return dayKeyIn(iso, { tz });
}

/**
 * A lock time on the lobby: "5:15 PM" today, "Sun 10:00 AM" on any other day.
 * The zone suffix is left off - the header states it once for the screen.
 */
export function playTimeLabel(iso, opts = {}) {
  if (!iso) return '';
  const tz = tzOf(opts);
  const { now } = opts;
  const today = now != null && dayKeyIn(iso, { tz }) === dayKeyIn(now, { tz });
  return timeLabel(iso, { weekday: !today, zone: false, tz });
}
