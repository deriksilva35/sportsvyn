'use client';

/**
 * LocalDate — client island that renders a UTC ISO timestamp as a
 * SHORT DATE (e.g. "Jun 4") in the VISITOR's local timezone.
 *
 * No zone abbreviation — date-only cells aren't ambiguous the way
 * time-bearing cells are; appending "PDT" to "Jun 4" reads wrong.
 *
 * Crossing the UTC date boundary is real and INTENTIONAL: a match
 * stored at 02:00 UTC June 5 is shown as "Jun 4" to a PT viewer
 * because that's when they experienced it locally. The current-
 * UTC-date rendering on prod was actively misleading for non-UTC
 * viewers.
 *
 * Hydration strategy mirrors KickoffTime: useState initializer
 * computes the UTC date deterministically (same bytes SSR + first
 * client render → no hydration warning), useEffect then swaps to
 * the visitor's local date.
 */

import { useEffect, useState } from 'react';

const OPTIONS = { month: 'short', day: 'numeric' };

function formatUtc(iso) {
  return new Intl.DateTimeFormat('en-US', { ...OPTIONS, timeZone: 'UTC' }).format(new Date(iso));
}

function formatLocal(iso) {
  // undefined locale → visitor's browser default; no timeZone option →
  // visitor's system zone.
  return new Intl.DateTimeFormat(undefined, OPTIONS).format(new Date(iso));
}

export default function LocalDate({ iso }) {
  const [label, setLabel] = useState(() => formatUtc(iso));
  useEffect(() => { setLabel(formatLocal(iso)); }, [iso]);
  return <>{label}</>;
}
