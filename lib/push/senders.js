// lib/push/senders.js — the last inch. Two transports, one contract.
//
// THE CONTRACT: send(device, payload) -> { ok, status, gone }. `gone` is the
// only thing the dispatcher acts on beyond ok/not-ok, and it means the push
// service has told us this endpoint no longer exists. Everything else is a
// delivery failure to be logged and retried on the next event.
//
// 404 AND 410 BOTH MEAN GONE. Web push services return 410 for an expired
// subscription and 404 for one that never existed; APNs returns 410 with
// reason "Unregistered" and 400 with "BadDeviceToken". Treating only 410 as
// gone would leave dead rows collecting a send attempt per event forever.

export const GONE = new Set([404, 410]);

// ---------------------------------------------------------------------------
// WEB PUSH (VAPID)
// ---------------------------------------------------------------------------

/**
 * web-push does the ECDH/HKDF/AES-GCM dance and the VAPID JWT. It is a
 * dependency rather than a hand-rolled implementation because RFC 8291 payload
 * encryption is the kind of thing that is either exactly right or silently
 * delivers nothing, and "silently delivers nothing" is indistinguishable from
 * "nobody subscribed".
 *
 * IMPORTED LAZILY so this module can be loaded - and tested - on a box that has
 * not installed it yet.
 */
export function webSender({ lib = null } = {}) {
  return async (device, payload) => {
    const wp = lib ?? (await import('web-push')).default;
    const pub = process.env.VAPID_PUBLIC_KEY;
    const priv = process.env.VAPID_PRIVATE_KEY;
    const subject = process.env.VAPID_SUBJECT || 'mailto:alerts@sportsvyn.com';
    if (!pub || !priv) return { ok: false, status: 0, gone: false, error: 'VAPID keys missing in env' };
    wp.setVapidDetails(subject, pub, priv);
    try {
      const res = await wp.sendNotification({
        endpoint: device.endpoint ?? device.token,
        keys: { p256dh: device.p256dh, auth: device.auth },
      }, JSON.stringify(payload), { TTL: 300 });
      // TTL 300: a score alert that arrives ten minutes late is worse than one
      // that never arrives, because the reader acts on it.
      return { ok: true, status: res?.statusCode ?? 201, gone: false };
    } catch (e) {
      const status = Number(e?.statusCode ?? 0);
      return { ok: false, status, gone: GONE.has(status), error: String(e?.message ?? e).slice(0, 200) };
    }
  };
}

// ---------------------------------------------------------------------------
// iOS — AN ADAPTER OVER lib/push/apns.js, NOT A SECOND IMPLEMENTATION.
//
// The APNs transport has existed since migration 070: apns.js mints the ES256
// JWT with its own cache (Apple throttles a token minted more than once per 20
// minutes and rejects one older than 60, so the window is narrow in both
// directions), opens the http2 connection with a timeout guard, detects gone,
// and is gated behind PUSH_ENABLED. notify.js already claims before it sends.
//
// I WROTE A SECOND ONE BEFORE FINDING THE FIRST, and deleted it. Two APNs
// senders would mean two sets of env to configure, two gates to arm, and two
// places a dead token gets revoked - and the one that is wrong is always the
// one nobody is looking at.
//
// So this is the thin shape-adapter between the game-alert dispatcher's
// contract - send(device, payload) -> { ok, status, gone } - and the module
// that already does the work.

export function iosSender({ config = null, send = null } = {}) {
  return async (device, payload) => {
    const { apnsConfig, sendToToken, alertPayload } = await import('./apns.js');
    const cfg = config ?? apnsConfig();
    // NOT CONFIGURED IS A REPORTED STATE, NOT A FAILURE. There is no .p8 on
    // this box yet; ios devices are skipped and web delivery is unaffected.
    if (!cfg.enabled) return { ok: false, status: 0, gone: false, skipped: true, error: 'push not enabled' };
    const fn = send ?? sendToToken;
    const r = await fn(cfg, device.token, alertPayload({
      title: payload.title, body: payload.body ?? '', url: payload.url,
    }));
    return { ok: Boolean(r?.ok), status: r?.status ?? 0, gone: Boolean(r?.gone), error: r?.reason ?? null };
  };
}

/** Auth failures are a configuration problem, not a delivery one, and alert. */
export function isAuthFailure(result) {
  if (!result || result.ok) return false;
  if (result.status === 401 || result.status === 403) return true;
  return /VAPID keys missing/.test(String(result.error ?? ''));
}
