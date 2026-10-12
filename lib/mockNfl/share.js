// lib/mockNfl/share.js - "My NFL mock draft" card payload (mon-3). PURE, browser + server.
// grade | seat | ids (the ADP source's player ids) | roster counts (SLOT_KEYS order,
// two digits each - the bench runs to 10) | teams. ASCII only (btoa-safe).

import { SLOT_KEYS, ROSTER_PRESETS, SLOT_MAX, BENCH_MAX } from './roster.js';

const b64url = (s) => btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const unb64url = (s) => atob(String(s).replace(/-/g, '+').replace(/_/g, '/'));
const code = (counts) => SLOT_KEYS.map((k) => String(Math.max(0, Math.min(k === 'BN' ? BENCH_MAX : SLOT_MAX, Number(counts?.[k]) || 0))).padStart(2, '0')).join('');

export function encodeShare({ grade, seat, ids, counts = ROSTER_PRESETS.espn.counts, teams = 12 }) {
  return b64url(`${grade}|${seat}|${ids.join('.')}|${code(counts)}|${teams}`);
}

const LEGACY_KEYS = Object.freeze(['QB', 'RB', 'WR', 'TE', 'FLEX', 'K', 'DST', 'BN']);
const GRADE_RX = /^(A\+|A-|A|B\+|B-|B|C\+|C|D)$/;

/** { grade, seat, ids, counts, teams } or null for anything malformed (the card then 404s). */
export function decodeShare(d) {
  try {
    const [grade, seat, ids, c, t] = unb64url(d ?? '').split('|');
    const teams = Number(t);
    const list = String(ids ?? '').split('.').filter(Boolean);
    if (!GRADE_RX.test(grade ?? '') || !Number.isInteger(teams) || teams < 8 || teams > 14) return null;
    if (!(Number(seat) >= 1 && Number(seat) <= teams)) return null;
    if (!list.length || list.length > 60 || list.some((x) => !/^\d{1,9}$/.test(x))) return null;
    // A card shared before SFLX existed (mon-3, eight slot keys) still opens.
    const keys = c?.length === LEGACY_KEYS.length * 2 ? LEGACY_KEYS : SLOT_KEYS;
    if (!new RegExp(`^\\d{${keys.length * 2}}$`).test(c ?? '')) return null;
    const counts = Object.fromEntries(SLOT_KEYS.map((k) => [k, 0]));
    keys.forEach((k, i) => { counts[k] = Number(c.slice(i * 2, i * 2 + 2)); });
    if (SLOT_KEYS.some((k) => counts[k] > (k === 'BN' ? BENCH_MAX : SLOT_MAX))) return null;
    return { grade, seat: Number(seat), ids: list, counts, teams };
  } catch { return null; }
}
