// lib/fantasy/lineTwo.js — the facts on a board row's second line, in the order
// they are emitted.
//
// Line 2 is one line tall and drops facts whole (numcols.css, "LINE 2 DROPS
// FACTS WHOLE"): a wrapping flex row clipped to a single line, every child a
// nowrap token. The tokens that fit stay; the first one that does not wraps onto
// the clipped line and takes every token after it along. So ORDER is what
// decides which facts a narrow row shows, and the order used to be
//
//     POS·TEAM  window  REC  YDS  TD  gap  slot
//
// which under the MY TEAM sort put the sort's own two facts LAST. Reported from
// draft 443 on a phone: "TE·SF · 57 REC" fit, "TE·ATL · 88 REC" did not, and on
// no row at all did the gap or the slot survive - the sort that promises the two
// facts behind its order showed neither. Under seatSort the read now rides ahead
// of the stats, so the token that drops is a REC count, never the reason the row
// is where it is. Other sorts keep the original order. And the read's tokens are
// as short as they can honestly be - see lineTwoTokens.

/**
 * The tokens of line 2, in emission order. Rooms map `kind` to their own markup;
 * the first token is the POS·TEAM tag (with its ADP window when the pool has
 * one) and is never dropped - it is the row's identity.
 *
 *   tag    - "TE·ATL" or "TE·ATL · 38-61"
 *   gap    - "-29.9"    (seatSort only, when the seat has a next pick)
 *   slot   - "flex", or "wait" when the market says the slot can   (seatSort only)
 *   quick  - one per stat, "88 REC"
 *
 * SHORT ON PURPOSE. The reorder bought the read a tablet, not a phone: the
 * phone row measured ~15ch after the tag (numcols.css clip law; "TE·SF · 57
 * REC" fit and "TE·ATL · 88 REC" did not), and "-29.9 at 50" alone was 11ch
 * in a larger face. So the gap is the number and nothing else - "at 50" is the
 * seat's next pick, the same on every row, and it is said once in the sort
 * header (seatSortHint) - and the slot is the slot: the tag already names the
 * position, and a deferred row says "wait" rather than repeating a slot it is
 * not being offered for.
 */
export function lineTwoTokens({ pos, team = null, range = null, quick = null, seatSort = false, seatRead = null }) {
  const tagText = `${pos}${team ? `·${team}` : ''}${range ? ` · ${range}` : ''}`;
  const out = [{ kind: 'tag', text: tagText }];
  if (seatSort && seatRead) {
    if (seatRead.gap != null) {
      out.push({ kind: 'gap', text: `${seatRead.gap > 0 ? '+' : ''}${seatRead.gap}`, gap: seatRead.gap });
    }
    out.push({
      kind: 'slot',
      text: seatRead.deferred ? 'wait' : seatRead.slot,
      slot: seatRead.slot,
      muted: Boolean(seatRead.deferred || seatRead.streamer),
    });
  }
  for (const q of quick ?? []) out.push({ kind: 'quick', text: q });
  return out;
}

/** The one place the gap's reference pick is said: the sort header, under MY TEAM. */
export function seatSortHint(nextOverall) {
  return `My Team · gap at pick ${nextOverall}`;
}

/**
 * numcols.css's clip law, in code, so a test can say which facts a row of a
 * given width shows. Widths are in characters of the row's own font; `gap` is
 * the column-gap between tokens. The separator each token renders with (" · ")
 * is part of its text for this purpose - the caller passes tokens as rendered.
 *
 * Tokens are taken in order until one does not fit; that one and everything
 * after it are on the clipped second line and are not shown.
 */
export function fitLineTwo(tokens, widthCh, { gap = 0.3, sep = ' · ' } = {}) {
  const shown = [];
  let used = 0;
  for (let i = 0; i < tokens.length; i++) {
    const w = tokens[i].text.length + (i === 0 ? 0 : sep.length + gap);
    if (used + w > widthCh) break;
    used += w;
    shown.push(tokens[i]);
  }
  return shown;
}
