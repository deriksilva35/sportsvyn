'use client';
// components/sim/ShellPersist.js — writes the sim-app shell cookie client-side
// when shell mode is active, so client navigations within /sim keep the
// server-side chrome mode without re-threading ?shell=sim-app.
//
// Session cookie (no max-age): scoped to the browser session, so a web visitor
// who stumbles onto ?shell=sim-app is not stuck chromeless after closing the tab.
// The native webview session is long-lived, which is exactly what we want there.
import { useEffect } from 'react';
import { SHELL_COOKIE, SHELL_VALUE } from '@/lib/shell/constants';

export default function ShellPersist() {
  useEffect(() => {
    document.cookie = `${SHELL_COOKIE}=${SHELL_VALUE}; path=/; samesite=lax`;
  }, []);
  return null;
}
