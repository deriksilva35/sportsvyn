'use client';

// components/sim/PassBuy.js — the in-app buy control for the Draft Pass.
//
// Rendered ONLY inside MembershipCard's shell branch, and only when
// APPLE_IAP_ENABLED is on (lib/appleIap.js). It is the 3.1.1 answer: the app
// reads membership-gated content, so the membership must be buyable here, in the
// app, through StoreKit.
//
// TWO GATES, NOT ONE. The server flag says "the IAP binary is live"; this
// component ALSO checks that window.draftvyn.purchasePass actually exists before
// rendering a button. Those are different facts: the flag is global, the bridge
// is per-binary, and someone running the OLD build after the flag flips would
// otherwise get a buy button that does nothing - a dead control on a purchase
// surface, which is a worse answer to a reviewer than the suppressed card. With
// no bridge this renders nothing and the card stays exactly as it is today.
//
// The bridge check goes through useSyncExternalStore rather than an effect: the
// server has no window, the client does, and this is the hook that models
// precisely that split without a hydration mismatch or a setState-in-effect
// (which this repo lints as an error).
//
// ENTITLEMENT IS NEVER GRANTED CLIENT-SIDE. A successful purchase only means
// Apple took the money; the Pass appears when RevenueCat's webhook reaches
// /api/revenuecat/webhook and writes the membership row. So success calls
// router.refresh() and lets the SERVER re-decide what this user owns. There is
// deliberately no local "unlocked" state to spoof.

import { useState, useSyncExternalStore } from 'react';
import { useRouter } from 'next/navigation';
import { canPurchaseInApp, purchasePass, subscribePurchaseAvailability } from '@/lib/shell/purchaseBridge';
import { APPLE_PASS_PRICE, PASS_BUY } from './membershipCopy';

// Capacitor injects its bridge before our JS runs, so the plugin is normally
// there at hydration - but a permanently suppressed card inside a build that CAN
// buy is an invisible failure, so the subscription polls briefly and gives up.
const noBridgeOnServer = () => false;

export default function PassBuy() {
  const router = useRouter();
  const hasBridge = useSyncExternalStore(subscribePurchaseAvailability, canPurchaseInApp, noBridgeOnServer);
  // idle | buying | unlocking | cancelled | pending | unavailable | failed
  const [state, setState] = useState('idle');

  if (!hasBridge) return null;

  function buy() {
    setState('buying');
    const sent = purchasePass((r) => {
      if (r.ok) {
        setState('unlocking');
        // Re-read entitlement from the server. The webhook may not have landed
        // yet, in which case the card simply stays and the next navigation picks
        // it up - never a client-side unlock.
        router.refresh();
        return;
      }
      setState(r.state);
    });
    // The bridge vanished between render and click (impossible in practice, but
    // a dead spinner is the one outcome worth ruling out).
    if (!sent) setState('unavailable');
  }

  const busy = state === 'buying' || state === 'unlocking';
  const message = PASS_BUY[state] ?? null;

  return (
    <div className="mcard-iap">
      <div className="mcard-iap-price">
        <b>{APPLE_PASS_PRICE}</b>
        <span>{PASS_BUY.note}</span>
      </div>
      <button type="button" className="mcard-buy" onClick={buy} disabled={busy}>
        {state === 'buying' ? PASS_BUY.buying : state === 'unlocking' ? PASS_BUY.unlocking : PASS_BUY.cta}
      </button>
      {!busy && message ? <div className="mcard-iap-msg" role="status">{message}</div> : null}
      <div className="mcard-iap-fine">{PASS_BUY.restoreNote}</div>
    </div>
  );
}
