// lib/mockNba/share.js - the share card's payload (sun-5). PURE, browser + server.
// The card URL carries the grade, the seat and the user's 13 player ids, so the
// image route needs no session and no stored draft: /mock/nba/card?d=<payload>.
// The payload is ASCII only (a grade, digits, dots), so btoa/atob are safe.

const b64url = (s) => btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const unb64url = (s) => atob(String(s).replace(/-/g, '+').replace(/_/g, '/'));

export function encodeShare({ grade, seat, ids }) {
  return b64url(`${grade}|${seat}|${ids.join('.')}`);
}

const GRADE_RX = /^(A\+|A-|A|B\+|B|C\+|C|D)$/;

/** { grade, seat, ids } or null for anything malformed (the card then 404s). */
export function decodeShare(d) {
  try {
    const [grade, seat, ids] = unb64url(d ?? '').split('|');
    const list = String(ids ?? '').split('.').filter(Boolean).map(Number);
    if (!GRADE_RX.test(grade ?? '') || !(Number(seat) >= 1 && Number(seat) <= 12)) return null;
    if (!list.length || list.length > 13 || list.some((x) => !Number.isInteger(x) || x <= 0)) return null;
    return { grade, seat: Number(seat), ids: list };
  } catch { return null; }
}
