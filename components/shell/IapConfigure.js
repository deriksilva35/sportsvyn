'use client';

// components/shell/IapConfigure.js — configures the RevenueCat SDK for the
// signed-in user, once per document. Renders nothing.
//
// WHERE THE CONFIG COMES FROM. The server resolves it (lib/appleIap.js
// appleIapConfig) and hands it down as props: the `appl_` public key and the
// product id both originate in env vars, so there is one source of truth and
// flipping either is a redeploy rather than a code change. See lib/appleIap.js
// for why the key is not a NEXT_PUBLIC_ var.
//
// WHY IT IS MOUNTED AT ALL, given PassBuy could configure lazily on click:
// configure() is a real round trip, and doing it inside the tap that opens
// StoreKit adds latency to the one interaction that must feel instant. Doing it
// on page load means the SDK is already warm when the sheet is requested.
//
// THE ANONYMOUS-ID RULE. This component is only rendered when the server already
// knows the user id, and configurePurchases() refuses to configure without one.
// That is not belt-and-braces for its own sake: if the SDK configures anonymously
// it invents an $RCAnonymousID, the purchase webhook arrives carrying it, and the
// server refuses the event by design (lib/revenuecat.js) - Apple has taken the
// money and there is no account to attribute it to. Late sign-in inside a single
// document is handled by logIn() rather than a second configure().

import { useEffect } from 'react';
import { configurePurchases } from '@/lib/shell/purchaseBridge';

export default function IapConfigure({ userId, apiKey, productId }) {
  useEffect(() => {
    // Fire-and-forget: nothing renders off the result, so there is no state to
    // set and nothing for a failure to break. configurePurchases() swallows its
    // own errors and reports a reason string, which is logged in dev only.
    configurePurchases({ apiKey, userId, productId });
  }, [apiKey, userId, productId]);

  return null;
}
