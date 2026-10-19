// lib/email/cards.js - THE MORNING EMAIL'S PICTURES (mon-3): the scoreboard chip,
// the opener hero and the empty game tiles, as Satori element trees. PURE: data
// in, an element out. The public PNG routes (app/og/email/*) wrap these in an
// ImageResponse; the test script renders the very same trees locally and sends
// them inline. Built with createElement, not JSX, so node tests can import it.
//
// NO PERSONAL DATA: every input is public - a game, a date, a game type. The
// URLs carry a match slug, a date or a game key, never a reader.
//
// THE MARK: NFL/CFB helmets, MLB caps (NBA jerseys once they land), as the PNG
// copies in public/email/marks/<league>/ (Satori cannot read the WebP originals);
// a team with none gets the two-tone disc - its own colours, both or neither.
//
// RETINA: every picture is drawn at 2x its display size (CHIP 560x180 -> 1120x360).

import { createElement as h } from 'react';
import { headgearFile } from '../teams/headgear.js';

export const INK = '#1A1650';
export const LIME = '#D4FF00';
const MUTED = '#4A4870';
const LINE = '#E4E3EE';
const PAPER = '#FFFFFF';
const MONO = 'RubikMono';
const SANS = 'Rubik';
const flex = (style = {}) => ({ display: 'flex', ...style });

export const CHIP = Object.freeze({ width: 1120, height: 360 });
export const TILE = Object.freeze({ width: 360, height: 440 });
export const heroSize = (n) => ({ width: 1120, height: 300 + Math.max(1, n) * 384 });

/** The mark's public path, or null (the disc). CFB files differ from their keys twice (TA&M, M-OH). */
export function markPath(league, abbr) {
  const file = headgearFile(league, abbr);
  return file ? `/email/marks/${league}/${file}.png` : null;
}

/** A team mark: the picture when there is one, else the two-tone disc. */
export function mark({ src = null, c1 = '#1A1650', c2 = '#D4FF00', abbr = '' }, size = 120) {
  if (src) return h('img', { src, width: size, height: size, style: { objectFit: 'contain' } });
  return h('div', { style: flex({ width: size, height: size, borderRadius: size, background: c1, border: `${Math.round(size / 10)}px solid ${c2}`, alignItems: 'center', justifyContent: 'center', color: PAPER, fontFamily: MONO, fontSize: size / 4 }) }, abbr.slice(0, 3));
}

function teamRow(t) {
  return h('div', { style: flex({ alignItems: 'center', gap: 28 }) },
    mark(t, 112),
    h('div', { style: flex({ flexDirection: 'column' }) },
      // ITALIC NAMES: the card font has no italic face, so the name is slanted.
      h('div', { style: { fontFamily: SANS, fontWeight: 700, fontSize: 50, color: INK, lineHeight: 1.05, transform: 'skewX(-10deg)' } }, t.name),
      h('div', { style: { fontFamily: MONO, fontSize: 24, color: MUTED, letterSpacing: 2 } }, t.abbr ?? '')));
}

/**
 * THE SCOREBOARD CHIP: PT time first, then ET, the league; then each team -
 * mark, italic name, abbreviation. g: { away, home: { name, abbr, src, c1, c2 }, league, pt, et }
 */
export function chipCard(g, { width = CHIP.width, height = CHIP.height, frame = true } = {}) {
  return h('div', { style: flex({ width, height, flexDirection: 'column', background: PAPER, padding: 32, border: frame ? `4px solid ${LINE}` : 'none', borderRadius: 36 }) },
    h('div', { style: flex({ justifyContent: 'space-between', alignItems: 'center', paddingBottom: 18 }) },
      h('div', { style: flex({ gap: 18, alignItems: 'baseline' }) },
        h('span', { style: { fontFamily: MONO, fontSize: 30, color: INK } }, g.pt ?? ''),
        h('span', { style: { fontFamily: SANS, fontSize: 26, color: MUTED } }, g.et ?? '')),
      h('span', { style: { fontFamily: MONO, fontSize: 24, color: INK, background: LIME, padding: '8px 18px', borderRadius: 40 } }, g.league ?? '')),
    h('div', { style: flex({ flexDirection: 'column', gap: 14 }) }, teamRow(g.away), teamRow(g.home)));
}

