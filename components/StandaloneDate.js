'use client';

/**
 * StandaloneDate — client island rendering a UTC ISO timestamp as
 * "Tue Sep 8 · 6:00 AM PT" in the VISITOR's local timezone, zone
 * abbreviation appended. Same hydration-safe pattern as KickoffTime
 * (components/match/KickoffTime.js) and LocalTime: SSR and first
 * client render both format in UTC (identical bytes, no hydration
 * mismatch), then a useEffect swap to the visitor's local zone after
 * mount. Distinct from KickoffTime only in punctuation - a middle dot
 * between date and time rather than KickoffTime's weekday-leading
 * comma grammar, matching the /weekly and /draft hero's own voice.
 *
 * Zone label is the SPECIFIC short abbreviation (PDT/PST), the same
 * convention every other timestamp on this site already uses - not a
 * generic "PT" that would read differently for the same viewer across
 * a DST boundary.
 */

import { useEffect, useState } from 'react';

function formatFromParts(parts, zoneLabel) {
  const v = (t) => parts.find((p) => p.type === t)?.value ?? '';
  return `${v('weekday')} ${v('month')} ${v('day')} · ${v('hour')}:${v('minute')} ${v('dayPeriod')} ${zoneLabel}`;
}

function formatUtc(iso) {
  const fmt = new Intl.DateTimeFormat('en-US', {
    weekday: 'short', month: 'short', day: 'numeric',
    hour: 'numeric', minute: '2-digit', hour12: true, timeZone: 'UTC',
  });
  return formatFromParts(fmt.formatToParts(new Date(iso)), 'UTC');
}

function formatLocal(iso) {
  const fmt = new Intl.DateTimeFormat('en-US', {
    weekday: 'short', month: 'short', day: 'numeric',
    hour: 'numeric', minute: '2-digit', hour12: true, timeZoneName: 'short',
  });
  const parts = fmt.formatToParts(new Date(iso));
  const zoneLabel = parts.find((p) => p.type === 'timeZoneName')?.value ?? '';
  return formatFromParts(parts, zoneLabel);
}

export default function StandaloneDate({ iso }) {
  const [label, setLabel] = useState(() => formatUtc(iso));
  useEffect(() => { setLabel(formatLocal(iso)); }, [iso]);
  return <>{label}</>;
}
