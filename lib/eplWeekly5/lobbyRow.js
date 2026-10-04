// lib/eplWeekly5/lobbyRow.js - the state behind EPL Weekly 5's item on /games
// (lib/games/playRegistry.js). The string row that baked "Sat 4:30 AM PT" into
// its words was unused and is gone (sun-16 item B): the lobby renders the
// instant in the reader's zone.

import { sql } from '../db.js';
import { SLOTS, effectiveFixtures, isOffStatus } from './rules.js';

/**
 * The reads behind the row - and behind the Play lobby's EPL Weekly 5 item
 * (lib/games/playRegistry.js), which takes this STATE rather than the row's
 * words, so its next kickoff renders in the page's zone. Cheap: one contest,
 * one entry, the board's times. Null when no gameweek has opened.
 */
export async function eplWeekly5StateFor(uid, now = new Date()) {
  const { currentGameweek } = await import('./create.js');
  const c = await currentGameweek({ now });
  if (!c) return null;
  const ids = (c.board ?? []).map((g) => g.match_id);
  const [fx, entry] = await Promise.all([
    ids.length ? sql`SELECT id, kickoff_at, status FROM matches WHERE id = ANY(${ids})` : [],
    uid == null ? [] : sql`SELECT lineup, score FROM contest_entries WHERE contest_id = ${c.id} AND user_id = ${Number(uid)}`,
  ]);
  const t = new Date(now).getTime();
  // As the gameweek sees them: a fixture re-dated out of it ('moved', sat-5 E1) is off, like a postponement.
  const eff = [...effectiveFixtures(c.board ?? [], new Map(fx.map((m) => [String(m.id), m]))).values()];
  const on = eff.filter((m) => !isOffStatus(m.status));
  const ahead = on.map((m) => new Date(m.kickoff_at).getTime()).filter((x) => x > t).sort((a, b) => a - b);
  const e = entry[0];
  return {
    contest: c,
    filled: e ? SLOTS.filter((s) => e.lineup?.[s]?.playerId).length : 0,
    size: SLOTS.length,
    score: e?.score == null ? null : Number(e.score),
    nextKickoff: ahead.length ? new Date(ahead[0]).toISOString() : null,
    kicked: on.some((m) => new Date(m.kickoff_at).getTime() <= t),
  };
}
