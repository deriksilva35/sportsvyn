// lib/live/teamAbbr.js - a team always has something to be called. PURE.
//
// THE DEFECT THIS CLOSES. 105 of 243 CFB teams have no `abbreviation`.
// scoreHeadline() and pushPayload() both guarded on it and returned null,
// so a match involving one of them emitted no Wire event and sent no push -
// with no error, no log line and no row anywhere. Three of the fifteen
// matches on 5 Sep (20665, 20681, 20695) were dead all game and nothing
// said so.
//
// THREE SOURCES, IN ORDER, AND THE ORDER IS THE RULE:
//   1. abbreviation  the provider's own, when we have it
//   2. short_name    a real editorial name, already on the table
//   3. derived       3-4 letters computed from the full name
// Never null. A scoreline reading "SYRA 14" is worth infinitely more than
// a scoreline nobody ever sees.
//
// DERIVATION IS DELIBERATELY DUMB. Initials for a multi-word name
// ("Texas A&M" -> "TAM"), otherwise the first four letters uppercased
// ("Syracuse" -> "SYRA"). It is not trying to guess what ESPN would print;
// it is trying to be recognisable to somebody who already knows which game
// they subscribed to. The CFBD backfill replaces these with real ones -
// this is the floor, not the ambition.

/** Strip anything that is not a letter or digit, for the derived form. */
const alnum = (s) => String(s ?? '').replace(/[^A-Za-z0-9 ]+/g, ' ').trim();

/**
 * @returns {{value: string, source: 'abbreviation'|'short_name'|'derived'}}
 *          or {value: null, source: 'none'} when there is not even a name.
 */
export function resolveAbbr({ abbreviation = null, short_name = null, name = null } = {}) {
  const abbr = String(abbreviation ?? '').trim();
  if (abbr) return { value: abbr, source: 'abbreviation' };

  const short = String(short_name ?? '').trim();
  if (short) return { value: short, source: 'short_name' };

  const clean = alnum(name);
  if (!clean) return { value: null, source: 'none' };

  const words = clean.split(/\s+/).filter(Boolean);
  if (words.length > 1) {
    // Initials, capped at 4 - "Southern Methodist University" -> "SMU".
    const initials = words.map((w) => w[0]).join('').toUpperCase().slice(0, 4);
    if (initials.length >= 2) return { value: initials, source: 'derived' };
  }
  return { value: words[0].slice(0, 4).toUpperCase(), source: 'derived' };
}

/** The value alone, for call sites that do not care where it came from. */
export const abbrOf = (team) => resolveAbbr(team).value;
