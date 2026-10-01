'use client';

// The gameweek's date window in the VIEWER's zone - StandaloneTime's
// hydration-safe pattern: the ET fallback on the server and the first client
// render, the device's zone after mount (lib/eplWeekly5/labels.js).

import { useEffect, useState } from 'react';
import { windowLabel } from '@/lib/eplWeekly5/labels';

export default function WindowLabel({ first, last }) {
  const [label, setLabel] = useState(() => windowLabel(first, last, { tz: null }));
  useEffect(() => {
    let tz;
    try { tz = Intl.DateTimeFormat().resolvedOptions().timeZone || undefined; } catch { tz = undefined; }
    setLabel(windowLabel(first, last, { tz }));
  }, [first, last]);
  return <>{label}</>;
}
