// components/alerts/subscribe.js — this browser's push subscription.
//
// EVERY FAILURE HERE IS A SENTENCE, NOT A THROW. Push is refused for half a
// dozen ordinary reasons - an iPhone not installed to the home screen, a
// browser with no push at all, a permission the reader denied last month - and
// every one of them needs to reach the sheet as something a person can read.
// A rejected promise would surface as a blank toggle that does nothing.

const B64 = (base64) => {
  const pad = '='.repeat((4 - (base64.length % 4)) % 4);
  const raw = atob((base64 + pad).replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from([...raw].map((c) => c.charCodeAt(0)));
};

export async function subscribeThisBrowser() {
  if (typeof window === 'undefined') return { ok: false, error: 'not a browser' };
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
    // Safari on iOS supports push ONLY from a home-screen install, and this is
    // the message that says so without saying "unsupported", which reads as
    // broken rather than as a step the reader can take.
    return { ok: false, error: 'This browser cannot receive push. On iPhone, add Sportsvyn to your Home Screen first.' };
  }
  if (Notification.permission === 'denied') {
    return { ok: false, error: 'Notifications are blocked for this site in your browser settings.' };
  }
  const key = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
  if (!key) return { ok: false, error: 'Push is not configured yet.' };

  try {
    const reg = await navigator.serviceWorker.register('/sw.js');
    await navigator.serviceWorker.ready;
    // THE PROMPT. It happens here, inside a handler the reader started by
    // turning a toggle on, and nowhere else.
    const perm = Notification.permission === 'granted'
      ? 'granted' : await Notification.requestPermission();
    if (perm !== 'granted') return { ok: false, error: 'Notifications were not allowed.' };

    const sub = await reg.pushManager.getSubscription()
      ?? await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: B64(key) });
    const res = await fetch('/api/push/subscribe', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify(sub.toJSON()),
    });
    if (!res.ok) {
      const j = await res.json().catch(() => ({}));
      return { ok: false, error: j.error === 'sign-in required' ? 'Sign in to get alerts.' : 'Could not register this device.' };
    }
    return { ok: true };
  } catch (e) {
    return { ok: false, error: String(e?.message ?? e).slice(0, 160) };
  }
}
