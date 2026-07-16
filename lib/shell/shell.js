// lib/shell/shell.js — server-side shell-mode resolution for the sim-app native
// wrapper. The dedicated Capacitor sim app loads /sim?shell=sim-app; a client
// component (components/sim/ShellPersist) persists that as a session cookie so
// client navigations into /sim/draft/[id] keep chromeless mode without threading
// the param. Server components read this to vary chrome.
//
// This DEVIATES from the main /app wrapper's client-only window.Capacitor
// detection (components/BackToAppBar.js:34) on purpose:
//   1. /sim is a shared web+app route, so window.Capacitor can't tell the sim
//      container from the main app container — ?shell=sim-app is the discriminator;
//   2. chrome varies in SERVER components here, where window.Capacitor is absent.
// The bridge still reuses window.Capacitor for its native-container feature-detect.

import { cookies } from 'next/headers';
import { SHELL_PARAM, SHELL_VALUE, SHELL_COOKIE } from './constants';

// searchParams: the already-awaited page searchParams object (may be null/empty).
// Falls back to the persisted cookie for client navigations that drop the param.
export async function resolveShellMode(searchParams) {
  const raw = searchParams?.[SHELL_PARAM];
  const param = Array.isArray(raw) ? raw[0] : raw;
  if (param === SHELL_VALUE) return true;
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
