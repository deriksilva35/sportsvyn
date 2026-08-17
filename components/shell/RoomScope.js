'use client';

/**
 * components/shell/RoomScope.js - a room tells the app chrome what it is.
 *
 * ONE MODE SIGNAL, TWO CONSUMERS. /sim/draft/[id] serves BOTH the practice sim
 * and the tracker, so no path test can tell them apart - which broke two things
 * in different directions:
 *
 *   · THE TAB. Starting a tracker room from the TRACKER tab landed the user in
 *     a room with PRACTICE lit, because activeTabFor saw /sim and had nothing
 *     else to go on. You do not change section by starting the thing the
 *     section is for.
 *   · THE BAR. The first version of the chrome-isolation law suppressed this
 *     whole route as clock-owned, which stranded tracker users in a room they
 *     could not navigate out of. That was fixed by having the timed room raise
 *     a clock flag - the same shape as this, arrived at separately.
 *
 * So both now come off one declaration the room makes about itself. `tab` names
 * the section it belongs to; `timed` says whether a clock is running. The
 * attributes clear on unmount and on pagehide, because a stale one is worse
 * than never having set it: a tab lit for the wrong section is confusing, and a
 * clock flag left set hides the only navigation the container has.
 */

import { useEffect } from 'react';

export default function RoomScope({ tab = null, timed = false }) {
  useEffect(() => {
    const el = document.documentElement;
    if (tab) el.setAttribute('data-tab', tab);
    if (timed) el.setAttribute('data-clock', 'live');
    const clear = () => {
      el.removeAttribute('data-tab');
      if (timed) el.removeAttribute('data-clock');
    };
    window.addEventListener('pagehide', clear);
    return () => { window.removeEventListener('pagehide', clear); clear(); };
  }, [tab, timed]);
  return null;
}
