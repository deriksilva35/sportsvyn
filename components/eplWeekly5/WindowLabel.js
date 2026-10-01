'use client';

// The gameweek's date window in the VIEWER's zone, hydration-safe: the server
// and the hydrating render read the ET fallback (getServerSnapshot -> null),
// then React re-renders with the device's zone (lib/eplWeekly5/labels.js).

import { useSyncExternalStore } from 'react';
import { windowLabel } from '@/lib/eplWeekly5/labels';

const subscribe = () => () => {};
function browserZone() {
  try { return Intl.DateTimeFormat().resolvedOptions().timeZone || undefined; } catch { return undefined; }
}

export default function WindowLabel({ first, last }) {
  const tz = useSyncExternalStore(subscribe, browserZone, () => null);
  return <>{windowLabel(first, last, { tz })}</>;
}
