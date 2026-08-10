/**
 * lib/shell/signinHref.js - the sign-in link, built so the surface survives
 * Sign in with Apple.
 *
 * THE MARKER HAS TO BE IN TWO PLACES, and they are not the same place for the
 * same reason:
 *
 *   ?shell=sim-app  on the /signin URL itself, so the sign-in PAGE renders the
 *                   app front door without waiting on the sv_shell cookie.
 *                   This is what the call sites already did.
 *
 *   ?shell=sim-app  INSIDE the callbackUrl value, so it is still readable in
 *                   the Apple callback. That request is a cross-site POST
 *                   (response_mode=form_post), which drops the SameSite=Lax
 *                   sv_shell cookie - so at the moment a new Apple account is
 *                   created the only shell evidence left is whatever Auth.js
 *                   stored in its callback-url cookie, which auth.js
 *                   deliberately relaxed to SameSite=None+Secure for exactly
 *                   this round trip.
 *
 * Without the second one, first_seen_context could never say apple:shell for
 * anybody - the label was apple:web on every Apple signup regardless of where
 * it came from.
 *
 * No DB, no request access: a pure string builder, so the encoding is testable.
 */

import { SHELL_PARAM, SHELL_VALUE } from './constants.js';

/**
 * @param {string} dest    where to land after sign-in, e.g. '/sim'
 * @param {boolean} isShell whether this request is inside the native container
 */
export function shellSigninHref(dest, isShell) {
  const target = String(dest || '/');
  if (!isShell) {
    return `/signin?callbackUrl=${encodeURIComponent(target)}`;
  }
  // The marker rides inside the callbackUrl, so it must be encoded as one
  // value - a bare `&shell=` here would be a sibling param of /signin instead,
  // which is the bug this exists to fix.
  const sep = target.includes('?') ? '&' : '?';
  const callback = `${target}${sep}${SHELL_PARAM}=${SHELL_VALUE}`;
  return `/signin?callbackUrl=${encodeURIComponent(callback)}&${SHELL_PARAM}=${SHELL_VALUE}`;
}
