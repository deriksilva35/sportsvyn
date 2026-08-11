'use client';

// components/sim/WelcomeSheet.js — the first-launch sheet, ONCE per device.
//
// ONE SCREEN, TWO PRODUCTS. The previous version led with the free tier, spent
// more words on the Draft Pass than on the thing it was selling, and ended on a
// price with a buy button under it - so the first screen a new account saw was
// mostly about paying, and the Tracker (the harder product to discover, and the
// reason anyone would pay) was one clause inside the Pass sentence.
//
// Each product now gets its own half and its own INSTRUCTION - what to tap, in
// order - because the measured problem is not that people decline, it is that
// they arrive and do nothing. The Pass is one line. There is no purchase
// control here at all: buying lives on the MembershipCard and the tracker gate,
// where somebody has actually reached for something.
//
// Rendered only by the /sim lobby, and only when the server has already decided
// this is shell + APPLE_IAP_ENABLED + a signed-in NON-member. Three separate
// suppressions, each for its own reason:
//   · not on web       - it is an app onboarding moment, and the website has its
//                        own front door
//   · not to members   - they own the thing it is explaining
//   · not with the flag off - the secondary action is a purchase
//
// ONCE PER DEVICE, via localStorage draftvyn_welcomed=1. "Once" is the whole
// contract: an onboarding sheet that reappears is worse than no sheet, so the key
// is written on EVERY exit path (both buttons, the backdrop, Escape), not just
// the primary one. It is written BEFORE the state flips, so even if the render
// that follows throws, the sheet is already spent.
//
// useSyncExternalStore, not useState+useEffect: the server has no localStorage,
// the client does, and getServerSnapshot returning "welcomed" keeps the sheet out
// of the SSR HTML entirely - so a returning user never sees it flash before an
// effect removes it. Same reasoning as components/appstore/AppBanner.js, and it
// avoids the setState-in-effect this repo lints as an error.
//
// THE SECONDARY IS A ROUTE, NOT A PURCHASE. "Set up the Tracker" dismisses and
// scrolls to TrackerStart, and reports itself as its own control - so the ledger
// can distinguish "went to mock" from "went to tracker" from "made it go away",
// which is the question the sheet exists to answer.

import { useEffect, useRef, useSyncExternalStore } from 'react';
import { WELCOME } from './membershipCopy';
import { sheetShown, sheetDismissed } from '@/app/actions/welcomeSheet';

// The TrackerStart section's anchor. The secondary link dismisses and scrolls
// there rather than navigating - the sheet sits ON the lobby, so the thing it
// points at is already on screen behind it.
export const TRACKER_ANCHOR = 'tracker-start';

export const WELCOME_KEY = 'draftvyn_welcomed';
export const WELCOME_VALUE = '1';

const DISMISS_EVENT = 'sv:welcome-dismissed';

function subscribe(onChange) {
  window.addEventListener(DISMISS_EVENT, onChange);
  return () => window.removeEventListener(DISMISS_EVENT, onChange);
}

function isWelcomed() {
  // Safari private browsing throws on access rather than returning null. A
  // storage failure must not take the lobby down - and it errs toward SHOWING
  // the sheet, which is the recoverable direction (the user closes it) rather
  // than silently swallowing onboarding forever.
  try {
    return window.localStorage.getItem(WELCOME_KEY) === WELCOME_VALUE;
  } catch {
    return false;
  }
}

// Server + first-hydration snapshot: treat everyone as already welcomed, so the
// sheet is never in the server HTML.
const welcomedOnServer = () => true;

export default function WelcomeSheet() {
  const welcomed = useSyncExternalStore(subscribe, isWelcomed, welcomedOnServer);

  // LEDGERED, because this is the first screen a new account sees and until now
  // nothing recorded whether it appeared or how it was got rid of. A ref rather
  // than state: the row id is never rendered, and setting state from an effect
  // is a lint error in this repo for good reasons.
  const rowRef = useRef(null);
  useEffect(() => {
    if (welcomed) return;
    // Floating on purpose and safe here: sheetShown swallows everything and
    // returns null, and nothing downstream waits on it. The sheet must paint
    // whether or not the ledger is reachable.
    sheetShown().then((id) => { rowRef.current = id; }).catch(() => {});
  }, [welcomed]);

  function dismiss(via) {
    try {
      window.localStorage.setItem(WELCOME_KEY, WELCOME_VALUE);
    } catch {
      // Persisting failed (private mode, quota). Still close it for this
      // session - a dismiss that visibly does nothing is worse than one that
      // does not stick.
    }
    // WHICH control closed it is the interesting part: "pressed Start drafting"
    // and "tapped the backdrop to make it go away" are different facts about the
    // same dismissal, and only one of them says the copy worked. Fired before
    // the state flips so the sheet closes at the same speed either way.
    const id = rowRef.current;
    if (id != null) sheetDismissed(id, via).catch(() => {});
    window.dispatchEvent(new Event(DISMISS_EVENT));
  }

  // Dismiss, then take them to the thing they asked for. The scroll is guarded:
  // a missing anchor must not turn a dismissal into a dead tap.
  function toTracker() {
    dismiss('tracker');
    try {
      document.getElementById(TRACKER_ANCHOR)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    } catch { /* the sheet still closed, which is the part that matters */ }
  }

  if (welcomed) return null;

  return (
    <div
      className="wsheet-scrim"
      role="dialog"
      aria-modal="true"
      aria-label={WELCOME.kicker}
      onClick={() => dismiss('backdrop')}
      onKeyDown={(e) => { if (e.key === 'Escape') dismiss('escape'); }}
    >
      {/* Stop taps inside the sheet from reaching the scrim's dismiss. */}
      <div className="wsheet" data-surface="ink" onClick={(e) => e.stopPropagation()}>
        <div className="wsheet-kicker">{WELCOME.kicker}</div>

        {/* Two halves, each headed, each ending in what to tap. The mock comes
            first because it is the thing a new account can do in ten seconds
            with no setup; the Tracker is the reason to come back. */}
        <div className="wsheet-half">
          <div className="wsheet-half-h">{WELCOME.mockHead}</div>
          <p className="wsheet-body">{WELCOME.mock}</p>
        </div>
        <div className="wsheet-half">
          <div className="wsheet-half-h">{WELCOME.trackerHead}</div>
          <p className="wsheet-body">{WELCOME.tracker}</p>
        </div>

        <div className="wsheet-pass">{WELCOME.pass}</div>

        <button type="button" className="wsheet-primary" onClick={() => dismiss('primary')}>
          {WELCOME.primary}
        </button>

        {/* Quiet by design: a second loud button would make this a choice
            between two unknowns, and the mock is the one that needs no setup. */}
        <button type="button" className="wsheet-secondary" onClick={toTracker}>
          {WELCOME.trackerLink}
        </button>
      </div>
    </div>
  );
}
