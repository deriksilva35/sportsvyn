// lib/email/resendPace.js - EVERY RESEND SEND IS PACED AND RETRIED ON A 429 (tue-4).
//
// Resend allows a small number of requests a second. The 20 Oct run met it:
// sends past the limit came back `rate_limit_exceeded` / "Too many requests"
// and were counted as failed. Two rules, in ONE place (lib/resend.js wraps the
// client's emails.send with this, so the morning send, the NBA opener, the
// welcome mail, sign-in codes and alerts all get it):
//
//   PACE   send STARTS are at least 1000/8 = 125 ms apart (<= 8 a second). A
//          slot is reserved synchronously, so concurrent callers queue behind
//          each other instead of bursting.
//   RETRY  a 429 is retried up to 3 times with backoff 500 / 1000 / 2000 ms
//          (each retry takes a fresh pacing slot) before the send counts as
//          failed. A 429 means Resend did NOT accept the message, so a retry
//          cannot duplicate it. Anything else is returned or thrown untouched.
//
// The Resend SDK RETURNS { data, error } rather than throwing; both shapes are
// recognised. After the last retry the final result is returned (error set), or
// the final error rethrown, so callers' existing failure handling is unchanged.

export const MAX_PER_SECOND = 8;
export const GAP_MS = Math.ceil(1000 / MAX_PER_SECOND);
export const MAX_RETRIES = 3;
export const BACKOFF_MS = Object.freeze([500, 1000, 2000]);

/** PURE: is this Resend error / result / thrown value a rate-limit refusal? */
export function isRateLimited(x) {
  const e = x?.error ?? x;
  if (!e || typeof e !== 'object') return false;
  const status = e.statusCode ?? e.status;
  const name = String(e.name ?? e.code ?? '').toLowerCase();
  const msg = String(e.message ?? '').toLowerCase();
  return Number(status) === 429 || name === 'rate_limit_exceeded' || /too many requests|rate limit/.test(msg);
}

const realSleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Wrap a send function. `sleep` and `now` are injectable so the tests run on a
 * fake clock. Returns an async function with the same signature as `send`.
 */
export function paced(send, { sleep = realSleep, now = Date.now, gapMs = GAP_MS, retries = MAX_RETRIES, backoff = BACKOFF_MS } = {}) {
  let nextAt = 0;
  const slot = async () => {
    const t = now();
    const at = Math.max(t, nextAt);
    nextAt = at + gapMs; // reserved synchronously: no await between the read and the write
    if (at > t) await sleep(at - t);
  };
  const wait = (attempt) => sleep(backoff[Math.min(attempt, backoff.length - 1)]);
  return async function pacedSend(...args) {
    let attempt = 0;
    for (;;) {
      await slot();
      let res;
      try {
        res = await send(...args);
      } catch (e) {
        if (isRateLimited(e) && attempt < retries) { await wait(attempt); attempt += 1; continue; }
        throw e;
      }
      if (isRateLimited(res) && attempt < retries) { await wait(attempt); attempt += 1; continue; }
      return res;
    }
  };
}
