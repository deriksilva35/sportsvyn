// lib/wire/wireNav.js — the wire page's lane filter, as a URL. PURE.
//
// THE scoresNav LAW AGAIN: one builder, one parser, round-tripped in tests. The
// default chip carries no param, so the page has one address rather than two
// that render identically.

import { WIRE_CHIPS } from './read.js';

export function parseWireChip(sp = {}) {
  const raw = Array.isArray(sp.lane) ? sp.lane[0] : sp.lane;
  return WIRE_CHIPS.some((c) => c.key === raw) ? raw : null;   // null = All
}

export function parseWirePage(sp = {}) {
  const raw = Array.isArray(sp.p) ? sp.p[0] : sp.p;
  const n = Number(raw);
  return Number.isInteger(n) && n > 0 ? n : 0;
}

/** The one sanctioned wire URL. Defaults are omitted. */
export function wireHref(leagueSlug, { chip = null, page = 0 } = {}) {
  const p = new URLSearchParams();
  if (chip && WIRE_CHIPS.some((c) => c.key === chip)) p.set('lane', chip);
  if (page > 0) p.set('p', String(page));
  const q = p.toString();
  return `/${leagueSlug}/wire${q ? `?${q}` : ''}`;
}
