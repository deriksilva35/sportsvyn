'use client';

/**
 * StandaloneDateOnly — StandaloneDate's sibling for a line that names a DAY,
 * not a moment: "Tue Sep 8", no time, no zone abbreviation. Same
 * hydration-safe shape (SSR and first client render both format in ET, a
 * useEffect swap to the visitor's local zone after mount) - relay 2c-fix
 * item 1's "Board {n} opens {date}" clause, which the mock states as a bare
 * date, unlike the "first lock {date} · {time} {zone}" clause beside it
 * (StandaloneDate itself, unchanged).
 *
 * A zone label would be noise here: a calendar DATE only reads differently
 * across zones within a few hours of the viewer's local midnight, and even
 * then it is still just a date - "Tue Sep 8" needs no "ET" appended the way
 * a clock reading does.
 */

import { useEffect, useState } from 'react';

function formatFromParts(parts) {
  const v = (t) => parts.find((p) => p.type === t)?.value ?? '';
  return `${v('weekday')} ${v('month')} ${v('day')}`;
}

function formatEasternFallback(iso) {
  const fmt = new Intl.DateTimeFormat('en-US', {
    weekday: 'short', month: 'short', day: 'numeric', timeZone: 'America/New_York',
  });
  return formatFromParts(fmt.formatToParts(new Date(iso)));
}

function formatLocal(iso) {
  const fmt = new Intl.DateTimeFormat('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
  return formatFromParts(fmt.formatToParts(new Date(iso)));
}

export default function StandaloneDateOnly({ iso }) {
  const [label, setLabel] = useState(() => formatEasternFallback(iso));
  useEffect(() => { setLabel(formatLocal(iso)); }, [iso]);
  return <>{label}</>;
}
