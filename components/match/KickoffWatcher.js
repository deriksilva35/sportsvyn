'use client';

/**
 * KickoffWatcher — invisible client component that detects status
 * transitions (scheduled → live, live → final) on an open page and
 * triggers a server re-render via router.refresh(), so the user does
 * not need to manually refresh at kickoff or full-time.
 *
 * Lifecycle:
 *   - If initialStatus is terminal ('final' / 'postponed' / 'cancelled')
 *     the watcher does nothing: no timers, no fetches.
 *   - Otherwise it computes a polling window of [kickoff − 30min,
 *     kickoff + 180min]:
 *     · Page loaded BEFORE the window → setTimeout sleeps until the
 *       window opens, then begins polling.
 *     · Page loaded INSIDE the window → polls immediately on mount.
 *     · Page loaded AFTER the window (e.g. opened the next morning while
 *       the match somehow still says 'scheduled') → no polling; the
 *       hard stop has already passed.
 *   - Polling cadence: every 60s (POLL_MS). Each tick reads
 *     /api/match/[slug]/status. On any status change, the new value is
 *     remembered and router.refresh() is called once.
 *   - Once the new status itself is terminal, polling stops early.
 *   - All timers cleared on unmount.
 *
 * Renders null. Mount it anywhere on the page; placement is cosmetic.
 *
 * Tab behavior intentionally NOT touched: when router.refresh() re-runs
 * the server component, MatchTabBar's open-tab useState persists, so
 * users stay on whichever tab they were viewing. The Live dot already
 * signals the transition; force-switching tabs would feel jarring.
 */

import { useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';

const TERMINAL_STATUSES = new Set(['final', 'postponed', 'cancelled']);
const WINDOW_PRE_MIN = 30;
const WINDOW_POST_MIN = 180;
const POLL_MS = 60_000;

export default function KickoffWatcher({ slug, initialStatus, kickoffAt }) {
  const router = useRouter();
  // useRef avoids re-running the effect when the last-known status changes;
  // also dodges stale-closure bugs inside the long-lived setInterval.
  const lastStatusRef = useRef(initialStatus);

  useEffect(() => {
    if (TERMINAL_STATUSES.has(initialStatus)) return;
    if (!slug || !kickoffAt) return;

    const kickoffMs = new Date(kickoffAt).getTime();
    if (!Number.isFinite(kickoffMs)) return;

    const startAt = kickoffMs - WINDOW_PRE_MIN * 60_000;
    const stopAt = kickoffMs + WINDOW_POST_MIN * 60_000;
    const nowMs = Date.now();

    if (nowMs >= stopAt) return; // window already closed

    let startTimeoutId = null;
    let intervalId = null;
    let stopTimeoutId = null;

    async function check() {
      try {
        const res = await fetch(`/api/match/${slug}/status`, { cache: 'no-store' });
        if (!res.ok) return;
        const data = await res.json();
        if (data?.status && data.status !== lastStatusRef.current) {
          lastStatusRef.current = data.status;
          router.refresh();
          if (TERMINAL_STATUSES.has(data.status)) {
            if (intervalId) clearInterval(intervalId);
            if (stopTimeoutId) clearTimeout(stopTimeoutId);
            intervalId = null;
            stopTimeoutId = null;
          }
        }
      } catch {
        // network blip — next tick will retry
      }
    }

    function startPolling() {
      const msUntilStop = stopAt - Date.now();
      if (msUntilStop > 0) {
        stopTimeoutId = setTimeout(() => {
          if (intervalId) clearInterval(intervalId);
          intervalId = null;
        }, msUntilStop);
      }
      intervalId = setInterval(check, POLL_MS);
      check(); // tick once immediately so transitions that already happened upgrade fast
    }

    if (nowMs >= startAt) {
      startPolling();
    } else {
      startTimeoutId = setTimeout(startPolling, startAt - nowMs);
    }

    return () => {
      if (startTimeoutId) clearTimeout(startTimeoutId);
      if (intervalId) clearInterval(intervalId);
      if (stopTimeoutId) clearTimeout(stopTimeoutId);
    };
  }, [slug, initialStatus, kickoffAt, router]);

  return null;
}
