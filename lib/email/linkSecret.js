// lib/email/linkSecret.js - the ONE secret that signs links inside email
// (unsubscribe, click). EMAIL_LINK_SECRET, set identically on Vercel (prod +
// preview) and on the droplet that runs scripts/broadcast.mjs. There is no
// fallback: the app secret used to stand in, and the droplet's copy of it did
// not match production, so every link in the 8 Sep launch email failed to
// verify. Absent secret -> signing throws, verifying returns false.
import { createHmac, timingSafeEqual } from 'node:crypto';

export function emailLinkSecret() {
  const s = process.env.EMAIL_LINK_SECRET;
  return typeof s === 'string' && s.length >= 32 ? s : null;
}

function sign(payload) {
  const secret = emailLinkSecret();
  if (!secret) throw new Error('EMAIL_LINK_SECRET is not set - refusing to sign an email link');
  return createHmac('sha256', secret).update(payload).digest('hex').slice(0, 32);
}

export const unsubscribeToken = (userId) => sign(`unsub:${userId}`);
export const clickToken = ({ campaign, userId, to }) => sign(`click:${campaign}:${userId}:${to}`);

function verify(payload, token) {
  if (!emailLinkSecret()) return false;
  const a = Buffer.from(sign(payload)); const b = Buffer.from(String(token ?? ''));
  return a.length === b.length && timingSafeEqual(a, b);
}
export const verifyUnsubscribe = (userId, token) => verify(`unsub:${userId}`, token);
export const verifyClick = ({ campaign, userId, to }, token) => (campaign && userId && to ? verify(`click:${campaign}:${userId}:${to}`, token) : false);
