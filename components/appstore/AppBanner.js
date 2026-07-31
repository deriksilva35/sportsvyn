'use client';

// components/appstore/AppBanner.js — the client half: dismissal.
//
// Rendered ONLY by GetTheAppBanner, which has already decided this is web (not
// shell) and that APP_STORE_URL holds a real listing. This half exists purely
// because "did you already dismiss it?" lives in localStorage, which the server
// cannot read.
//
// useSyncExternalStore, NOT useState + useEffect. localStorage is precisely what
// this hook is for - an external store React does not own - and it buys three
// things the effect version does not:
//   · The server/hydration snapshot is a first-class concept (getServerSnapshot),
//     so rendering nothing on the server and re-deciding on the client is the
//     hook's designed behaviour rather than a hydration mismatch to paper over.
//   · No setState inside an effect, which is a lint error in this repo and a
//     cascading-render hazard in React 19.
//   · Dismissing in one tab hides it in the others, free, via the storage event.
//
// IT RENDERS NOTHING ON THE SERVER, ON PURPOSE. getServerSnapshot returns
// "dismissed", so the SSR HTML and the hydrating client agree on empty, and
// someone who dismissed this yesterday never sees it flash back in. The cost is
// that the banner appears a beat after hydration, which for a dismissible promo
// is the correct trade.
//
// MOBILE-WEB ONLY is enforced in CSS (app-banner.css), not here: a viewport media
// query needs no UA sniffing and no second render pass. Note the deliberate
// non-decision - the banner is NOT gated on iOS. It points at an iOS-only app, so
// an Android visitor sees an offer they cannot take; gating on UA would mean
// either sniffing server-side (a cache key on every page) or a second client
// render. When Draftvyn is live and the analytics say Android mobile traffic is
// material, this is the line to revisit.

import { useSyncExternalStore } from 'react';
import { APP_BANNER_DISMISS_KEY, APP_BANNER_DISMISSED } from '@/lib/appBanner';
import { APP_BANNER } from './appBannerCopy';
import './app-banner.css';

// Same-tab dismissals do not fire `storage` (the spec only notifies OTHER
// documents), so the click dispatches this to nudge the store itself.
const DISMISS_EVENT = 'sv:app-banner-dismissed';

// Module scope: subscribe must be referentially stable, or the hook tears down
// and re-registers the listeners on every render.
function subscribe(onChange) {
  window.addEventListener('storage', onChange);
  window.addEventListener(DISMISS_EVENT, onChange);
  return () => {
    window.removeEventListener('storage', onChange);
    window.removeEventListener(DISMISS_EVENT, onChange);
  };
}

function isDismissed() {
  // Safari private browsing and hardened privacy settings THROW on access rather
  // than returning null. A storage failure must not take the page down, and
  // "we could not read the preference" degrades to showing the banner.
  try {
    return window.localStorage.getItem(APP_BANNER_DISMISS_KEY) === APP_BANNER_DISMISSED;
  } catch {
    return false;
  }
}

// Server + first-hydration snapshot. Erring toward "dismissed" is what keeps the
// banner out of the SSR HTML entirely.
const isDismissedOnServer = () => true;

export default function AppBanner({ url }) {
  const dismissed = useSyncExternalStore(subscribe, isDismissed, isDismissedOnServer);

  function dismiss() {
    try {
      window.localStorage.setItem(APP_BANNER_DISMISS_KEY, APP_BANNER_DISMISSED);
    } catch {
      // Persisting failed (private mode, quota). The event below still closes it
      // for this page - a dismiss that visibly does nothing is worse than one
      // that does not stick.
    }
    window.dispatchEvent(new Event(DISMISS_EVENT));
  }

  if (dismissed) return null;

  return (
    <aside className="appbanner" data-surface="ink">
      {/* target=_blank so the tap does not cost the reader their place: on iOS an
          apps.apple.com link hands off to the App Store app, and if it does not
          (desktop, in-app browsers) they still keep the sim page they were on. */}
      <a className="appbanner-main" href={url} target="_blank" rel="noopener noreferrer">
        <span className="appbanner-copy">
          <span className="appbanner-head">{APP_BANNER.headline}</span>
          <span className="appbanner-line">{APP_BANNER.line}</span>
        </span>
        {/* Apple's badge lockup, built in markup rather than shipping their PNG -
            same call AppleSignInButton makes for the sign-in button. The logomark
            is never recolored: white mark on black, per Apple's guidelines.
            aria-hidden because the anchor is already named by the copy above it;
            a screen reader does not need "Download on the App Store" twice. */}
        <span className="appbanner-badge" aria-hidden="true">
          <svg width="17" height="17" viewBox="0 0 24 24" fill="currentColor">
            <path d="M16.365 1.43c0 1.14-.493 2.27-1.177 3.08-.744.9-1.99 1.57-2.987 1.57-.12 0-.23-.02-.3-.03-.01-.06-.04-.22-.04-.39 0-1.15.572-2.27 1.206-2.98.804-.94 2.142-1.64 3.248-1.68.03.13.05.28.05.43zm4.565 15.71c-.03.07-.463 1.58-1.518 3.12-.945 1.34-1.94 2.71-3.43 2.74-1.517.03-2.02-.87-3.71-.87-1.68 0-2.24.84-3.65.9-1.47.05-2.61-1.45-3.53-2.83-1.9-2.76-3.35-7.81-1.4-11.22.97-1.69 2.7-2.76 4.6-2.79 1.44-.03 2.79.98 3.66.98.87 0 2.5-1.21 4.22-1.03.72.03 2.74.29 4.04 2.19-.11.07-2.41 1.41-2.38 4.21.03 3.34 2.92 4.45 2.95 4.46z" />
          </svg>
          <span className="appbanner-badge-txt">
            <span className="pre">{APP_BANNER.badgePre}</span>
            <span className="store">{APP_BANNER.badgeStore}</span>
          </span>
        </span>
      </a>
      <button
        type="button"
        className="appbanner-x"
        onClick={dismiss}
        aria-label={APP_BANNER.dismissLabel}
      >
        ×
      </button>
    </aside>
  );
}
