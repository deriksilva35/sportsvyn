// lib/appleIap.js — the APPLE_IAP_ENABLED kill switch for the in-app buy path.
//
// PURE (no React, no next/*, no DB) so the server pages, the gate card, and a
// node test all read the same answer.
//
// WHY A FLAG AT ALL. The server half of Apple IAP (migration 056, the RevenueCat
// webhook) ships NOW; the app-side purchase code lands in a LATER binary. In
// between there is a live app on the App Store - version 1.0(2), the one under
// review - whose webview loads these same pages. That build has no StoreKit code
// and no window.draftvyn bridge, so a buy button rendered into it would be a
// dead control on a purchase surface, which is a worse 3.1.1 answer than the
// suppressed card it replaces. A reviewer can reopen that build at any time.
//
// So: DEFAULT OFF, and off means the shipped suppressed card renders byte-for-
// byte as it does today. components/sim/shellPurchase.test.mjs - the 3.1.1 gate
// suite - is run against the flag in its default state and must stay green.
//
// Flip it to '1' in Vercel only once the IAP binary is live.

export const APPLE_IAP_ENABLED_ENV = 'APPLE_IAP_ENABLED';

// Explicit opt-in only. Anything else - unset, '', '0', 'false', 'no', a typo -
// is OFF. A flag that gates a purchase surface must never be enabled by accident,
// so the truthy set is closed and small rather than "not falsy".
const TRUTHY = new Set(['1', 'true', 'yes', 'on']);

export function appleIapEnabled(env = process.env) {
  const raw = env?.[APPLE_IAP_ENABLED_ENV];
  if (typeof raw !== 'string') return false;
  return TRUTHY.has(raw.trim().toLowerCase());
}
