// lib/today/modes.js - the two modes, and which one a path lights.
//
// PURE AND JSX-FREE ON PURPOSE. This lived inside ModeSwitch.js, which node's
// test runner cannot parse - importing a component to test one string
// comparison meant importing JSX. The component renders; this decides.

// The second mode was My Sportsvyn (/my). /my is a 308 to /you since sun-16 D,
// and a pill that is a redirect is a hop, so it names the destination.
export const MODES = Object.freeze([
  { href: '/', label: 'Today' },
  { href: '/you', label: 'You' },
]);

/** Exact for '/', prefix for the other - nothing under /you/... is a third mode. */
export function isActive(href, pathname) {
  if (href === '/') return pathname === '/';
  return typeof pathname === 'string' && pathname.startsWith(href);
}
