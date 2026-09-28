// lib/shell/shell.js — server-side shell-mode resolution for the native
// container. ONE QUESTION, ONE ANSWER, READ FROM ONE PLACE.
//
// THIS USED TO TAKE searchParams AND CHECK THE PARAM FIRST. It no longer does,
// and that is the point of the cookie-set-once move: proxy.js turns
// ?shell=sim-app into the sv_shell cookie on the first request that carries
// it, so by the time any page renders, the cookie is authoritative and the
// param has nothing left to say.
//
// WHY THE PARAM COULD NOT STAY AS AN ANSWER. It was an answer only on pages
// that remembered to thread searchParams into here - 41 call sites had to get
// it right, and app/page.js passed null on purpose, so the homepage rendered
// web chrome inside the container. A signal every caller must opt into is a
// signal that is wrong somewhere.
//
// THE PARAM IS STILL WRITTEN, AND THAT IS NOT A LEFTOVER: signinHref,
// SHELL_SIGNOUT_TARGET and lib/auth/firstSeen use it to carry mode across an
// auth redirect where the cookie may not exist yet. It is WRITE-ONLY now -
// things emit it, proxy.js is the only reader.
//
// The client half of this decision lives in isShellClient (lib/shell/appTabs),
// which reads the same cookie and nothing else.

import { cookies } from 'next/headers';
import { SHELL_VALUE, SHELL_COOKIE } from './constants';

/** Is this request inside the container? The cookie, and only the cookie. */
export async function resolveShellMode() {
  const jar = await cookies();
  return jar.get(SHELL_COOKIE)?.value === SHELL_VALUE;
}

// Viewport for the sim routes. Shell mode opts into viewport-fit:cover (so
// env(safe-area-inset-*) resolves on iOS) plus the ink theme color. Non-shell
// returns the SAME viewport the root layout emits, so web markup is unchanged.
export function simViewport(isShell) {
  const base = { width: 'device-width', initialScale: 1 };
  return isShell ? { ...base, viewportFit: 'cover', themeColor: '#0A0A0A' } : base;
}
