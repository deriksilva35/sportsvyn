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

import { useEffect, useState } from 'react';

export default function MatchTabBar({ tabs, defaultTab }) {
  const [active, setActive] = useState(defaultTab);

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

  return (
    <div className="tab-bar" role="tablist">
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
  );
}
