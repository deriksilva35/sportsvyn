// lib/fantasy/clubs.js - THE 32 CLUBS, loaded once per process.
//
// EXTRACTED FROM lib/fantasy/drafts.js, unchanged, because two modules now need
// it and the second one cannot import the first. lib/draft/ourBoard.js builds
// the board that drafts.js loads, so an import back the other way would be an
// ES module cycle - and a cycle whose failure mode is a half-initialised
// binding at the top of a file that runs on every room load.
//
// The table is static and every pool load, room load and undo would otherwise
// pay a query for 32 rows that never change. A failed load is not cached, so
// the next call retries.

import { sql } from '../db.js';

let clubsPromise = null;

/** @returns {Promise<Map<string, string>>} teams.abbreviation -> teams.name */
export function nflClubs() {
  clubsPromise ??= sql`SELECT t.abbreviation, t.name FROM teams t
                          JOIN leagues l ON l.id = t.league_id WHERE l.slug = 'nfl'`
    .then((rows) => new Map(rows.map((r) => [r.abbreviation, r.name])))
    .catch((e) => { clubsPromise = null; throw e; });
  return clubsPromise;
}

/** Test seam: forget the cached load. */
export function _resetClubs() { clubsPromise = null; }
