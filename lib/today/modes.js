// lib/today/modes.js - the two modes, and which one a path lights.
//
// PURE AND JSX-FREE ON PURPOSE. This lived inside ModeSwitch.js, which node's
// test runner cannot parse - importing a component to test one string
// comparison meant importing JSX. The component renders; this decides.

export const MODES = Object.freeze([
  { href: '/', label: 'Today' },
  { href: '/my', label: 'My Sportsvyn' },
]);

/** Exact for '/', prefix for '/my' - nothing under /my/... is a third mode. */
export function isActive(href, pathname) {
  if (href === '/') return pathname === '/';
  return typeof pathname === 'string' && pathname.startsWith(href);
}
