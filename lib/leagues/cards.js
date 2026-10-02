// lib/leagues/cards.js - ONE reader for "your leagues" as cards: /leagues
// (canvas board Main) and the Play lobby's "Your leagues" section both render
// it, so the two cannot disagree about a league's games, its state or your
// place in it.
//
// card: { id, name, href, chips: [..], meta: '9 members · live', corner:
//         'You 3rd' | 'Chopped' | "You're in · 5 left" | null, live, mine }
// The corner is null until the table has a final period - the surface then
// says whose league it is.

import { myLeagues, leagueDetail } from './core.js';
import { leagueTable } from './table.js';
import { ordinal } from './standings.js';
import { leagueChips } from './settings.js';
import { cardMeta, hasStarted } from './describe.js';
import { leagueHref } from './nav.js';

/** Pure: the corner from a derived table. */
export function cornerFor(table, uid) {
  if (!table) return null;
  if (table.guillotine) {
    if (table.guillotine.chopped.some((c) => c.userId === uid)) return 'Chopped';
    return table.guillotine.chopped.length ? `You're in · ${table.guillotine.standing.length} left` : null;
  }
  const me = table.standings.buckets.length ? table.standings.rows.find((r) => r.userId === uid) : null;
  return me ? `You ${ordinal(me.place)}` : null;
}

export async function myLeagueCards(uid, { now = new Date() } = {}) {
  if (uid == null) return [];
  const leagues = await myLeagues(uid);
  return Promise.all(leagues.map(async (lg) => {
    const detail = await leagueDetail(lg.id, uid).catch(() => null);
    const table = detail ? await leagueTable(detail, { now }).catch(() => null) : null;
    return {
      id: lg.id, name: lg.name, href: leagueHref(lg.id), mine: !!lg.mine,
      chips: leagueChips(lg), meta: cardMeta(lg, now), live: hasStarted(lg, now),
      corner: cornerFor(table, Number(uid)),
    };
  }));
}
