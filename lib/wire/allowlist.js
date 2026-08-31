// lib/wire/allowlist.js — what a club feed item is allowed to SAY on a surface.
//
// *** THE RULE BELOW IS PROPOSED, NOT RULED. Everything is INGESTED and stored;
// this decides only what a reader sees, and relay 2 wires it in. ***
//
// THE KEYWORD ALLOWLIST THE RECON PROPOSED CANNOT WORK, and the census is why.
// Across 8 club feeds and 460 items there are 414 DISTINCT media:keywords, with
// no shared taxonomy: the same idea appears as "News: All News", "News - All
// News" and "All News-archived" on three different clubs, and a large share of
// the vocabulary is author bylines - "Clifton Brown", "Ryan Mink", "Nick
// Eatman". An allowlist over that is 32 allowlists that rot separately.
//
// SO THE FILTER IS ON THE HEADLINE, which every club writes in the same
// language even though they tag it differently. Measured on the same 460
// headlines: 94 pass, 20%.
//   IN   "49ers Sign DL Joyner to One-Year Deal, Place DL Dimukeje on IR"
//        "49ers Announce Trade for LB Deion Jones"
//        "49ers Defeat Raiders 18-12 in Preseason Finale"
//   OUT  "49ers Launch Melbourne Foodie Passport Program"
//        "Christian McCaffrey Steps Into New Role With a Signature Shoe"
//        "More Than a Game: How T.H.I.N.K. Gold Is Building the Next Generation"
//
// IT IS A FILTER, NOT A JUDGEMENT OF QUALITY. A club feed is the club's own PR;
// this keeps the transactional half, which is the half a scoreboard product can
// stand behind, and drops the half that is marketing.

export const CLUB_ALLOW = new RegExp(
  '\\b(roster|sign(s|ed|ing)?|waive[ds]?|release[ds]?|claim(s|ed)?|trade[ds]?'
  + '|activat\\w*|injur\\w*|IR\\b|placed on|elevat\\w*|promot\\w*|cut[s]?\\b'
  + '|final|defeat|beat|win[s]?\\b|loss|practice squad|extension|contract)\\b',
  'i',
);

/** Would a surface render this club item? PURE. */
export function clubAllowed(headline) {
  return CLUB_ALLOW.test(String(headline ?? ''));
}
