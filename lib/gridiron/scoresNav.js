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

/** The scoreboard's leagues, in chip order. ONE list: the parser validates
 * against it and the chips render from it, so a new league is a one-line
 * change that cannot leave the URL and the UI disagreeing. */
export const SPORT_KEYS = ['nfl', 'cfb', 'epl'];
export const SPORT_CHIPS = [
  { key: 'nfl', label: 'NFL' },
  { key: 'cfb', label: 'CFB' },
  { key: 'epl', label: 'EPL' },
];

/** @returns {{sport: 'all'|'nfl'|'cfb'|'epl', live: boolean}} */
export function parseScoresParams(sp = {}) {
  const raw = Array.isArray(sp.sport) ? sp.sport[0] : sp.sport;
  // The filter's vocabulary. 'epl' joined in relay 2 - one list, so the
  // parser and the chips cannot disagree about what is filterable.
  const sport = SPORT_KEYS.includes(raw) ? raw : 'all';
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

/**
 * THE SPORTS-DAY LAW - the /scores landing default only. Calendar bucketing
 * (ingest, the readers' day grouping) stays ET-midnight and is untouched;
 * what moves is which day the no-param scoreboard OPENS on. Roll back one ET
 * day while EITHER holds:
 *   (a) a game on the prior ET date is still live - a 2 AM straggler holds
 *       Saturday, whatever the hour;
 *   (b) it is before 06:00 ET - a quiet 3 AM shows Saturday's finals, not an
 *       empty Sunday.
 * PURE: the caller supplies priorHasLive (a reader's fact); an explicit
 * ?date= never reaches this function at all.
 */
export function defaultScoresDate(now = new Date(), { priorHasLive = false } = {}) {
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit',
  });
  const today = fmt.format(now);
  const hour = Number(new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York', hour: 'numeric', hourCycle: 'h23',
  }).format(now));
  if (!priorHasLive && hour >= 6) return today;
  const prior = new Date(`${today}T12:00:00Z`);
  prior.setUTCDate(prior.getUTCDate() - 1);
  return prior.toISOString().slice(0, 10);
}
