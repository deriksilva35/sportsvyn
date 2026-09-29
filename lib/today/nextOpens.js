// lib/today/nextOpens.js - when the next Weekly / Draft board opens (tue-3), for
// the front page's card when no board is open yet: "Opens <date>" from the
// contest row itself, never a typed date.
import { sql } from '../db.js';

/** The earliest opens_at still ahead for a game type, or null. */
export async function nextOpensAt(gameType, { sport = 'nfl', now = new Date() } = {}) {
  const [r] = await sql`
    SELECT opens_at FROM contests
     WHERE game_type = ${gameType} AND sport = ${sport} AND opens_at > ${now.toISOString()}
     ORDER BY opens_at ASC LIMIT 1`;
  return r?.opens_at ?? null;
}
