// lib/leagues/name.js - a league's name, PURE and client-safe, so the create
// sheet and lib/leagues/core.js read one rule (core re-exports it).

export function validateLeagueName(raw) {
  const name = String(raw ?? '').trim().replace(/\s+/g, ' ');
  if (name.length < 3) return { ok: false, reason: 'Three characters at least' };
  if (name.length > 40) return { ok: false, reason: 'Forty characters at most' };
  return { ok: true, name };
}
