// lib/eplWeekly5/lobbyRow.js - EPL Weekly 5's row on /games (lib/games/lobbyV3.js),
// in the house's one-line row grammar. The round is "GW N" here (thu-36).

import { sql } from '../db.js';
import { HOUSE_TZ } from '../gridiron/kickoff.js';
import { GAME_KEY, GAME_NAME, SLOTS, roundShort } from './rules.js';

const PT_TIME = new Intl.DateTimeFormat('en-US', { timeZone: HOUSE_TZ, hour: 'numeric', minute: '2-digit' });
const PT_DOW = new Intl.DateTimeFormat('en-US', { timeZone: HOUSE_TZ, weekday: 'short' });

/**
 * PURE. @param c the gameweek (or null); @param s { filled, score, nextKickoff,
 *   kicked } - what the reader and the fixtures say right now.
 */
export function eplWeekly5Row(c, s = {}, now = new Date()) {
  const base = { key: GAME_KEY, mark: '5', name: GAME_NAME, href: '/epl-weekly-5' };
  if (!c) return { ...base, line: 'Opens with the next gameweek', tone: 'muted' };
  const gw = roundShort(c.week);
  if (c.settled) {
    return { ...base, line: `${gw} · final${s.filled ? '' : ' · no card'}`, right: s.score != null ? String(s.score) : null, rightLabel: s.score != null ? 'pts' : null, tone: 'done' };
  }
  const next = s.nextKickoff ? new Date(s.nextKickoff) : null;
  const ahead = next && next.getTime() > new Date(now).getTime();
  if (!s.kicked) {
    return {
      ...base,
      // THE FIRST LOCK RIDES ON THE RIGHT, day and time, so the line stays one
      // line at 390px.
      line: `${gw} · ${s.filled ? `${s.filled} of 5 picked` : 'picks open'}`,
      right: null, rightLabel: ahead ? `${PT_DOW.format(next)} ${PT_TIME.format(next)} PT` : null, tone: 'live',
    };
  }
  return {
    ...base,
    line: `${gw} · in play${ahead ? ` · next lock ${PT_TIME.format(next)} PT ${PT_DOW.format(next)}` : ''}`,
    right: s.filled ? `${s.filled}/5` : null, rightLabel: null, tone: 'live',
  };
}

/** The reads behind the row. Cheap: one contest, one entry, the board's times. */
export async function eplWeekly5RowFor(uid, now = new Date()) {
  const { currentGameweek } = await import('./create.js');
  const c = await currentGameweek({ now });
  if (!c) return eplWeekly5Row(null);
  const ids = (c.board ?? []).map((g) => g.match_id);
  const [fx, entry] = await Promise.all([
    ids.length ? sql`SELECT kickoff_at, status FROM matches WHERE id = ANY(${ids})` : [],
    uid == null ? [] : sql`SELECT lineup, score FROM contest_entries WHERE contest_id = ${c.id} AND user_id = ${Number(uid)}`,
  ]);
  const t = new Date(now).getTime();
  const on = fx.filter((m) => !['postponed', 'cancelled', 'not_needed'].includes(m.status));
  const ahead = on.map((m) => new Date(m.kickoff_at).getTime()).filter((x) => x > t).sort((a, b) => a - b);
  const e = entry[0];
  return eplWeekly5Row(c, {
    filled: e ? SLOTS.filter((s) => e.lineup?.[s]?.playerId).length : 0,
    score: e?.score == null ? null : Number(e.score),
    nextKickoff: ahead.length ? new Date(ahead[0]).toISOString() : null,
    kicked: on.some((m) => new Date(m.kickoff_at).getTime() <= t),
  }, now);
}
