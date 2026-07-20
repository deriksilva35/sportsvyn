'use client';

/**
 * AppleSignInButton — "Continue with Apple", the primary sign-in path.
 *
 * A client island (like SignInForm) because it calls signIn('apple') on the
 * client, which kicks off the OAuth redirect to appleid.apple.com. callbackUrl
 * arrives as a plain prop from the server page (same prop-drill pattern the
 * magic-link form uses) so this component needs no useSearchParams and stays
 * in the statically-rendered HTML.
 *
 * The redirect chain: signIn('apple') -> appleid.apple.com consent -> Apple
 * form_posts back to /api/auth/callback/apple -> Auth.js finishes and
 * redirects to callbackUrl. Inside the Draftvyn iOS shell this all happens
 * as full-page navigations within the webview, so no native plugin is needed.
 *
 * Apple button styling follows their Human Interface Guidelines: the Apple
 * logomark is never recolored (white mark on a black button), and the label
 * is one of Apple's sanctioned strings. Black-on-ink needs a hairline border
 * (border-charcoal) so the button edge reads against our near-black surface.
 */

import { useState } from 'react';
import { signIn } from 'next-auth/react';

export default function AppleSignInButton({ callbackUrl = '/' }) {
  const [busy, setBusy] = useState(false);

  return (
    <button
      type="button"
      disabled={busy}
      onClick={() => {
        setBusy(true);
        signIn('apple', { callbackUrl });
      }}
      className="w-full flex items-center justify-center gap-2.5 px-4 py-3 bg-black text-white border border-charcoal rounded font-medium text-[15px] hover:bg-charcoal disabled:opacity-50 disabled:cursor-not-allowed"
    >
      <svg
        aria-hidden="true"
        width="16"
        height="16"
        viewBox="0 0 24 24"
        fill="currentColor"
      >
        <path d="M16.365 1.43c0 1.14-.493 2.27-1.177 3.08-.744.9-1.99 1.57-2.987 1.57-.12 0-.23-.02-.3-.03-.01-.06-.04-.22-.04-.39 0-1.15.572-2.27 1.206-2.98.804-.94 2.142-1.64 3.248-1.68.03.13.05.28.05.43zm4.565 15.71c-.03.07-.463 1.58-1.518 3.12-.945 1.34-1.94 2.71-3.43 2.74-1.517.03-2.02-.87-3.71-.87-1.68 0-2.24.84-3.65.9-1.47.05-2.61-1.45-3.53-2.83-1.9-2.76-3.35-7.81-1.4-11.22.97-1.69 2.7-2.76 4.6-2.79 1.44-.03 2.79.98 3.66.98.87 0 2.5-1.21 4.22-1.03.72.03 2.74.29 4.04 2.19-.11.07-2.41 1.41-2.38 4.21.03 3.34 2.92 4.45 2.95 4.46z" />
      </svg>
      <span>{busy ? 'Redirecting…' : 'Continue with Apple'}</span>
    </button>
  );
}
