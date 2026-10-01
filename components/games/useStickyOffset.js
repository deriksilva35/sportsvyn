'use client';

// components/games/useStickyOffset.js - where a room's sticky layers start.
//
// On the web the site's global header (.gi-head) is itself sticky at top 0,
// 63-69 px tall depending on the width; in the app it is not sticky at all and
// scrolls away. A room that sticks its picker to the top must start under that
// bar, so this measures it and publishes the height as a custom property on the
// room's root (default --gi-stick). No bar, or a bar that is not sticky: the
// property stays unset and the CSS fallback (0px) applies. The Weekly room does
// the same inline (components/weekly/WeeklyRoom.js --wkv-stick).

import { useEffect } from 'react';

export function useStickyOffset(ref, varName = '--gi-stick') {
  useEffect(() => {
    const el = ref.current;
    const bar = typeof document !== 'undefined' ? document.querySelector('.gi-head') : null;
    if (!el || !bar || getComputedStyle(bar).position !== 'sticky') return undefined;
    const set = () => el.style.setProperty(varName, `${Math.round(bar.getBoundingClientRect().height)}px`);
    set();
    const ro = typeof ResizeObserver === 'function' ? new ResizeObserver(set) : null;
    ro?.observe(bar);
    return () => ro?.disconnect();
  }, [ref, varName]);
}
