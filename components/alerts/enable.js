'use client';

// components/alerts/enable.js — turning alerts on, by the route this
// environment actually has.
//
// THE SHEET RENDERS IN TWO PLACES AND THEY DO NOT SHARE A TRANSPORT. Inside
// Draftvyn the app is a Capacitor webview with a native PushNotifications
// plugin and an APNs token that already works - 39 devices, real sends, daily.
// In a browser there is no plugin and push means a service worker and a VAPID
// subscription. One sheet, two paths, chosen from the environment rather than
// attempted in turn.
//
// THE WEB REFUSAL MESSAGE MUST NEVER REACH THE SHELL. "This browser cannot
// receive push. On iPhone, add Sportsvyn to your Home Screen first." is true
// advice for Safari and nonsense inside an app the reader already installed -
// it would read as the app telling them to install the app. Picking the path
// first is what makes that impossible; a try-web-then-fall-back would have
// shown it every time.

import { pushPathFor } from '@/lib/push/sheetRules';
import { subscribeThisBrowser } from './subscribe';

function environment() {
  if (typeof window === 'undefined') return { cookie: '', capacitor: false };
  return {
    cookie: typeof document === 'undefined' ? '' : document.cookie,
    // THE COOKIE IS THE PRIMARY SIGNAL and window.Capacitor is the belt: the
    // cookie is set by the proxy on the container's first hit, but a webview
    // that somehow arrived without it is still a webview, and offering it web
    // push would be offering it nothing.
    capacitor: Boolean(window.Capacitor?.Plugins?.PushNotifications),
  };
}

/**
 * Turn on whatever this environment can turn on.
 * @returns { ok, path, error } - error is a sentence for a person, never a code.
 */
export async function enableAlerts() {
  const env = environment();
  const path = pushPathFor(env);
  if (path === 'web') return { ...(await subscribeThisBrowser()), path: 'web' };

  const { canOfferPush, enablePush } = await import('@/lib/push/client');
  if (!canOfferPush()) {
    // Inside the shell with no plugin: an old build, or a webview that has not
    // finished wiring. Say which, not "unsupported".
    return { ok: false, path: 'native',
      error: 'This version of the app cannot receive alerts yet. Updating Draftvyn will fix it.' };
  }
  const result = await enablePush();
  if (result === 'granted') return { ok: true, path: 'native' };
  if (result === 'denied') {
    // iOS makes a second request a silent no-op, so the only honest thing to
    // say is where the switch actually is.
    return { ok: false, path: 'native',
      error: 'Notifications are off for Draftvyn. Turn them on in iPhone Settings > Notifications > Draftvyn.' };
  }
  return { ok: false, path: 'native',
    error: 'Could not reach the notification service. Try again in a moment.' };
}
