// lib/mockNba/share.js - the share card's payload (sun-5, sun-7). PURE, browser + server.
// The card URL carries the grade, the seat, the user's player ids, the roster
// shape (nine slot counts in SLOT_KEYS order) and the number of teams, so the image route needs no
// session and no stored draft: /mock/nba/card?d=<payload>. ASCII only (btoa-safe).

import { SLOT_KEYS, ROSTER_PRESETS } from './roster.js';

const b64url = (s) => btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const unb64url = (s) => atob(String(s).replace(/-/g, '+').replace(/_/g, '/'));

const countsCode = (counts) => SLOT_KEYS.map((k) => Math.max(0, Math.min(4, Number(counts?.[k]) || 0))).join('');

export function encodeShare({ grade, seat, ids, counts = ROSTER_PRESETS.standard.counts, teams = 12 }) {
  return b64url(`${grade}|${seat}|${ids.join('.')}|${countsCode(counts)}|${teams}`);
}

const GRADE_RX = /^(A\+|A-|A|B\+|B-|B|C\+|C|D)$/;

/** { grade, seat, ids, counts, teams } or null for anything malformed (the card then 404s). */
export function decodeShare(d) {
  try {
    const [grade, seat, ids, code, nTeams] = unb64url(d ?? '').split('|');
    const list = String(ids ?? '').split('.').filter(Boolean).map(Number);
    if (!GRADE_RX.test(grade ?? '') || !(Number(seat) >= 1 && Number(seat) <= 14)) return null;
    if (!list.length || list.length > 36 || list.some((x) => !Number.isInteger(x) || x <= 0)) return null;
    let counts = ROSTER_PRESETS.standard.counts;
    if (code != null) {
      if (!/^[0-4]{9}$/.test(code)) return null;
      counts = Object.fromEntries(SLOT_KEYS.map((k, i) => [k, Number(code[i])]));
    }
    const teams = nTeams == null ? 12 : Number(nTeams);
    if (!Number.isInteger(teams) || teams < 8 || teams > 14 || Number(seat) > teams) return null;
    return { grade, seat: Number(seat), ids: list, counts, teams };
  } catch { return null; }
}
