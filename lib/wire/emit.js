// lib/wire/emit.js — writing to the wire.
//
// ONE INSERT, IDEMPOTENT BY CONSTRUCTION. Every emitter produces rows and hands
// them here; the UNIQUE index on dedupe_hash makes a re-run a no-op. Nothing
// checks first and inserts second - that pattern races itself the moment two
// ticks overlap, and the constraint is the only thing that cannot.

import { sql } from '../db.js';

/**
 * @returns {number} how many rows were NEW. A second run of the same tick
 * returns 0, which is the property the dry-run proves.
 */
export async function emit(rows, { chunk = 250 } = {}) {
  const clean = (rows ?? []).filter((r) => r?.dedupe_hash && r?.headline);
  if (!clean.length) return 0;

  // BATCHED, AND THE FIRST DRY RUN IS WHY. Row-by-row this took 150 seconds a
  // pass - 1,819 club rows at one network round trip each - against a cron
  // whose maxDuration is 60. The work was never the fetching; it was 2,000
  // sequential inserts. One statement per 250 rows turns that into single
  // digits, and ON CONFLICT still does the deduping.
  let written = 0;
  for (let i = 0; i < clean.length; i += chunk) {
    const part = clean.slice(i, i + chunk);
    const res = await sql.query(
      `INSERT INTO news_items
         (league_id, team_ids, lane, headline, url, source, published_at, dedupe_hash, payload)
       -- team_ids ARRIVES AS AN ARRAY LITERAL, NOT A NESTED ARRAY. unnest()
       -- flattens integer[][] into a single column, so a per-row array has to
       -- travel as text and be cast back on the way in.
       SELECT lg, ti::integer[], ln, hl, u, sc, pa, dh, pl
         FROM unnest(
           $1::integer[], $2::text[], $3::text[], $4::text[], $5::text[],
           $6::text[], $7::timestamptz[], $8::text[], $9::jsonb[])
         AS t(lg, ti, ln, hl, u, sc, pa, dh, pl)
       ON CONFLICT (dedupe_hash) DO NOTHING
       RETURNING id`,
      [
        part.map((r) => r.league_id ?? null),
        part.map((r) => `{${(r.team_ids ?? []).filter((x) => x != null).join(',')}}`),
        part.map((r) => r.lane),
        part.map((r) => r.headline),
        part.map((r) => r.url ?? null),
        part.map((r) => r.source),
        part.map((r) => r.published_at ?? null),
        part.map((r) => r.dedupe_hash),
        part.map((r) => JSON.stringify(r.payload ?? {})),
      ],
    );
    written += res.length;
  }
  return written;
}

/**
 * RETENTION. Thirty days, swept in the same cron that writes.
 *
 * A WIRE IS NOT AN ARCHIVE. Nothing here is the record of anything - the
 * matches, odds and standings tables are - so an unbounded news_items would be
 * a growing pile of restatements. Thirty days is long enough for a team page's
 * "recent" and short enough that a stale headline cannot resurface.
 */
export async function sweep({ days = 30 } = {}) {
  const r = await sql`
    DELETE FROM news_items
     WHERE seen_at < now() - (${days} || ' days')::interval
     RETURNING id`;
  return r.length;
}
