// lib/retired.js — editorial and soccer, retired (tue-14, 29 Sep 2026).
// PURE: no Next, no database. proxy.js (which a test cannot import) and the
// pages that redirect soccer rows both read it.
//
// WHY 301s AND NOT A HIDE-THEN-REDIRECT. Nobody reads these routes - Vercel
// Analytics, 15-29 Sep: /today, /articles, /article/* and /world-cup-2026/*
// had 0 views - and the old aliases were chains (/bracket 308 -> the World
// Cup bracket, /world-cup/* 307 -> the current edition). One clean hop to a
// page that is drawn beats a chain to one that is not.
//
// THE DATA STAYS. articles, ai_generations, blurbs and the soccer matches and
// teams are history: no table is dropped and no row deleted. The page files
// stay too; the proxy answers before Next routes to them.

/** Leagues whose rows still render on the shared /match, /team and /player
 *  pages. Every other league (EPL, the World Cup, friendlies) is soccer, and a
 *  soccer row 301s to /scores. NBA joins (thu-17) BEFORE its first row exists,
 *  so the first NBA match, team or player page renders instead of 301ing.
 *  EPL CAME BACK (thu-24); the World Cup and the friendlies stay retired. */
export const KEPT_LEAGUES = Object.freeze(['nfl', 'cfb', 'mlb', 'nba', 'epl']);
export const isRetiredLeague = (slug) => slug != null && !KEPT_LEAGUES.includes(String(slug));

/**
 * Retired route -> destination. Each key matches the path itself and every
 * path beneath it (/epl matches /epl/standings; /article matches /article/x).
 * Order does not matter: no key is a prefix of another at a segment boundary.
 */
export const RETIRED_ROUTES = Object.freeze({
  // editorial
  '/today': '/games',
  '/articles': '/games',
  '/article': '/games',
  '/nfl/wire': '/nfl',
  '/cfb/wire': '/cfb',
  // soccer - the World Cup and its aliases. /epl/* serves again (thu-24).
  '/schedule': '/scores',
  '/stats': '/scores',
  '/world-cup': '/scores',
  '/world-cup-2026': '/scores',
  '/bracket': '/scores',
  '/power-rankings': '/scores',
});

/** The destination for a retired path, or null. The query is dropped: it
 *  addressed content that no longer exists (a page of articles, a WC tab). */
export function retiredRedirect(pathname) {
  const p = String(pathname ?? '').replace(/\/+$/, '') || '/';
  for (const [from, to] of Object.entries(RETIRED_ROUTES)) {
    if (p === from || p.startsWith(`${from}/`)) return to;
  }
  return null;
}
