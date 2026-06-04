'use client';

/**
 * MatchTabBar — client tab navigation for /match/[slug].
 *
 * Visibility is computed server-side from match.status and passed in via
 * the `tabs` prop. This component just owns the active-tab state and
 * toggles the matching .tab-panel via [data-active-tab] on the parent.
 *
 * The server renders all tab panels into the DOM; CSS hides inactive
 * ones via .tab-panel.active. We flip the panel by adding/removing
 * the .active class on the panel matching the clicked tab.
 */

import { useEffect, useRef, useState } from 'react';

export default function MatchTabBar({ tabs, defaultTab }) {
  const [active, setActive] = useState(defaultTab);
  const barRef = useRef(null);

  // No dependency array — re-assert panel .active on every render so the
  // client state stays the source of truth even after router.refresh()
  // re-renders the server tree with a different defaultTab (e.g. when
  // KickoffWatcher detects scheduled→live and the server's new JSX
  // would otherwise flip which panel has the active class). Idempotent:
  // classList ops on already-correct elements are no-ops.
  useEffect(() => {
    const panels = document.querySelectorAll('[data-tab-panel]');
    for (const p of panels) {
      if (p.getAttribute('data-tab-panel') === active) p.classList.add('active');
      else p.classList.remove('active');
    }
  });

  // Mobile: when the tab row overflows horizontally (≤390px can't fit
  // all five labels), center the active tab in view on change.
  // block:'nearest' prevents any vertical page-scroll. Guarded on
  // scrollWidth > clientWidth so desktop (no overflow) is a no-op.
  useEffect(() => {
    const bar = barRef.current;
    if (!bar) return;
    if (bar.scrollWidth <= bar.clientWidth) return;
    const btn = bar.querySelector('.tab.active');
    if (!btn) return;
    btn.scrollIntoView({ inline: 'center', block: 'nearest', behavior: 'smooth' });
  }, [active]);

  // .tab-bar-scroll wraps .tab-bar in a flex container so the
  // scroll-container .tab-bar becomes a flex item with min-width: 0.
  // Without the wrapper, the .tab-bar's nowrap .tab buttons (sum
  // ≈ 727px) were laying out at their full positions on iOS Safari
  // — even with overflow-x:auto on .tab-bar, iOS sized the layout
  // viewport to that full content width on first paint and refused
  // to retract it. As a flex item with `flex:1 min-width:0`, the
  // .tab-bar's content can't establish its parent's width — the
  // buttons still scroll internally, but their layout positions
  // can't bubble up to widen the document.
  return (
    <div className="tab-bar-scroll">
      <div className="tab-bar" role="tablist" ref={barRef}>
        {tabs.map((t) => (
          <button
            key={t.key}
            type="button"
            role="tab"
            aria-selected={active === t.key}
            className={`tab${active === t.key ? ' active' : ''}${t.hidden ? ' hidden' : ''}`}
            onClick={() => setActive(t.key)}
          >
            {t.label}
            {t.dot && <span className={`dot${t.dot === 'live' ? ' live' : ''}${t.dot === 'muted' ? ' muted' : ''}`} />}
          </button>
        ))}
      </div>
    </div>
  );
}