/** THE OPENER HERO: the eyebrow, NBA IS BACK, tonight's chips stacked. */
export function heroCard({ eyebrow = 'OPENING NIGHT', title = 'NBA IS BACK', games = [] }) {
  const { width, height } = heroSize(games.length);
  return h('div', { style: flex({ width, height, flexDirection: 'column', background: INK, padding: 48, borderRadius: 48 }) },
    h('div', { style: { fontFamily: MONO, fontSize: 28, color: LIME, letterSpacing: 4 } }, eyebrow),
    h('div', { style: { fontFamily: MONO, fontSize: 96, color: PAPER, lineHeight: 1.05, padding: '14px 0 32px' } }, title),
    h('div', { style: flex({ flexDirection: 'column', gap: 24 }) },
      ...games.map((g) => chipCard(g, { width: width - 96, height: 360, frame: false }))));
}

/** One empty slot box with its label. */
const slot = (label, w = 92) => h('div', { style: flex({ width: w, height: 64, border: `3px dashed ${LINE}`, borderRadius: 14, alignItems: 'center', justifyContent: 'center', fontFamily: MONO, fontSize: 18, color: MUTED }) }, label);

/**
 * THE EMPTY GAME TILE: what the game looks like before you play it.
 *   pickem - empty picks with confidence ranks; daily - 8 empty slots;
 *   weekly - an empty roster; anything else - its name on a plain tile.
 */
export function tileCard({ kind, label }) {
  const W = TILE.width; const H = TILE.height;
  let body;
  if (kind === 'pickem') {
    body = h('div', { style: flex({ flexDirection: 'column', gap: 10 }) },
      ...[4, 3, 2, 1].map((r) => h('div', { style: flex({ alignItems: 'center', gap: 12 }) },
        h('div', { style: flex({ width: 44, height: 44, borderRadius: 44, background: INK, color: LIME, fontFamily: MONO, fontSize: 20, alignItems: 'center', justifyContent: 'center' }) }, String(r)),
        slot('PICK', 120), slot('PICK', 120))));
  } else if (kind === 'daily') {
    body = h('div', { style: flex({ flexWrap: 'wrap', gap: 12, width: W - 48 }) },
      ...['QB', 'RB', 'RB', 'WR', 'WR', 'TE', 'FLEX', 'K'].map((s) => slot(s, 140)));
  } else if (kind === 'weekly') {
    body = h('div', { style: flex({ flexDirection: 'column', gap: 12 }) },
      ...['QB', 'RB', 'WR', 'TE', 'FLEX', 'DST'].map((s) => h('div', { style: flex({ alignItems: 'center', gap: 12 }) },
        h('div', { style: { width: 70, fontFamily: MONO, fontSize: 18, color: INK } }, s), slot('', 210))));
  } else {
    // ANY OTHER GAME: three empty picks - the name is already the tile's title.
    body = h('div', { style: flex({ flexDirection: 'column', gap: 14, paddingTop: 8 }) }, slot('PICK', 296), slot('PICK', 296), slot('PICK', 296));
  }
  return h('div', { style: flex({ width: W, height: H, flexDirection: 'column', background: PAPER, border: `4px solid ${LINE}`, borderRadius: 32, padding: 24, gap: 12 }) },
    h('div', { style: { fontFamily: MONO, fontSize: 24, color: INK, paddingBottom: 8 } }, String(label ?? '').toUpperCase()),
    body);
}

/** "Philadelphia 76ers at New York Knicks, 4:00 PM PT / 7:00 PM ET" - every picture's alt text. */
export const altFor = (g) => `${g.away?.name ?? ''} at ${g.home?.name ?? ''}${g.pt ? `, ${g.pt}${g.et ? ` / ${g.et}` : ''}` : ''}`;
