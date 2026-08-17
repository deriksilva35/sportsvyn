'use client';

/**
 * components/shell/HideInShell.js - renders its children on the web and nothing
 * in the app container.
 *
 * A CLIENT GATE, AND THE REASON IS THE SAME ONE THAT MOVED THE TAB BAR'S GATE.
 * The obvious version reads resolveShellMode() in the component - but that
 * calls cookies(), and /privacy and /terms are PRERENDERED. Making the footer
 * read cookies would turn the two pages the App Store review actually opens
 * into server-rendered ones, to hide a footer. So the children are rendered on
 * the server as before and this only decides whether to show them.
 *
 * WEB OUTPUT IS UNCHANGED. getServerSnapshot returns false, so the server
 * renders the children exactly as it did before this wrapper existed and
 * hydration matches. Only the container, which has the cookie, drops them.
 *
 * ANYTHING HIDDEN THROUGH THIS MUST BE REACHABLE SOMEWHERE ELSE IN THE APP.
 * The footer carries Privacy and Terms, and the App Store expects both to be
 * reachable in-app - so they moved to PROFILE rather than simply vanishing.
 * Hiding chrome is not the same as removing a destination.
 */

import { useSyncExternalStore } from 'react';
import { isShellClient } from '@/lib/shell/appTabs';

const subscribe = () => () => {};
const getSnapshot = () => isShellClient({
  cookie: document.cookie, search: window.location.search,
});
const getServerSnapshot = () => false;

export default function HideInShell({ children }) {
  const inShell = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  return inShell ? null : children;
}
