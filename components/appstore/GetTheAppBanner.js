// components/appstore/GetTheAppBanner.js — the SERVER half of the get-the-app
// banner. It owns the two decisions that must not reach the browser:
//
//   1. THE FLAG. APP_STORE_URL is a server env var (see lib/appBanner.js for why
//      it is not NEXT_PUBLIC_). Resolving it here means that while the var is
//      empty - which is its state until Apple approves Draftvyn - the banner is
//      not merely hidden: it is never rendered, never hydrated, and the client
//      island is never even handed a URL.
//
//   2. SHELL. Only the server knows whether this render is inside the native
//      container (cookie + param, lib/shell/shell.js), so only the server can
//      keep the app from advertising itself. Callers pass the isShell they have
//      already resolved for the page rather than this component reading cookies
//      again - every host page resolves it anyway, and a second cookies() read
//      per page is a needless dynamic dependency.
//
// Returning null costs one function call, so hosts can mount this unconditionally
// and let the module decide.

// ============================================================================
// THIS IS THE REFERENCE IMPLEMENTATION FOR SHELL-AWARE CHROME. Copy it.
// ============================================================================
// The August chrome sweep checked every piece of web furniture that reaches
// the app container. The site footer had no shell handling at all, the
// subscribe band rendered a trimmed variant that was still web furniture, and
// the sim's tab bar stacked underneath the app's. This component was the only
// one that already got it right.
//
// WHAT IT DOES THAT THE OTHERS DID NOT: it takes `shell` as a prop resolved by
// the SERVER (lib/shell/shell.js), and it decides by RETURNING NULL rather
// than by rendering a smaller version of itself. A component that renders
// something different in the container is still a component the container has
// to make room for; one that returns null is not there.
//
// The other correct shape is components/shell/HideInShell, for chrome whose
// call sites are prerendered - a server-side shell read would call cookies()
// and turn a static page dynamic. Use this one where the page is already
// dynamic and has the prop; use that one where it is not.

import { appStoreUrl, shouldShowAppBanner } from '@/lib/appBanner';
import AppBanner from './AppBanner';

export default function GetTheAppBanner({ shell = false }) {
  const url = appStoreUrl();
  if (!shouldShowAppBanner({ shell, url })) return null;
  return <AppBanner url={url} />;
}
