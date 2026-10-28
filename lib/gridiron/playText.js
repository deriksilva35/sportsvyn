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
// NFL: not applied. NFL plays arrive as ESPN-style sentences ("(Shotgun)
// C.Keenum pass ...") already handled by lib/gridiron/scoringSummary.js, with
// no jersey numbers, so the CFB shape does not exist there.

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
