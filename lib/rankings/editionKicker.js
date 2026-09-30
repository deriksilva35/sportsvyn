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

/**
 * THE BOARD'S TITLE, "NFL · WEEK 3" (board A). The week is the edition's own
 * forWeek - the week it was computed FROM, stored in its notes - and never a
 * typed number: a literal is how the kicker above said "Preseason" over week 3.
 * No stored week (edition 0) falls back to the same "Preseason" name.
 */
export function boardTitle(leagueLabel, forWeek) {
  const wk = forWeek?.week;
  return `${leagueLabel} · ${wk == null ? 'PRESEASON' : `WEEK ${wk}`}`;
}

/**
 * THE EDITION LINE: "Edition 1 · computed Tue 9:05 AM EDT · current season
 * only". Every part is stored: the number, the publish instant (drawn in the
 * reader's zone), and the model's scope - or, for a board that blended a poll,
 * the poll week it blended. Parts that are absent are left out, not dashed.
 */
export function editionLine({ editionNumber, publishedAt, scope = null, apWeek = null }, tz = 'America/New_York') {
  const parts = [`Edition ${editionNumber}`];
  if (publishedAt) {
    const d = new Date(publishedAt);
    if (!Number.isNaN(d.getTime())) {
      const f = new Intl.DateTimeFormat('en-US', { timeZone: tz, weekday: 'short', hour: 'numeric', minute: '2-digit', timeZoneName: 'short' });
      parts.push(`computed ${f.format(d).replace(',', '')}`);
    }
  }
  if (scope) parts.push(scope);
  if (apWeek != null) parts.push(`with AP week ${apWeek}`);
  return parts.join(' · ');
}
