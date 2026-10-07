'use client';

/**
 * StandaloneDate — client island rendering a UTC ISO timestamp as
 * "Tue Sep 8 · 6:00 AM PT" in the VISITOR's local timezone, zone
 * abbreviation appended. Same hydration-safe pattern as KickoffTime
 * (components/match/KickoffTime.js) and LocalTime: SSR and first
 * client render both format the SAME deterministic way (identical
 * bytes, no hydration mismatch), then a useEffect swap to the
 * visitor's local zone after mount. Distinct from KickoffTime only in
 * punctuation - a middle dot between date and time rather than
 * KickoffTime's weekday-leading comma grammar, matching the /weekly
 * and /draft hero's own voice.
 *
 * SSR FALLBACK IS ET, NOT UTC (relay 1b) - the Weekly/Draft hero's
 * whole audience reads in US time zones and every lock/open time
 * elsewhere on these two pages is already ET-labeled; a signed-out,
 * pre-hydration UTC hour read as ahead-of-schedule where every other
 * clock on the page agreed with each other in ET.
 *
 * Zone label is the SPECIFIC short abbreviation (PDT/PST), the same
 * convention every other timestamp on this site already uses - not a
 * generic "PT" that would read differently for the same viewer across
 * a DST boundary.
 */

import { dateTimeKickoffLabel } from '@/lib/time/display';
import { useViewerZone } from '@/components/time/ViewerTz';

// The formatting is lib/time/display.js's dateTimeLabel; the zone is
// useViewerZone's (the page's sv_tz, then the device's) - sun-16 item B.
export default function StandaloneDate({ iso, serverTz = null, tbd = false }) {
  const tz = useViewerZone(serverTz);
  return <>{dateTimeKickoffLabel(iso, { tz, tbd })}</>;
}
