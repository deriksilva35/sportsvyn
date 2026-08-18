// lib/email/broadcastRules.js - the broadcast script's refusal logic, pure.
//
// EXTRACTED SO IT CAN BE TESTED. scripts/broadcast.mjs imports lib/db.js at
// module load, so importing the script under node --test would open a database
// connection to run an assertion about a string. These three decisions are the
// ones with real failure modes - each refusal below maps to a way a broadcast
// goes to the wrong people - so they live where a test can reach them.

/**
 * Which database a connection string points at.
 *
 * 'winter-dawn' is the PROD Neon branch's endpoint slug. Matching on the slug
 * rather than on "not DEV" means an EMPTY or unset DATABASE_URL reads as DEV -
 * the safe direction: the script refuses to live-send at worst, rather than
 * mailing a misread target.
 */
export function databaseFingerprint(url) {
  return String(url || '').includes('winter-dawn') ? 'PROD' : 'DEV';
}

/**
 * A live send must point at PROD.
 *
 * THE FAILURE THIS REFUSES actually happened in a dry run, 18 Aug: the script
 * run without the DATABASE_URL prefix silently targeted DEV and printed
 * RECIPIENTS: 1. As a dry run that was a confusing number; as a --send it
 * would have "sent the broadcast" to one DEV row and reported success, and
 * the real 60 would still be unmailed with the ledger saying otherwise.
 */
export function assertLiveTarget(fingerprint) {
  if (fingerprint !== 'PROD') {
    throw new Error(
      'refusing --send against ' + fingerprint + ': a live send must run with '
      + 'DATABASE_URL="$PROD_DATABASE_URL". A DEV send would mail test rows and '
      + 'write a ledger that says the broadcast went out.',
    );
  }
}

/**
 * --to may only name an owner address.
 *
 * The override ignores the roster, the suppression WHERE clause and the count
 * confirmation - every safety the roster path has. An arbitrary address here
 * would be a side door for mailing any user unthrottled and unlogged-as-
 * broadcast, so the allowlist is the owner exclusion list: the six addresses
 * that are already, by definition, not users.
 */
export function validateTestRecipient(address, ownerAddresses) {
  const a = String(address || '').trim().toLowerCase();
  if (!a) throw new Error('--to requires an address');
  const owners = ownerAddresses.map((o) => o.toLowerCase());
  if (!owners.includes(a)) {
    throw new Error(
      `--to ${address} refused: test sends may only target the owner list. `
      + 'Mailing a user goes through the roster, its suppression clause and '
      + 'the typed count - never through this override.',
    );
  }
  return a;
}
