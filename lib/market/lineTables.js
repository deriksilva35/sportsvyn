// lib/market/lineTables.js — the LINES and FUTURES tables.
//
// FLATTENED FROM THE READS THE CARDS ALREADY USE. No new queries and no new
// numbers: pricedSlate and futuresBoards are called once by the page and both
// views eat from the same plate. A table that re-read the database could drift
// from the cards beside it, and two answers to one price is the failure this
// whole surface has spent the week avoiding.
//
// THE TABLE IS THE SECONDARY VIEW on these tabs, the reverse of props. Cards
// stay the unmarked default so every shipped link renders exactly as it does
// today; ?view=table is the spreadsheet for a reader who wants the whole field
// at once. The futures cards cap at five - the table is where the other 130
// live.

import { TABLE_COLUMNS } from './propsBoard.js';

export const LINES_PAGE = 60;
export const FUTURES_PAGE = 200;

/**
 * A selection's club at column width.
 *
 * THE TEAMS TABLE IS THE SOURCE, not a name-shortening rule: the props board's
 * first-initial-plus-surname is right for people and produces "T. Frogs" for
 * clubs. Exact match, then whole-word prefix, because CFB stores "TCU" where
 * the book writes "TCU Horned Frogs". Draw is neither team and is left alone.
 */
export function teamShort(label, card) {
  if (label === 'Draw') return label;
  for (const side of [card?.home, card?.away]) {
    const name = side?.name;
    if (!name || !side.abbreviation) continue;
    if (label === name || label.startsWith(`${name} `)) return side.abbreviation;
  }
  return label;
}

export const LINES_COLUMNS = Object.freeze([
  { key: 'game', label: 'Game', align: 'l', num: false, get: (r) => r.kickoffAt ?? '' },
  { key: 'lg', label: 'Lg', align: 'l', num: false, get: (r) => r.leagueSlug },
  { key: 'market', label: 'Market', align: 'l', num: false, get: (r) => r.marketLabel },
  { key: 'selection', label: 'Selection', align: 'l', num: false, get: (r) => r.selection },
  { key: 'line', label: 'Line', num: true, get: (r) => (r.line == null ? null : Number(r.line)) },
  { key: 'price', label: 'Price', num: true, get: (r) => r.american },
  { key: 'implied', label: 'Imp%', num: true, get: (r) => r.impliedPct },
  { key: 'move', label: '24h', num: true, get: (r) => (r.moveProb == null ? null : Math.abs(r.moveProb)) },
]);

export const FUTURES_COLUMNS = Object.freeze([
  { key: 'lg', label: 'Lg', align: 'l', num: false, get: (r) => r.leagueSlug },
  { key: 'market', label: 'Market', align: 'l', num: false, get: (r) => r.marketLabel },
  { key: 'team', label: 'Team', align: 'l', num: false, get: (r) => r.selection },
  { key: 'price', label: 'Price', num: true, get: (r) => r.american },
  { key: 'implied', label: 'Imp%', num: true, get: (r) => r.impliedPct },
  { key: 'move', label: '24h', num: true, get: (r) => (r.moveProb == null ? null : Math.abs(r.moveProb)) },
]);

/**
 * ONE ROW PER SELECTION. A two-way card becomes two ML rows, a three-way card
 * becomes three, and the spread and total each contribute their own - which is
 * the point of a table. The card shows one spread because a card has room for
 * one; the table shows both sides because a spreadsheet is where you check
 * that they agree.
 */
export function flattenLines(byLeague, { boardIds, leagues, game = null } = {}) {
  const rows = [];
  for (const slug of leagues) {
    for (const card of byLeague.get(slug) ?? []) {
      if (game != null && card.matchId !== Number(game)) continue;
      const base = {
        matchId: card.matchId,
        matchSlug: card.slug,
        leagueSlug: card.leagueSlug,
        kickoffAt: card.kickoffAt,
        home: card.home,
        away: card.away,
        onBoard: boardIds?.has(card.matchId) ?? false,
      };
      const mlLabel = card.threeWay ? '1X2' : 'ML';
      for (const s of card.h2h) {
        rows.push({
          ...base,
          marketLabel: mlLabel,
          selection: teamShort(s.label, card),
          line: null,
          american: s.american,
          impliedPct: s.impliedPct,
          moveProb: s.moveProb,
        });
      }
      for (const s of card.spread) {
        rows.push({
          ...base,
          marketLabel: 'Spread',
          selection: teamShort(s.label, card),
          line: s.value,
          american: s.american,
          // THE SPREAD'S OWN PRICE CARRIES NO DE-VIGGED IMPLIED on these rows:
          // the ingest de-vigs the pair, and the card never showed one either.
          // A blank is the same claim the card makes, not a new one.
          impliedPct: null,
          moveProb: s.moveProb,
        });
      }
      for (const s of card.total) {
        rows.push({
          ...base,
          marketLabel: 'Total',
          selection: `${s.label} ${s.value ?? ''}`.trim(),
          line: s.value,
          american: s.american,
          impliedPct: null,
          moveProb: s.moveProb,
        });
      }
    }
  }
  return rows;
}

/**
 * THE WHOLE FIELD. The cards show five because a card is a glance; the table
 * is where a reader who wants all 138 CFB titles can have them.
 */
export function flattenFutures(futures) {
  const rows = [];
  for (const f of futures ?? []) {
    for (const t of f.all ?? f.top ?? []) {
      rows.push({
        leagueSlug: f.leagueSlug,
        marketLabel: 'Title',
        selection: t.label,
        american: t.american,
        impliedPct: t.impliedPct,
        moveProb: t.moveProb ?? null,
        priced: f.priced,
      });
    }
  }
  return rows;
}

/**
 * Shared sorter. Same rules as the props table, and deliberately the same
 * code shape: NULLS LAST IN BOTH DIRECTIONS, because a dash is the absence of
 * a number rather than a small one, and flipping the arrow must not march the
 * unmeasured rows to the top.
 */
export function sortRows(rows, columns, sort, dir, fallback) {
  const col = columns.find((c) => c.key === sort) ?? columns.find((c) => c.key === fallback);
  if (!col) return rows;
  const desc = dir ? dir === 'desc' : defaultDesc(col.key);
  return [...rows].sort((a, b) => {
    const av = col.get(a);
    const bv = col.get(b);
    const an = av == null || av === '';
    const bn = bv == null || bv === '';
    if (an && bn) return 0;
    if (an) return 1;
    if (bn) return -1;
    const cmp = col.num ? Number(av) - Number(bv) : String(av).localeCompare(String(bv));
    return desc ? -cmp : cmp;
  });
}

/** Chronology and text read ascending; magnitudes read descending. */
function defaultDesc(key) {
  return !['game', 'lg', 'market', 'selection', 'team'].includes(key);
}

export { TABLE_COLUMNS };
