// lib/gridiron/playText.js - display-only cleanup of a CFB play sentence
// (relay thu-2). PURE. The stored plays.text is never touched; every place
// the college game page prints a play (the drive chart rows, the plays list,
// "All plays", the scoring plays, the last-play line) goes through this one
// function.
//
// WHAT CFBD SENDS, read from 20,000 real PROD rows (150 final games):
//   "(04:51) Shotgun #24 B.MacCormack III rush middle for 3 yards gain to the GT 31 (#27 T.Harris)"
// and what the row already shows without help from the sentence:
//   - the "(MM:SS)" clock             -> the row has its own clock column
//   - the formation prefix            -> three occur: "No Huddle-Shotgun"
//                                        (~7.7k), "Shotgun" (~6.5k) and
//                                        "No Huddle" (~260). Pistol, Under
//                                        Center and Wildcat do not occur, so
//                                        they are not listed (a list of
//                                        guesses is a list of bugs).
//   - jersey numbers before names     -> "#27 J.Silver" -> "J.Silver",
//                                        everywhere in the string (tacklers in
//                                        parentheses, "forced by #5 D.Herard",
//                                        "to #19 R.Jones").
// Everything else is verbatim. A "#" not followed by a jersey number and then
// a name is left alone.
//
// NFL: nflPlayText() below (drive-4). NFL plays arrive as ESPN-style sentences
// ("(Shotgun) C.Keenum pass ...") with no jersey numbers, so the CFB shape does
// not exist there; they have their own prefixes and their own team codes.

const CLOCK = /^\(\d{1,2}:\d{2}\)\s*/;
// Longest first, so "No Huddle-Shotgun" is not eaten as "No Huddle" + "-Shotgun".
const FORMATION = /^(?:No Huddle-Shotgun|No Huddle|Shotgun)\s+/;
// "#27 " directly before a capitalised name.
const JERSEY = /(^|[^\w])#\d{1,2}\s+(?=[A-Z])/g;

export function cfbPlayText(text) {
  if (text == null) return text;
  let t = String(text).replace(CLOCK, '');
  t = t.replace(FORMATION, '');
  t = t.replace(JERSEY, '$1');
  return t.replace(/ {2,}/g, ' ').trim();
}

// ---------------------------------------------------------------- NFL (drive-4)
//
// WHAT BDL SENDS, read from the 27,000 NFL plays of 2026 on PROD (read-only):
//   leading "(Shotgun)" 9,982, "(No Huddle, Shotgun)" 980, "(No Huddle)" 224,
//   "(Punt formation)" 39, "(Run formation)" 33, "(Field Goal formation)" 7 -
//   the formation is a prefix the field strip already makes plain;
//   a leading "(2:46)" / "(:10)" clock on a few rows - the card has its own clock;
//   NO jersey numbers ("Timeout #1 by KC" is a timeout count, and is kept).
//
// TEAM CODES. The text uses ESPN-style codes for six clubs, not ours. Measured by
// counting the code that follows "to", "at", "from", "on", "PENALTY on" and
// "<code>-<initial>." across the season; ours in the right column:
const NFL_TEXT_CODES = Object.freeze({
  BLT: 'BAL', CLV: 'CLE', ARZ: 'ARI', HST: 'HOU', LA: 'LAR', WAS: 'WSH',
});
// Every other club's code in the text is already ours (ATL BUF CAR CHI CIN DAL DEN DET
// GB IND JAX KC LAC LV MIA MIN NE NO NYG NYJ PHI PIT SEA SF TB TEN). A code counts only
// where a spot or a penalty names it: after a non-letter, before " 35" / " -1" / "-X." /
// "," / ".", so a word that happens to read "LA" is never rewritten.
const CODE = new RegExp(`(^|[^A-Za-z.'#])(${Object.keys(NFL_TEXT_CODES).join('|')})(?=\\s-?\\d|-[A-Z]|[,.;)]|\\s*$)`, 'g');
const NFL_CLOCK = /^\s*\(\d{0,2}:\d{2}\)\s*/;
const NFL_FORMATION = /^\s*\((?:No Huddle, Shotgun|No Huddle|Shotgun|Punt formation|Run formation|Field Goal formation)\)\s*/;

export function nflPlayText(text) {
  if (text == null) return text;
  let t = String(text);
  // Either order occurs ("(12:32) (Shotgun) ..."); twice covers both.
  for (let i = 0; i < 2; i++) t = t.replace(NFL_CLOCK, '').replace(NFL_FORMATION, '');
  t = t.replace(CODE, (_, pre, code) => `${pre}${NFL_TEXT_CODES[code]}`);
  return t.replace(/ {2,}/g, ' ').trim();
}

/** The one door: CFB and NFL sentences each get their own cleanup; any other league is untouched. */
export function footballPlayText(league, text) {
  if (league === 'cfb') return cfbPlayText(text);
  if (league === 'nfl') return nflPlayText(text);
  return text;
}
