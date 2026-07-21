'use client';

// Sign-out control for the sim account page. Uses Auth.js's client signOut (the
// same call SiteHeader uses), redirecting to the homepage after the session is
// cleared. The sim had no sign-out surface before this.

import { signOut } from 'next-auth/react';

export default function SignOutButton() {
  return (
    <button type="button" className="acct-signout" onClick={() => signOut({ redirectTo: '/' })}>
      Sign out
    </button>
  );
}
