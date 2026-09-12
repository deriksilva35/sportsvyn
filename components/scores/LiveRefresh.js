'use client';
// components/scores/LiveRefresh.js - the scoreboard's 30 s refresh (SCORES TAB v2, 8e).
//
// Mounted ONLY when a card is live (the server decides; see ScoresV2). It
// calls router.refresh() on an interval, and the interval is cleared while
// the tab is hidden - a background tab must not poll. This is the scoreboard
// only; the game page's refresher is its own relay.

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

export const LIVE_REFRESH_MS = 30_000;

export default function LiveRefresh({ everyMs = LIVE_REFRESH_MS }) {
  const router = useRouter();
  useEffect(() => {
    let timer = null;
    const start = () => { if (timer == null) timer = setInterval(() => router.refresh(), everyMs); };
    const stop = () => { if (timer != null) { clearInterval(timer); timer = null; } };
    const onVis = () => { if (document.visibilityState === 'hidden') stop(); else start(); };
    if (document.visibilityState !== 'hidden') start();
    document.addEventListener('visibilitychange', onVis);
    return () => { stop(); document.removeEventListener('visibilitychange', onVis); };
  }, [router, everyMs]);
  return null;
}
