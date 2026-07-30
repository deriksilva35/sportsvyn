// lib/shell/signOutTarget.js — where sign-out lands. PURE, no imports, so both
// client components (SignOutButton, SiteHeader, DeleteAccount) and a node test
// can read the same answer.
//
// The rule: a native app must not turn into the website when you sign out. In
// shell mode every sign-out lands on the app's own front door (/sim signed-out,
// already shell-framed and purchase-suppressed); on the web it lands on '/', which
// is what it has always done.
//
// The shell param is carried on the URL rather than left to the sv_shell cookie.
// The cookie survives sign-out - Auth.js clears only its own authjs.* names - but
// carrying it explicitly means the landing is right even from a fresh webview
// session, and it re-arms the cookie via ShellPersist when the page mounts.

import { SHELL_PARAM, SHELL_VALUE } from './constants.js';

export const WEB_SIGNOUT_TARGET = '/';
export const SHELL_SIGNOUT_TARGET = `/sim?${SHELL_PARAM}=${SHELL_VALUE}`;

export function signOutTarget(shell = false) {
  return shell ? SHELL_SIGNOUT_TARGET : WEB_SIGNOUT_TARGET;
}

/**
 * Post-delete landing. Same rule, plus the ?deleted=1 marker the /sim lobby reads
 * to render its "account deleted" state. Kept beside signOutTarget so the two
 * cannot drift: both are "sign out and go somewhere", and both were sending the
 * shell to the website.
 */
export function deleteAccountTarget(shell = false) {
  return shell
    ? `/sim?deleted=1&${SHELL_PARAM}=${SHELL_VALUE}`
    : '/sim?deleted=1';
}
