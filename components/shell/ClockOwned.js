'use client';

/**
 * components/shell/ClockOwned.js - "this screen has a clock running".
 *
 * Renders nothing. While it is mounted it sets data-clock on <html>, and the
 * app tab bar hides on that attribute - see lib/shell/appTabs.js for why the
 * suppression cannot be route-based.
 *
 * AN ATTRIBUTE AND CSS RATHER THAN SHARED STATE, deliberately. The alternative
 * is a context provider wrapping the whole app so a component three levels
 * inside /daily can tell a component in the root layout to hide - which is a
 * lot of plumbing to move one boolean, and it would re-render the tree on every
 * round. The cleanup is the only thing that matters here and it is four lines.
 *
 * THE CLEANUP IS THE WHOLE RISK. A flag left set outlives the round and the bar
 * never comes back, which is worse than never having hidden it: the reader is
 * stranded in an app with no navigation and no URL bar. So it clears on unmount
 * unconditionally, and it clears on pagehide too - a bfcache restore can
 * resurrect a page without remounting the component that set it.
 */

import { useEffect } from 'react';

export default function ClockOwned() {
  useEffect(() => {
    const el = document.documentElement;
    el.setAttribute('data-clock', 'live');
    const clear = () => el.removeAttribute('data-clock');
    window.addEventListener('pagehide', clear);
    return () => { window.removeEventListener('pagehide', clear); clear(); };
  }, []);
  return null;
}
