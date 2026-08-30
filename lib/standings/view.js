// lib/standings/view.js — standings grouping and ordering. PURE: no database,
// no JSX, no clock.
//
// TWO CODES, TWO GROUPINGS, ONE SORT. College groups by conference and shows a
// neutral-site column, because a neutral-site game is an ordinary part of a
// college schedule (UNC and TCU opened in Dublin). The NFL groups conference
// then division and shows points for and against, because that is what its
// tiebreaks are argued from. Neither shape is a special case of the other, so
// the grouper takes the keys it should group by rather than a league name.


/**
 * "9-3" or "9-3-1" — a tie column only appears when there is a tie.
 *
 * IT LIVES HERE, IN THE PURE MODULE, and read.js re-exports it. Formatting a
 * record needs no database, and having the pure module import the db one to
 * get it made this file untestable without a connection string — which is the
 * opposite of what "PURE" in the header is worth.
 */
export function formatRecord(w, l, t) {
  if (w == null || l == null) return null;
  return t ? `${w}-${l}-${t}` : `${w}-${l}`;
}

/** Win percentage, ties counting a half. NULL when nothing has been played. */
export function winPct(r) {
  const g = (r.wins ?? 0) + (r.losses ?? 0) + (r.ties ?? 0);
  if (!g) return null;
  return ((r.wins ?? 0) + (r.ties ?? 0) * 0.5) / g;
}

/**
 * THE SORT. Win percentage, then more wins, then fewer losses, then name.
 *
 * NOT a standings tiebreak. Real tiebreaks are head-to-head, common games and
 * conference record, and the leagues publish them themselves — inventing one
 * here would mean shipping an order that disagrees with the league's on the
 * one week it matters. This is a readable default ordering and is labelled as
 * such on the page.
 */
export function compareRecords(a, b) {
  const pa = winPct(a), pb = winPct(b);
  if (pa != null && pb != null && pa !== pb) return pb - pa;
  if (pa == null && pb != null) return 1;
  if (pb == null && pa != null) return -1;
  if ((b.wins ?? 0) !== (a.wins ?? 0)) return (b.wins ?? 0) - (a.wins ?? 0);
  if ((a.losses ?? 0) !== (b.losses ?? 0)) return (a.losses ?? 0) - (b.losses ?? 0);
  return String(a.name ?? '').localeCompare(String(b.name ?? ''));
}

/**
 * Group rows into ordered sections by one or two keys.
 *
 * A row whose key is missing lands in a section of its own named by
 * UNGROUPED rather than vanishing — a conference we do not hold is a gap worth
 * seeing, not a team worth dropping.
 */
export const UNGROUPED = 'Other';

export function groupRecords(rows, keys) {
  const out = new Map();
  for (const r of rows ?? []) {
    const path = keys.map((k) => (r[k] ? String(r[k]) : UNGROUPED));
    const label = path.join(' · ');
    if (!out.has(label)) out.set(label, { label, path, rows: [] });
    out.get(label).rows.push(r);
  }
  for (const g of out.values()) g.rows.sort(compareRecords);
  return [...out.values()].sort((a, b) => {
    // UNGROUPED sinks; everything else is alphabetical, which for the NFL
    // yields AFC before NFC and EAST/NORTH/SOUTH/WEST within each.
    const au = a.path.includes(UNGROUPED), bu = b.path.includes(UNGROUPED);
    if (au !== bu) return au ? 1 : -1;
    return a.label.localeCompare(b.label);
  });
}

/** "1st" / "2nd" / "3rd" — the EPL chip's grammar. */
export function ordinal(n) {
  const v = Number(n);
  if (!Number.isFinite(v) || v < 1) return null;
  const s = ['th', 'st', 'nd', 'rd'];
  const m = v % 100;
  return `${v}${s[(m - 20) % 10] ?? s[m] ?? s[0]}`;
}

/**
 * WHAT A RECORD CHIP SAYS, or null.
 *
 * A CHIP MAY ONLY CLAIM KNOWLEDGE. No record, no chip — never a dash, never
 * "0-0" invented from an absence. The three leagues have genuinely different
 * grammar and this is the one place that difference lives.
 */
export function recordChip(league, source) {
  if (!source) return null;
  if (league === 'epl') {
    // A table position, not a record. "3rd" is what a supporter says.
    return ordinal(source.rank);
  }
  const s = formatRecord(source.wins, source.losses, source.ties);
  if (!s) return null;
  // A team that has played nothing has a record of 0-0, which is true but
  // says nothing; the chip stays silent until there is a game in it.
  if ((source.wins ?? 0) + (source.losses ?? 0) + (source.ties ?? 0) === 0) return null;
  return s;
}

/**
 * THE SPREAD, AS A SENTENCE. "TCU −6.5" — the favoured side named, because a
 * bare signed number on a card with two teams on it is ambiguous to everyone
 * who is not already fluent.
 *
 * spreadHome is signed and home-based, exactly as the market pipeline stores
 * it: negative means the home side is favoured. The favourite is derived from
 * that sign, which is why it is not a fourth wire key.
 */
export function spreadLabel({ spreadHome, homeAbbr, awayAbbr }) {
  const v = Number(spreadHome);
  if (!Number.isFinite(v) || v === 0) return null;
  const fav = v < 0 ? homeAbbr : awayAbbr;
  if (!fav) return null;
  // U+2212 MINUS SIGN, not a hyphen: a hyphen next to a team abbreviation
  // reads as part of the name.
  const mag = Math.abs(v);
  return `${fav} −${Number.isInteger(mag) ? mag : mag.toFixed(1)}`;
}

/**
 * The same sentence, in two pieces, for a box that can run out of room.
 *
 * WHY THIS EXISTS. The board names the favourite with the SAME string its own
 * card shows — the card says "North Dakota State", so the line must too; a
 * card that reads "Virginia" beside a spread that reads "UVA" is two
 * vocabularies on one row and the reader has to do the join. But school names
 * run long, and a 375px eyebrow cannot hold "North Dakota State −6.5" beside a
 * kickoff time.
 *
 * SO THE NAME TRUNCATES AND THE NUMBER NEVER DOES. Returning parts lets the
 * card ellipsis the half that is still recognisable when clipped and pin the
 * half that is worthless when clipped — "North Dako… −6.5" still says who and
 * exactly how much; "North Dakota State −6…" says nothing at all.
 */
export function spreadParts(args) {
  const s = spreadLabel(args);
  if (!s) return null;
  const i = s.lastIndexOf(' ');
  return { fav: s.slice(0, i), mag: s.slice(i + 1) };
}
