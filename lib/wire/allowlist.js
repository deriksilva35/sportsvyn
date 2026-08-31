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
  // `promot\\w*` matched "promotions" - a gameday giveaways-and-promotions
  // release read as a roster promotion. Same trap on activat*/elevat*. The
  // transactional verbs are spelled out rather than stemmed.
  + '|activated|injur\\w*|IR\\b|placed on|elevated|promoted|cut[s]?\\b'
  + '|final|defeat|beat|win[s]?\\b|loss|practice squad|extension|contract)\\b',
  'i',
);

/**
 * AND A SECOND PASS, FOR RECURRING COLUMNS.
 *
 * The allowlist alone is not enough, and the numbers say so: of 400 stored club
 * items 87 pass it, and 8 of those 87 are the club's regular column wearing a
 * transactional word. "Mailbag: Any surprises with final cuts?" matches on
 * `final` AND `cuts`; "Late for Work: Pundits React to Ravens' Roster Cuts"
 * matches on `roster` and `cuts`. They are about the news rather than being the
 * news - a mailbag is readers' questions, and "5 takeaways" is an opinion
 * piece.
 *
 * THIS IS A JUDGEMENT ABOUT FORMAT, NOT ABOUT QUALITY. It names the recurring
 * strands clubs publish under a standing title. It is deliberately a short,
 * literal list rather than a cleverness: every entry is a masthead somebody can
 * check, and a club that invents a new column will pass until it is added,
 * which is the failure direction that costs nothing.
 */
export const CLUB_DENY = new RegExp(
  '(^|\\b)(mailbag|inbox|morning report|morning break|late for work'
  + '|daily:|\\d+ thoughts|thoughts on|giveaways|promotions'
  + '|things to know|takeaways|what you need to know|film room|notebook'
  + '|press conference|transcript|quotes?:|photos?:|watch:|listen:)\\b',
  'i',
);

/**
 * Would a surface render this club item? PURE.
 *
 * NON-ENGLISH ITEMS FALL OUT HERE TOO, and it is measured rather than assumed:
 * of 400 stored club items, ZERO German or Spanish headlines pass the English
 * allowlist. Several clubs publish those editions on the same feed - Seattle
 * put one on the wire's first live tick - and we are choosing not to carry them
 * until there is a locale to serve, rather than mixing languages unlabelled.
 */
export function clubAllowed(headline) {
  const h = String(headline ?? '');
  if (CLUB_DENY.test(h)) return false;
  return CLUB_ALLOW.test(h);
}
