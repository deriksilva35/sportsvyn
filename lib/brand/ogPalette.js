// lib/brand/ogPalette.js - the arcade palette as LITERALS, for the one place a
// token cannot reach: an og:image rendered by Satori (next/og), which draws
// from inline styles and knows nothing of CSS custom properties. Every value
// is the arcade role's own (app/globals.css --arcade-*), pinned equal by
// lib/brand/ogPalette.test.mjs so the card cannot drift from the page.
export const OG_ARCADE = Object.freeze({
  page: '#FFFFFF',
  ink: '#0E0B2B',
  primary: '#1A1650',
  volt: '#D4FF00',
  muted: '#666666',
  surface2: '#F1F1EE',
  line: '#E3E3E0',
  // THE POSITION HUES on white (--tok-pos-* in the arcade block): QB live, RB up,
  // WR chip, TE gold (--arcade-coin), K primary - for the morning email's Daily cards (tue-0).
  live: '#D6006F',
  up: '#1B8A5A',
  chip: '#2447FF',
  gold: '#B7791F',
});
