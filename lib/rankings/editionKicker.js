// lib/rankings/editionKicker.js - the rankings board's kicker line (tue-6).

/**
 * THE KICKER NAMES THE EDITION'S WEEK. It was the literal "Preseason" on every
 * edition, so the NFL board said "Preseason · Edition 2" over a week-3 board
 * (tue-6). The label is the edition's own - "Week 3 · computed 2026-09-29" -
 * cut at " · computed", which is the publish date and not the board's name. An
 * edition with no label is Edition 0's hand-seeded preseason board.
 */
export function editionKicker(label, editionNumber) {
  const name = String(label ?? '').split(' · computed')[0].trim() || 'Preseason';
  return `${name} · Edition ${editionNumber}`;
}
