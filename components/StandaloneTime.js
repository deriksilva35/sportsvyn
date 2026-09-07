'use client';

/**
 * StandaloneTime - the TIME half of StandaloneDate: "1:00 PM PDT", in the
 * VISITOR's zone, zone abbreviation appended. Same hydration-safe pattern
 * as StandaloneDate, StandaloneDateOnly, KickoffTime and LocalTime - SSR
 * and the first client render format identically (ET), then a useEffect
 * swaps to the visitor's own zone after mount.
 *
 * WHY IT HAD TO EXIST (relay 3b item 2). Pick'em's kickoff cell renders
 * inside a row that is already carrying two team names and a spread, so
 * StandaloneDate's full "Sun Sep 7 · 1:00 PM PDT" does not fit; the day is
 * already stated by the group header the row sits under, so repeating it
 * per row was never wanted either. Before this, that cell was the last
 * formatter on the four game surfaces still printing a hardcoded " ET" - a
 * board whose header said "lock Sun Sep 7 · 10:00 AM PDT" and whose rows
 * said "1:00 PM ET", three hours apart, both correct, on one screen.
 *
 * SSR FALLBACK IS ET for the same reason StandaloneDate's is: an
 * unhydrated UTC hour reads as a schedule error to an audience that is
 * entirely in US zones.
 */

import { useEffect, useState } from 'react';

function formatFromParts(parts, zoneLabel) {
  const v = (t) => parts.find((p) => p.type === t)?.value ?? '';
  return `${v('hour')}:${v('minute')} ${v('dayPeriod')} ${zoneLabel}`;
}

function formatEasternFallback(iso) {
  const fmt = new Intl.DateTimeFormat('en-US', {
    hour: 'numeric', minute: '2-digit', hour12: true, timeZone: 'America/New_York',
  });
  return formatFromParts(fmt.formatToParts(new Date(iso)), 'ET');
}

function formatLocal(iso) {
  const fmt = new Intl.DateTimeFormat('en-US', {
    hour: 'numeric', minute: '2-digit', hour12: true, timeZoneName: 'short',
  });
  const parts = fmt.formatToParts(new Date(iso));
  return formatFromParts(parts, parts.find((p) => p.type === 'timeZoneName')?.value ?? '');
}

export default function StandaloneTime({ iso }) {
  const [label, setLabel] = useState(() => formatEasternFallback(iso));
  useEffect(() => { setLabel(formatLocal(iso)); }, [iso]);
  return <>{label}</>;
}
