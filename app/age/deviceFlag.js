// app/age/deviceFlag.js - the per-install refusal flag (localStorage). The iOS
// shell exposes no stable install id to the web side (no Device plugin; the
// APNs token exists only after a push grant and changes on reinstall), so the
// flag lives in the WKWebView's own storage beside the long-lived cookie.
// Client-only; every access is wrapped, because storage can throw.

import { AGE_BLOCK_STORAGE_KEY } from '@/lib/auth/ageGate';

export function deviceBlocked() {
  try { return window.localStorage.getItem(AGE_BLOCK_STORAGE_KEY) === '1'; } catch { return false; }
}

export function setDeviceBlocked() {
  try { window.localStorage.setItem(AGE_BLOCK_STORAGE_KEY, '1'); } catch { /* private mode */ }
}
