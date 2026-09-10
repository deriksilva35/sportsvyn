// lib/brand/contrast.js - which of the two site tones sits on a colored
// ground. The decal on a helmet is INK on a light shell and PAPER on a dark
// one, decided by the shell's luminance (WCAG relative luminance, the same
// arithmetic as a contrast ratio), never per team.
export const INK = '#0A0A0A';
export const PAPER = '#F5F5F2';

export function parseHex(hex) {
  const m = /^#?([0-9a-f]{6})$/i.exec(String(hex ?? '').trim());
  if (!m) return null;
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

const chan = (c) => { const s = c / 255; return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; };

export function relativeLuminance(hex) {
  const rgb = parseHex(hex);
  if (!rgb) return null;
  return 0.2126 * chan(rgb[0]) + 0.7152 * chan(rgb[1]) + 0.0722 * chan(rgb[2]);
}

export function contrastRatio(a, b) {
  const la = relativeLuminance(a); const lb = relativeLuminance(b);
  if (la == null || lb == null) return null;
  const [hi, lo] = la >= lb ? [la, lb] : [lb, la];
  return (hi + 0.05) / (lo + 0.05);
}

/** Ink on a light shell, paper on a dark one - whichever contrasts more. */
export function decalColor(shellHex) {
  const ink = contrastRatio(shellHex, INK); const paper = contrastRatio(shellHex, PAPER);
  if (ink == null) return PAPER;
  return ink >= paper ? INK : PAPER;
}
