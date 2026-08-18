'use client';

// lib/push/client.js - the device side of enabling push, shared by every
// surface that offers it (onboarding step 4, the post-entry nudge, the
// profile row). One implementation because the discipline is the point:
// OUR screen asks first, the OS prompt fires ONLY on an explicit yes, and
// the OS prompt is a one-shot Apple owns - waste it and the only road back
// is the Settings app.
//
// FEATURE-DETECTED, NOT SHELL-DETECTED. The v1.1 binary is a shell without
// the plugin; the web has no plugin at all. Both must see nothing. The
// plugin object is the one honest signal a binary can actually deliver on
// the promise the pre-warm makes.

/** The Capacitor push plugin, or null where enabling is impossible. */
export function pushPlugin() {
  if (typeof window === 'undefined') return null;
  return window.Capacitor?.Plugins?.PushNotifications ?? null;
}

export function canOfferPush() {
  return pushPlugin() != null;
}

/**
 * The explicit-yes path: OS prompt -> APNs registration -> our endpoint.
 *
 * @returns {'granted'|'denied'|'error'} what actually happened, so the caller
 *   can record the choice truthfully - a denied OS prompt is not 'enabled'.
 */
export async function enablePush() {
  const plugin = pushPlugin();
  if (!plugin) return 'error';
  try {
    const perm = await plugin.requestPermissions();
    if (perm?.receive !== 'granted') return 'denied';

    // The token arrives via an event, not the register() return value.
    const token = await new Promise((resolve) => {
      const timer = setTimeout(() => resolve(null), 10000);
      plugin.addListener('registration', (t) => { clearTimeout(timer); resolve(t?.value ?? null); });
      plugin.addListener('registrationError', () => { clearTimeout(timer); resolve(null); });
      plugin.register();
    });
    if (!token) return 'error';

    const res = await fetch('/api/push/register', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ token, platform: 'ios' }),
    });
    return res.ok ? 'granted' : 'error';
  } catch {
    return 'error';
  }
}

/**
 * Silent re-registration on launch - the Skry's discipline. If permission is
 * ALREADY granted, refresh the token server-side without a prompt: APNs can
 * rotate tokens across restores and OS updates, and a stale token is a
 * silently deaf device. Never prompts: checkPermissions only.
 */
export async function reRegisterIfGranted() {
  const plugin = pushPlugin();
  if (!plugin) return;
  try {
    const perm = await plugin.checkPermissions();
    if (perm?.receive !== 'granted') return;
    plugin.addListener('registration', (t) => {
      const token = t?.value;
      if (!token) return;
      fetch('/api/push/register', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ token, platform: 'ios' }),
      }).catch(() => {});
    });
    plugin.register();
  } catch { /* courtesy - never surfaces */ }
}
