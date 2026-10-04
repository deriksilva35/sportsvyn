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

import { dateLabel } from '@/lib/time/display';
import { useViewerZone } from '@/components/time/ViewerTz';

// The date in the reader's zone (sun-16 item B): lib/time/display.js's
// dateLabel, zone from useViewerZone.
export default function StandaloneDateOnly({ iso, serverTz = null }) {
  const tz = useViewerZone(serverTz);
  return <>{dateLabel(iso, { tz })}</>;
}
