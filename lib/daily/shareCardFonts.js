// lib/daily/shareCardFonts.js - the faces the Daily share card is drawn in.
//
// Satori (next/og) takes ttf/otf/woff only; the app's self-hosted faces
// (app/fonts) are woff2, so the card reads committed static TTFs from
// assets/fonts, the invite card's pattern (app/j/[code]/opengraph-image.js).
//
//   Rubik Mono One 400   the display face: header, score, chips, points
//   Rubik 400            body and small text (relay mon-18 item 5)
//   Rubik 600            player names - where the mock sets 600
//   Rubik 700            kept as the fallback
//
// RUBIK REGULAR AND SEMIBOLD ARE COMING FROM THE MAC (relay mac-mon-3) as
// assets/fonts/Rubik-Regular.ttf and assets/fonts/Rubik-SemiBold.ttf. Until
// they land, a missing weight is drawn from Rubik-Bold.ttf, registered UNDER
// that weight - so the card renders today (heavier than the mock) and switches
// to the real faces the moment the files are committed, with no code change.
// lib/daily/shareCardFonts.test.mjs names both files, so their absence shows.

import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

export const FONT_DIR = 'assets/fonts';
export const MONO_FILE = 'RubikMonoOne-Regular.ttf';
export const FALLBACK_FILE = 'Rubik-Bold.ttf';
/** weight -> the static TTF the mock wants for it. */
export const RUBIK_FILES = Object.freeze({ 400: 'Rubik-Regular.ttf', 600: 'Rubik-SemiBold.ttf', 700: 'Rubik-Bold.ttf' });

/**
 * @param {string} [root] repo root (process.cwd() in the route)
 * @param {(path: string) => Promise<Buffer>} [read] injectable for tests
 * @returns {Promise<{ fonts: object[], fallbacks: string[] }>} ImageResponse
 *   `fonts`, and the expected files that were missing (drawn from Bold).
 */
export async function shareCardFonts(root = process.cwd(), read = readFile) {
  const at = (f) => read(join(root, FONT_DIR, f));
  const [mono, bold] = await Promise.all([at(MONO_FILE), at(FALLBACK_FILE)]);
  const fonts = [{ name: 'RubikMono', data: mono, weight: 400, style: 'normal' }];
  const fallbacks = [];
  for (const [w, file] of Object.entries(RUBIK_FILES)) {
    let data = file === FALLBACK_FILE ? bold : null;
    if (!data) {
      try { data = await at(file); } catch { data = bold; fallbacks.push(file); }
    }
    fonts.push({ name: 'Rubik', data, weight: Number(w), style: 'normal' });
  }
  return { fonts, fallbacks };
}
