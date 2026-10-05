'use client';
// components/games/DailyCountdown.js - "Next board in 5h 12m · 9:00 PM" (mon-2).
//
// THE FIRST RENDER IS THE SERVER'S: the countdown is measured from the view's
// own `now` and the time is in the zone the server knows, so hydration matches.
// After mount it measures from the device clock every 30 s, and the time
// settles on the device's zone with the header's zone label (useViewerZone).
// The countdown is a duration - the same everywhere; the clock reading beside
// it is the one part a zone changes, and it is formatted by lib/time/display.js.

import { useEffect, useState } from 'react';
import { timeLabel, untilLabel } from '@/lib/time/display';
import { useViewerZone } from '@/components/time/ViewerTz';

export default function DailyCountdown({ iso, now = null, serverTz = null, everyMs = 30_000 }) {
  const tz = useViewerZone(serverTz);
  const [at, setAt] = useState(now);
  useEffect(() => {
    const tick = () => setAt(new Date().toISOString());
    const first = setTimeout(tick, 0); // the device clock, right after hydration
    const id = setInterval(tick, everyMs);
    return () => { clearTimeout(first); clearInterval(id); };
  }, [everyMs]);
  const left = untilLabel(iso, at ?? new Date());
  if (!left) return <span className="pd-next">The next board is open</span>;
  return (
    <span className="pd-next">
      Next board in <b>{left}</b> · {timeLabel(iso, { tz, zone: false })}
    </span>
  );
}
