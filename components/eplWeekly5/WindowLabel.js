'use client';

// The gameweek's date window in the VIEWER's zone, hydration-safe: the server
// and the hydrating render read the ET fallback (getServerSnapshot -> null),
// then React re-renders with the device's zone (lib/eplWeekly5/labels.js).

import { windowLabel } from '@/lib/eplWeekly5/labels';
import { useViewerZone } from '@/components/time/ViewerTz';

export default function WindowLabel({ first, last }) {
  const tz = useViewerZone();
  return <>{windowLabel(first, last, { tz })}</>;
}
