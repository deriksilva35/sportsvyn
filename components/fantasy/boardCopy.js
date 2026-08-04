// components/fantasy/boardCopy.js — every string on /nfl/fantasy. Pure data, no
// JSX, so the register and the dash rule are unit-testable.
//
// HYPHENS ONLY. No em or en dashes anywhere. The one exception is the em-dash
// GLYPH used as the "no value" marker in a cell, which is not copy - it is the
// absence of a number, and it lives in EM_DASH below so a test can tell the two
// apart.
//
// The register is the mock's: flat, declarative, no urgency, no advice. The
// board reports what the market did and stops. Nothing here recommends a player
// or predicts anything.

import { MIN_D3_HISTORY, MIN_D7_HISTORY, MIN_DRIFT_HISTORY, STREAK, SV_MIN_DRAFTS, BAND_MIN_DRAFTS } from '@/lib/fantasy/movement';

// The no-value marker. Not copy - the typographic absence of a number.
export const EM_DASH = '—';

export const PAGE = {
  kicker: 'NFL · Fantasy · ADP',
  title: ['The Movement', 'Board'],
  sub: 'Where drafters are actually taking players, and how that has changed. Not a ranking. Not a recommendation. A record of what the market is doing, updated every morning.',
  panelLabel: 'The Board',
  panelNote: 'Sorted by three-day movement. A positive number means the player is being drafted earlier than he was three days ago.',
  attr: 'ADP data courtesy of Fantasy Football Calculator · Methodology published at /methodology',
};

// Scoring formats. Size is NOT selectable - FFC publishes exactly one league
// size per format, so the format chip carries the size with it.
export const FORMAT_CHIPS = [
  { key: 'ppr', label: 'PPR', size: 12 },
  { key: 'half-ppr', label: 'Half', size: 10 },
  { key: 'standard', label: 'Standard', size: 8 },
  { key: '2qb', label: '2QB', size: 12 },
];

export const POSITION_CHIPS = [
  { key: 'ALL', label: 'All' }, { key: 'QB', label: 'QB' }, { key: 'RB', label: 'RB' },
  { key: 'WR', label: 'WR' }, { key: 'TE', label: 'TE' },
];

// Rounds end where the data ends - the pool runs to about pick 182, so 11+ is
// simply the tail. No synthetic depth.
export const ROUND_CHIPS = [
  { key: 'ALL', label: 'All' }, { key: '1-5', label: '1-5' },
  { key: '6-10', label: '6-10' }, { key: '11+', label: '11+' },
];

export const CLASS_CHIPS = [
  { key: 'ALL', label: 'All' }, { key: 'ROOKIE', label: 'Rookies' }, { key: 'VET', label: 'Veterans' },
];

export const COLUMNS = {
  band: 'Band', player: 'Player', adp: 'ADP', open: 'Open',
  d3: '3d', d7: '7d', drift: 'Drift', range: 'Range', sv: 'SV ADP', div: 'Div',
};

export const SEARCH_PLACEHOLDER = 'Search player or team';
export const MOVERS_ONLY = 'Movers only';

// Band legend. The magnitude phrase is per format, because half a round means a
// different number of picks in an 8-team league than a 12.
export function bandLegend(size) {
  return [
    { key: 'steam', label: 'Steam', text: `rose half a round or more in three days (${size / 2} picks)` },
    { key: 'warming', label: 'Climbing', text: `rose ${STREAK} snapshots running` },
    { key: 'quiet', label: 'Quiet', text: 'neither' },
    { key: 'cooling', label: 'Fading', text: `fell ${STREAK} snapshots running` },
    { key: 'sliding', label: 'Sliding', text: `fell half a round or more in three days (${size / 2} picks)` },
  ];
}

