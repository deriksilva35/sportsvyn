// lib/standings/columns.js — what each code's table SHOWS. PURE: no JSX, no
// database, no clock. Cells are functions from a record row to a string.
//
// IT LIVES OUTSIDE THE COMPONENT ON PURPOSE. These are the page's claims about
// a team's season — a win percentage, a conference split, a streak — and a
// claim that can only be exercised by rendering a React tree is a claim nobody
// tests. Here, node --test reads them directly.
//
// COLLEGE SHOWS A NEUTRAL-SITE COLUMN because a neutral-site game is ordinary
// there — UNC and TCU opened this season in Dublin. The NFL shows points for
// and against, and a playoff seed, because those are what its races are argued
// from. Neither is a special case of the other, which is why these are two
// exported lists and not one list with flags.

import { formatRecord, winPct } from './view.js';

/** A missing split is a DASH, and a dash is honest — we hold no such row. */
const rec = (w, l, t) => formatRecord(w, l, t) ?? '\u2013';

/** ".750" — the leading zero goes, as every standings table prints it. */
const pct = (r) => {
  const p = winPct(r);
  return p == null ? '\u2013' : p.toFixed(3).replace(/^0/, '');
};

/** The college column set. Conference, home, away and neutral splits. */
export const CFB_COLUMNS = [
  { key: 'total', label: 'W-L', numeric: true, cell: (r) => rec(r.wins, r.losses, r.ties) },
  { key: 'pct', label: 'PCT', numeric: true, cell: pct },
  { key: 'conf', label: 'CONF', numeric: true, cell: (r) => rec(r.conf_wins, r.conf_losses, r.conf_ties) },
  { key: 'home', label: 'HOME', numeric: true, cell: (r) => rec(r.home_wins, r.home_losses, r.home_ties) },
  { key: 'away', label: 'AWAY', numeric: true, cell: (r) => rec(r.away_wins, r.away_losses, r.away_ties) },
  { key: 'neutral', label: 'NEUT', numeric: true, title: 'Neutral site', cell: (r) => rec(r.neutral_wins, r.neutral_losses, r.neutral_ties) },
];

/**
 * The NFL column set.
 *
 * THE SEED COLUMN IS CONDITIONAL, and the condition is meaning rather than
 * presence: a playoff seed on a preseason record is a number the provider
 * computes and nobody should read. getLeagueRecords already returns REG rows
 * only, so a seed reaching this table has a real season behind it — but a
 * REG season with no games played yet still yields a seed, so the column is
 * dropped until somebody has actually played.
 */
export function nflColumns(rows) {
  const played = (rows ?? []).some((r) => (r.wins ?? 0) + (r.losses ?? 0) + (r.ties ?? 0) > 0);
  const cols = [
    { key: 'total', label: 'W-L-T', numeric: true, cell: (r) => rec(r.wins, r.losses, r.ties) },
    { key: 'pct', label: 'PCT', numeric: true, cell: pct },
    { key: 'div', label: 'DIV', numeric: true, cell: (r) => rec(r.div_wins, r.div_losses, r.div_ties) },
    { key: 'conf', label: 'CONF', numeric: true, cell: (r) => rec(r.conf_wins, r.conf_losses, r.conf_ties) },
    { key: 'pf', label: 'PF', numeric: true, title: 'Points for', cell: (r) => r.points_for ?? '\u2013' },
    { key: 'pa', label: 'PA', numeric: true, title: 'Points against', cell: (r) => r.points_against ?? '\u2013' },
    { key: 'strk', label: 'STRK', numeric: true, title: 'Current streak', cell: (r) => (r.streak == null || r.streak === 0 ? '\u2013' : `${r.streak > 0 ? 'W' : 'L'}${Math.abs(r.streak)}`) },
  ];
  if (played) {
    cols.push({ key: 'seed', label: 'SEED', numeric: true, cell: (r) => r.playoff_seed ?? '\u2013' });
  }
  return cols;
}
