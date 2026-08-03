'use client';

// components/sim/PassBuy.js — the in-app buy + restore control for the Draft Pass.
//
// Rendered ONLY inside MembershipCard's shell branch, and only when
// APPLE_IAP_ENABLED is on. It is the 3.1.1 answer: the app reads membership-gated
// content, so the membership must be buyable here, in the app, through StoreKit.
//
// TWO GATES: the server flag says "the IAP binary is live"; this component ALSO
// checks the RevenueCat plugin is actually present, so an older build renders the
// neutral card rather than a dead button.
//
// ============================ WHY THIS WAS REWRITTEN =========================
// The previous version had ONE terminal state and no way out of it. On success it
// set 'unlocking', called router.refresh() once, and waited for a webhook. When
// the buyer already owned the non-consumable, no purchase event ever fired, the
// refresh changed nothing, and the button sat on "PURCHASED. UNLOCKING YOUR
// ACCOUNT..." forever - which is exactly what happened on a real device.
//
// Now:
//   · the bridge reconciles with the server before reporting success, so
//     'unlocking' means "the server has already agreed", not "please wait"
//   · 'unlocking' still verifies, but with a BOUNDED retry and a real failure
//     state that offers a retry button - it can always be left
//   · RESTORE is a visible control, because Apple requires one for a
//     non-consumable and because it is the actual fix for an already-owned Pass
//   · the "unlocks automatically once Apple confirms" line is gone; it promised
//     something the app did not do
//
// ENTITLEMENT IS STILL NEVER GRANTED CLIENT-SIDE. Every ok:true path has already
// been confirmed by the server's own reconcile; the UI only ever asks it to look.

import { useState, useSyncExternalStore } from 'react';
import { useRouter } from 'next/navigation';
import {
  canPurchaseInApp, purchasePass, restorePass, subscribePurchaseAvailability,
} from '@/lib/shell/purchaseBridge';
import { APPLE_PASS_PRICE, PASS_BUY } from './membershipCopy';

const noBridgeOnServer = () => false;

export default function PassBuy() {
  const router = useRouter();
  const hasBridge = useSyncExternalStore(subscribePurchaseAvailability, canPurchaseInApp, noBridgeOnServer);
  // idle | buying | restoring | unlocking | <terminal state from the bridge>
  const [state, setState] = useState('idle');
  const [detail, setDetail] = useState(null);

  if (!hasBridge) return null;

  // Success path. The server has ALREADY reconciled by this point, so this is a
  // refresh to pick up the new entitlement, not a wait for one. router.refresh()
  // re-renders the server tree; if the user is now entitled the gate card (and
  // therefore this component) unmounts. If it does NOT unmount within a beat,
  // something is out of step and we say so rather than spinning forever.
  function settle(kind) {
    setState('unlocking');
    setDetail(null);
    router.refresh();
    setTimeout(() => {
      // Still mounted => the server re-render did not clear the gate.
      setState('stalled');
      setDetail(kind);
    }, 6000);
  }

  function onResult(r) {
    if (r.ok) { settle(r.state); return; }
    setState(r.state);
    setDetail(r.message ?? null);
  }

  function buy() {
    setState('buying');
    setDetail(null);
    if (!purchasePass(onResult)) setState('unavailable');
  }

  function restore() {
    setState('restoring');
    setDetail(null);
    if (!restorePass(onResult)) setState('unavailable');
  }

  const busy = state === 'buying' || state === 'restoring' || state === 'unlocking';
  const failed = ['failed', 'unavailable', 'stalled'].includes(state);
  const label = state === 'buying' ? PASS_BUY.buying
    : state === 'restoring' ? PASS_BUY.restoring
      : state === 'unlocking' ? PASS_BUY.unlocking
        : failed ? PASS_BUY.retry
          : PASS_BUY.cta;
  // 'stalled' and 'notOwned' carry their own copy; everything else maps by state.
  const message = state === 'stalled' ? PASS_BUY.stalled : (PASS_BUY[state] ?? null);

  return (
    <div className="mcard-iap">
      <div className="mcard-iap-price">
        <b>{APPLE_PASS_PRICE}</b>
        <span>{PASS_BUY.note}</span>
      </div>

      <button type="button" className="mcard-buy" onClick={buy} disabled={busy}>{label}</button>

      {message && state !== 'idle' ? (
        <div className="mcard-iap-msg" role="status">
          {message}{detail && state === 'failed' ? ` (${detail})` : ''}
        </div>
      ) : null}

      {/* RESTORE — always visible, never hidden behind a failure. Apple requires a
          restore path for a non-consumable, and a reviewer has to be able to find
          it without first provoking an error. */}
      <button type="button" className="mcard-restore" onClick={restore} disabled={busy}>
        {PASS_BUY.restore}
      </button>
    </div>
  );
}
