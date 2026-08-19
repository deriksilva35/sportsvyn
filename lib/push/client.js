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
    // ========================================================================
    // CHECK, THEN REQUEST, THEN VERIFY - because 'enabled' lied once
    // ========================================================================
    // Aug 19: a device carried push_choice='enabled' and a registered token
    // while iOS Settings had NO Draftvyn entry - meaning the native
    // authorization dialog never fired on that install, and everything
    // downstream trusted a permission that did not exist. APNs happily mints
    // tokens for unauthorized apps (permission gates DISPLAY, not token
    // issuance), so the token was real, the 200s were real, and nothing ever
    // rendered.
    //
    // The order now: read the current state; request ONLY from 'prompt'
    // states (re-requesting from 'denied' is a silent no-op on iOS - honesty
    // is recording denied, not re-asking); then RE-READ and believe only the
    // re-read. A 'granted' that cannot survive checkPermissions immediately
    // after is exactly the lie this rewrite exists to catch.
    let perm = (await plugin.checkPermissions())?.receive ?? 'prompt';
    if (perm !== 'granted' && perm !== 'denied') {
      await plugin.requestPermissions();
      perm = (await plugin.checkPermissions())?.receive ?? 'denied';
    }
    if (perm !== 'granted') return 'denied';

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
      // The VERIFIED permission rides along, so device_tokens can tell a
      // token-with-permission from a token-without - the distinction this
      // defect proved the table needed.
      body: JSON.stringify({ token, platform: 'ios', permission: perm }),
    });
    return res.ok ? 'granted' : 'error';
  } catch {
    return 'error';
  }
}

/** The device's CURRENT permission - 'granted' | 'denied' | 'prompt' | null
 * (null = no plugin). The account row renders from THIS, not from the server
 * column: the column is a preference, the OS is the fact. */
export async function devicePermission() {
  const plugin = pushPlugin();
  if (!plugin) return null;
  try { return (await plugin.checkPermissions())?.receive ?? 'prompt'; }
  catch { return null; }
}

/**
 * The explicit turn-OFF: revoke THIS device's token server-side. register()
 * is how a device learns its own token (there is no synchronous getter), and
 * calling it while authorized just re-hands the current one - which is
 * exactly what unregister needs.
 * @returns {boolean} whether a token was found and revoked
 */
export async function disablePush() {
  const plugin = pushPlugin();
  if (!plugin) return false;
  try {
    const token = await new Promise((resolve) => {
      const timer = setTimeout(() => resolve(null), 8000);
      plugin.addListener('registration', (t) => { clearTimeout(timer); resolve(t?.value ?? null); });
      plugin.addListener('registrationError', () => { clearTimeout(timer); resolve(null); });
      plugin.register();
    });
    if (!token) return false;
    const res = await fetch('/api/push/unregister', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ token }),
    });
    return res.ok;
  } catch {
    return false;
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
      // 'granted' is what checkPermissions just said - and because EVERY
      // launch runs this path, each device's row converges on its true
      // permission state within a day of this deploy. That is the audit
      // mechanism for the enrollees who came through the old flow.
      fetch('/api/push/register', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ token, platform: 'ios', permission: 'granted' }),
      }).catch(() => {});
    });
    plugin.register();
  } catch { /* courtesy - never surfaces */ }
}
