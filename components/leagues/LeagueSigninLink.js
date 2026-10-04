'use client';

// components/leagues/LeagueSigninLink.js - SIGN IN on the private-league 404
// (app/leagues/[id]/not-found.js). A not-found boundary gets no params, so the
// destination is read from the browser's own URL: a signed-out member signs in
// and lands back on their league, with its tab.

import { usePathname, useSearchParams } from 'next/navigation';
import { shellSigninHref } from '@/lib/shell/signinHref';

export default function LeagueSigninLink({ isShell = false }) {
  const pathname = usePathname() || '/leagues';
  const qs = useSearchParams()?.toString();
  const dest = qs ? `${pathname}?${qs}` : pathname;
  return <a className="lg-join-primary" href={shellSigninHref(dest, isShell)}>Sign in</a>;
}