export const METHOD = {
  title: 'What this measures',
  body: 'Average draft position is not a ranking and not an opinion. It is a record of where thousands of drafters have actually taken a player. Drift counts how many mornings in a row he has moved the same direction. A player crossing from the fourteenth round to the thirteenth is inside the noise on any single day. The same player doing it six days running is not. This board shows both and leaves the conclusion to you.',
  bandsTitle: 'Bands',
  bandNote: 'Magnitude thresholds are expressed in rounds, not picks, so they hold their meaning across formats. In PPR (12-team), half a round is six picks; in the 8-team standard pool it is four. Persistence is counted in consecutive snapshots moving the same direction, which means the same thing at pick 20 and pick 200. A streak breaks the first morning a player moves the other way.',
  svTitle: 'Sportsvyn ADP',
  svBody: `Where our own drafters take a player across every completed mock. Only human picks count - the AI opponents draft against market ADP by construction, so counting them would measure our engine rather than our drafters. Divergence is Sportsvyn ADP minus market ADP. A positive number means our drafters wait longer than the field does. Shown once a player has been taken in ${SV_MIN_DRAFTS} drafts; until then the column reads as a dash.`,
  gatesTitle: 'What the dashes mean',
  gatesBody: `Every column waits for the history it needs, and shows a dash until it has it. Three-day movement needs ${MIN_D3_HISTORY} snapshots, seven-day and drift need ${MIN_DRIFT_HISTORY}. A player who joined the pool yesterday has a dash where a player who has been in it a fortnight has a number, on the same morning. A band is withheld from anyone drafted in fewer than ${BAND_MIN_DRAFTS} drafts, because a large move computed from a handful of them is noise wearing the shape of a signal. Nothing on this board is estimated, extrapolated, or filled in.`,
};

// Day-one state: fewer snapshots than any movement column needs.
export const EMPTY = {
  head: 'Not enough history yet',
  body: 'The board opened this morning. Movement needs a second snapshot to measure, and the three-day column needs three. Both fill in on their own. Nothing is estimated in the meantime.',
};

/**
 * The volt-marked notice above the sheet, or null when every column is open.
 * States exactly which columns are waiting and what opens them - a reader
 * should never have to guess whether a dash is missing data or a broken page.
 */
export function thinNotice(snapshotCount) {
  if (snapshotCount >= MIN_DRIFT_HISTORY) return null;
  // Each clause carries its OWN threshold. An earlier version emitted one
  // trailing "open at N" for the whole list, which read correctly only when a
  // single tier was waiting - with both waiting it printed the three-day
  // threshold against the seven-day clause, which is simply a false statement.
  const waiting = [];
  if (snapshotCount < MIN_D3_HISTORY) {
    waiting.push(`the three-day column, range, and bands open at ${MIN_D3_HISTORY}`);
  }
  if (snapshotCount < MIN_D7_HISTORY || snapshotCount < MIN_DRIFT_HISTORY) {
    waiting.push(`the seven-day column and drift open at ${Math.max(MIN_D7_HISTORY, MIN_DRIFT_HISTORY)}`);
  }
  const snaps = snapshotCount === 1 ? '1 snapshot' : `${snapshotCount} snapshots`;
  const tail = waiting.join('; ');
  return `${snaps} of history. Overnight movement is live. ${tail.charAt(0).toUpperCase()}${tail.slice(1)}.`;
}

// ---------------------------------------------------------------------------
// The /nfl entry card. Same copy module as the board so the two surfaces cannot
// describe the same instrument in two registers.
export const CARD = {
  label: 'Movement',
  all: 'Full board',
  cta: 'Mock draft',
  href: '/nfl/fantasy',
  ctaHref: '/sim/setup',
  tabs: { rising: 'Rising', falling: 'Falling', climbing: 'Climbing' },
  colAdp: 'ADP',
  col3d: '3d',
  colDrift: 'Drift',
  sub(format, size) {
    const label = FORMAT_CHIPS.find((c) => c.key === format)?.label ?? format;
    return `Fantasy ADP · ${size}-team ${label}`;
  },
  stamp(date) {
    return date ? `Snapshot ${date}` : 'No snapshot yet';
  },
  // Nobody eligible moved in either direction. Distinct from the not-enough-
  // history state below - here the instrument works and the market was flat.
  flat: 'No qualifying move either way this morning.',
};

/**
 * The card's not-enough-history state. Says how many mornings are left rather
 * than naming a weekday - the mock's "Opens Wednesday" would be wrong the moment
 * a cron run is missed, and this board's whole claim is that it never states
 * something it has not measured.
 */
export function cardEmpty(snapshotCount) {
  const left = MIN_D3_HISTORY - snapshotCount;
  const mornings = left === 1 ? 'one more morning' : `${left} more mornings`;
  return {
    head: 'Not open yet',
    body: `Three-day movement needs ${MIN_D3_HISTORY} snapshots and the board has ${snapshotCount}. It records one each morning, so it opens in ${mornings}. Nothing is estimated in the meantime.`,
  };
}

export const PROV_LABELS = {
  snapshot: 'Snapshot', pool: 'Pool', history: 'History', source: 'Source', sv: 'Sportsvyn ADP',
};
