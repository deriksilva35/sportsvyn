// lib/email/imageRoute.js - what the three /og/email/* routes share (mon-3):
// the fonts (lib/daily/shareCardFonts.js), PUBLIC caching (no reader is in any
// of these pictures, so a CDN may keep them), and "<key>.png" parsing.

import { shareCardFonts } from '../daily/shareCardFonts.js';

/** "nba-2026-10-20-phi-nyk.png" -> "nba-2026-10-20-phi-nyk"; anything else -> null. */
export const keyOf = (file) => {
  const m = /^([a-z0-9-]{1,120})\.png$/.exec(String(file ?? ''));
  return m ? m[1] : null;
};

/** Public and cacheable: an hour at the browser, a day at the edge. */
export const PUBLIC_CACHE = Object.freeze({ 'Cache-Control': 'public, max-age=3600, s-maxage=86400, stale-while-revalidate=86400' });

export async function cardFonts() {
  return (await shareCardFonts(process.cwd())).fonts;
}

/** A mark's path made absolute against the request, so Satori fetches the PNG itself. */
export const absolutize = (team, base) => ({ ...team, src: team.path ? new URL(team.path, base).href : null });
