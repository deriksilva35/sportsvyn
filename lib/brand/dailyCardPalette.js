// lib/brand/dailyCardPalette.js - the Daily share card's colours, as LITERALS.
//
// The card is a PNG drawn by Satori (next/og), which reads inline styles and
// knows nothing of CSS custom properties, so the values cannot be tokens. They
// are Derik's mock (Play tab canvas, "Daily share card" page, roster cards,
// 5 Oct): the Daily blue ground (= --tok-daily in app/globals.css), volt, the
// pale-blue secondary ink, and one colour per position for the slot chips.
// Kept under lib/brand/ because colour DATA lives here, outside the hex
// census (lib/brand/hexCensus.js).
export const DAILY_CARD = Object.freeze({
  ground: '#245BFF',
  ink: '#FFFFFF',
  volt: '#D4FF00',
  soft: '#C9D6FF',
  chip: 'rgba(255,255,255,0.12)',
  pill: 'rgba(255,255,255,0.16)',
  rule: 'rgba(255,255,255,0.14)',
  bar: 'rgba(255,255,255,0.18)',
  dim: 'rgba(255,255,255,0.30)',
  flame: '#FF8A1F',
  flameCore: '#FFD23F',
});

/** Slot label -> chip ink. FLEX is white; an unknown label reads as FLEX. */
export const POSITION_INK = Object.freeze({
  QB: '#FF5DA2',
  RB: '#3DDC97',
  WR: '#7FB0FF',
  TE: '#FFB020',
  FLEX: '#FFFFFF',
  K: '#C9C3FF',
});
