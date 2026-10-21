'use client';

// Seconds left on a deadline, or null (no clock, or not yet ticked - the first
// tick lands after mount, so the server render and hydration agree).
import { useEffect, useState } from 'react';

export default function useSecondsLeft(deadline) {
  const [nowMs, setNowMs] = useState(null);
  useEffect(() => {
    if (!deadline) return undefined;
    const t = setInterval(() => setNowMs(Date.now()), 500);
    return () => clearInterval(t);
  }, [deadline]);
  if (!deadline || nowMs == null) return null;
  return Math.max(0, Math.ceil((new Date(deadline).getTime() - nowMs) / 1000));
}
