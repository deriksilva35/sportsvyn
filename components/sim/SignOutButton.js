'use client';

// Sign-out control for the sim account page. Uses Auth.js's client signOut (the
// same call SiteHeader uses).
//
// SHELL-AWARE LANDING. Signing out used to redirect to '/' unconditionally, which
// inside the native container turned the app into the mobile website - the user
// tapped "Sign out" in an app and landed on sportsvyn.com. In shell mode the
// landing is the app's own front door instead: /sim signed-out, which is already
// shell-framed and, post-3.1.1, purchase-suppressed.
//
// The ?shell=sim-app param is carried explicitly rather than leaning on the
// sv_shell cookie. The cookie DOES survive sign-out - verified: Auth.js clears
// only its own authjs.* cookies, and the signout response sets nothing for
// sv_shell - but the param makes the landing correct even when the cookie is
// absent (fresh webview session, cleared jar) and re-arms it via ShellPersist on
// arrival. Belt and braces on the one surface where losing shell mode would also
// lose purchase suppression.
//
// Web sign-out is unchanged: shell=false still lands on '/'.

import { signOut } from 'next-auth/react';
import { signOutTarget } from '@/lib/shell/signOutTarget';
import { logOutPurchases } from '@/lib/shell/purchaseBridge';

export default function SignOutButton({ shell = false }) {
  async function handle() {
    // Tell RevenueCat too, or the SDK keeps this user's appUserID cached in the
    // webview. The next person to sign in on the same device would then transact
    // under the PREVIOUS user's id until a fresh configure() ran - which, given
    // the store transfers a non-consumable to whoever last claimed it, is how a
    // Pass ends up on the wrong account. Best-effort and awaited only briefly:
    // failing to log out of RevenueCat must never block signing out of Sportsvyn.
    await logOutPurchases();
    signOut({ redirectTo: signOutTarget(shell) });
  }

  return (
    <button type="button" className="acct-signout" onClick={handle}>
      Sign out
    </button>
  );
}
