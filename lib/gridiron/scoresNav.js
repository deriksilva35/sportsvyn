// lib/gridiron/scoresNav.js - every /scores URL is built HERE. PURE.
//
// The date-rail bug class this kills: the arrows built their hrefs inline with
// only ?date=, so tapping ‹ while filtered to CFB silently reset the filter -
// two features fighting because each link knew only its own parameter. One
// builder, every caller, full state every time. A link that drops state now
// requires bypassing this module, which a test forbids.
//
// DEFAULTS ARE OMITTED, not serialized: /scores?sport=all&live= is the same
// page as /scores wearing a costume, and two URLs for one page splits caches
// and reads as untidy in a share sheet.

/** @returns {{sport: 'all'|'nfl'|'cfb', live: boolean}} */
export function parseScoresParams(sp = {}) {
  const raw = Array.isArray(sp.sport) ? sp.sport[0] : sp.sport;
  const sport = raw === 'nfl' || raw === 'cfb' ? raw : 'all';
  const liveRaw = Array.isArray(sp.live) ? sp.live[0] : sp.live;
  return { sport, live: liveRaw === '1' };
}

/** The one sanctioned /scores URL. Pass the FULL desired state every call. */
export function scoresHref(date, { sport = 'all', live = false } = {}) {
  const p = new URLSearchParams();
  if (date) p.set('date', date);
  if (sport !== 'all') p.set('sport', sport);
  if (live) p.set('live', '1');
  const q = p.toString();
  return q ? `/scores?${q}` : '/scores';
}
