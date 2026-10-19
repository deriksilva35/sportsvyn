// lib/email/owners.js - the owner's own addresses: excluded from every audience
// (the broadcast, the morning email). Moved from scripts/broadcast.mjs (sun-2).
//
// THE OWNER'S OWN ACCOUNTS. Five addresses that are Derik testing the product,
// not users. Listed explicitly rather than pattern-matched on 'derik' because a
// real user called Derik would otherwise be silently dropped.
export const OWNER_ADDRESSES = Object.freeze([
  'deriksilva@gmail.com',
  'derik@safetymanagers.com',
  'derik@sportsvyn.com',
  'deriksilva+welcome@gmail.com',
  'deriksilva+welcome2@gmail.com',
  // Sixth, added 18 Aug: signed up through the app the morning of the send and
  // would otherwise have been mailed. THE LIST IS THE WEAKNESS OF THIS DESIGN -
  // a new owner address is invisible until somebody reads the dry-run roster,
  // which is the argument for reading it every time rather than trusting the
  // count.
  'deriksilva@compsysllc.com',
  // Seventh, 19 Aug: the recreated Skry-identity account (user 74, Derik's
  // push device #1). Found the same way as the sixth - by a list somewhere
  // refusing it - which is the dry-run-roster argument restated.
  'derik@theskry.com',
]);
