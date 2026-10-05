'use client';
// components/games/PlayCloses.js - "closes midnight" / "closes 9:00 PM" (sun-21).
//
// THE PlayWhen PATTERN: the first render (server and client alike) is in the
// zone the server knows, and after mount it settles on the device's zone. The
// word "midnight" is used only when the close instant IS 00:00 in that zone;
// otherwise it is the lobby's own clock reading (lib/games/playTime.js).

import { useEffect, useState } from 'react';
import { playTimeLabel } from '@/lib/games/playTime';

/** True when `iso` is exactly 00:00 on the clock in `tz` (null = ET, undefined = here). */
export function isMidnightIn(iso, tz) {
  const zone = tz === null ? { timeZone: 'America/New_York' } : tz ? { timeZone: tz } : {};
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23', ...zone })
    .formatToParts(new Date(iso)).map((x) => [x.type, x.value]));
  return p.hour === '00' && p.minute === '00';
}

export function closesLabel(iso, { now, tz } = {}) {
  if (!iso) return '';
  return isMidnightIn(iso, tz) ? 'midnight' : playTimeLabel(iso, { now, tz });
}

export default function PlayCloses({ iso, now = null, serverTz = null }) {
  const [text, setText] = useState(() => closesLabel(iso, { now, tz: serverTz ?? null }));
  // THE DEVICE'S ZONE BY NAME: playTimeLabel's tz defaults undefined to null
  // (the ET fallback), so "here" has to be spelled out.
  useEffect(() => {
    const here = Intl.DateTimeFormat().resolvedOptions().timeZone;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- the device's zone exists only after mount; PlayWhen does the same
    setText(closesLabel(iso, { now, tz: here }));
  }, [iso, now]);
  return <>closes {text}</>;
}
