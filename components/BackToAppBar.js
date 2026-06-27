'use client';

/**
 * BackToAppBar — a "‹ Back to Sportsvyn" strip shown ONLY when /player and
 * /team are loaded inside the Capacitor native shell.
 *
 * The native app loads sportsvyn.com/app; tapping a player/team row navigates
 * the SAME WebView to /player or /team (a chrome-less website page with no app
 * nav). The WebView keeps a history entry back to /app, so history.back()
 * returns to the shell — this bar is the affordance that was missing.
 *
 * Visibility gate: detection runs in a useEffect so SSR + first browser paint
 * render NOTHING. On the real website (no window.Capacitor) the bar never
 * shows; it only appears inside the Capacitor WebView. No hydration mismatch
 * because both server and first client render return null.
 *
 * Layout: a position:fixed bar at top:0 (always reachable) plus an in-flow
 * spacer of equal height as the next element, so the page's SiteHeaderServer
 * (rendered right after this component) flows below the bar instead of under
 * it — no page restructuring, nothing overlaps. Styled inline with the app's
 * tokens (ink / volt / mono) so no CSS file or class collisions.
 */

import { useEffect, useState } from 'react';

const BAR_HEIGHT = '44px';

export default function BackToAppBar() {
  const [inApp, setInApp] = useState(false);

  useEffect(() => {
    setInApp(
      typeof window !== 'undefined' &&
      !!(window.Capacitor?.isNativePlatform?.() ?? window.Capacitor),
    );
  }, []);

  if (!inApp) return null;

  function goBack() {
    if (typeof window === 'undefined') return;
    // history.back() returns to the /app shell; the fallback covers a
    // cold/direct load with no history (sends them into the shell).
    if (window.history.length > 1) window.history.back();
    else window.location.href = '/app';
  }

  const barStyle = {
    position: 'fixed',
    top: 0,
    left: 0,
    right: 0,
    zIndex: 9999,
    display: 'flex',
    alignItems: 'center',
    height: `calc(${BAR_HEIGHT} + env(safe-area-inset-top, 0px))`,
    paddingTop: 'env(safe-area-inset-top, 0px)',
    background: '#0A0A0A',
    borderBottom: '1px solid #1d1d1d',
  };
  const btnStyle = {
    appearance: 'none',
    WebkitAppearance: 'none',
    background: 'transparent',
    border: 0,
    color: '#D4FF00',
    cursor: 'pointer',
    fontFamily: 'var(--font-jetbrains-mono), ui-monospace, monospace',
    fontSize: '12px',
    fontWeight: 500,
    letterSpacing: '0.1em',
    textTransform: 'uppercase',
    height: BAR_HEIGHT,
    padding: '0 16px',
    WebkitTapHighlightColor: 'transparent',
  };
  const spacerStyle = { height: `calc(${BAR_HEIGHT} + env(safe-area-inset-top, 0px))` };

  return (
    <>
      <div style={barStyle} role="navigation" aria-label="Back to app">
        <button type="button" style={btnStyle} onClick={goBack} aria-label="Back to Sportsvyn">
          {'‹'} Back to Sportsvyn
        </button>
      </div>
      <div style={spacerStyle} aria-hidden="true" />
    </>
  );
}
