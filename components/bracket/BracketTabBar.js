'use client';

/**
 * BracketTabBar — two-tab switcher for /bracket: "Group Stage" / "Tournament".
 *
 * Both panels already exist on the page (the group strip and the knockout
 * tree). This client island just owns the active-tab state, toggles the
 * matching [data-tab-panel] divs via the same classList-flip pattern
 * MatchTabBar uses, and syncs the URL hash for deep-linking.
 *
 * Default active tab is computed SERVER-SIDE in app/bracket/page.js
 * (based on whether all 72 WC group-stage matches are final) and passed
 * in as the defaultTab prop. The initial server render and the first
 * client render agree on which panel has the .active class → no
 * hydration content mismatch and no flash of the wrong panel on load.
 *
 * Hash override: if the URL carries #group or #tournament on mount, that
 * explicit user intent overrides the server-computed default. The
 * override is a post-mount setState; React handles it as a normal
 * client update (no hydration warning). A brief moment of the default
 * panel before the hash swap is acceptable — explicit deep-link
 * implies the user has JS enabled and tolerates the post-hydration
 * settle.
 *
 * Manual taps always win for the session and update the URL hash via
 * history.replaceState (no nav, no scroll jump).
 */

import { useEffect, useState } from 'react';

const VALID_TABS = ['group', 'tournament'];

export default function BracketTabBar({ defaultTab = 'group' }) {
  const [active, setActive] = useState(defaultTab);

  // Hash override on mount. window is only available client-side, so
  // this lives inside useEffect (not the initializer). Reading hash in
  // the useState initializer would diverge SSR from first client render.
  useEffect(() => {
    const hash = window.location.hash.replace(/^#/, '');
    if (VALID_TABS.includes(hash)) {
      setActive(hash);
    }
  }, []);

  // Toggle [data-tab-panel] elements' .active class. No dependency
  // array — re-runs on every render so the panel state can't drift if
  // the server re-renders (router.refresh()) with a different default
  // mid-session. Idempotent classList ops.
  useEffect(() => {
    const panels = document.querySelectorAll('[data-tab-panel]');
    for (const p of panels) {
      if (p.getAttribute('data-tab-panel') === active) p.classList.add('active');
      else p.classList.remove('active');
    }
  });

  function handleClick(tab) {
    setActive(tab);
    // history.replaceState (not pushState) — tab switches don't add
    // navigation history entries. The back button takes the user out
    // of the page, not through the tab history.
    if (typeof window !== 'undefined') {
      window.history.replaceState(null, '', `#${tab}`);
    }
  }

  const tabs = [
    { key: 'group', label: 'Group Stage' },
    { key: 'tournament', label: 'Tournament' },
  ];

  return (
    <div className="tab-bar" role="tablist">
      {tabs.map((t) => (
        <button
          key={t.key}
          type="button"
          role="tab"
          aria-selected={active === t.key}
          className={`tab${active === t.key ? ' active' : ''}`}
          onClick={() => handleClick(t.key)}
        >
          {t.label}
        </button>
      ))}
    </div>
  );
}
