// lib/survivor/lobbyRow.js - Survivor's row on /games, in the v3 row shape
// ({ key, mark, name, href, line, right, rightLabel, tone }) every game row
// there uses (lib/games/v3Rows.js). The row says where the READER stands, in
// one line: no pick, their pick and when it locks, locked in, or out.

import { HOUSE_TZ } from '../gridiron/kickoff.js';

const PT_TIME = new Intl.DateTimeFormat('en-US', { timeZone: HOUSE_TZ, hour: 'numeric', minute: '2-digit' });
const PT_DOW = new Intl.DateTimeFormat('en-US', { timeZone: HOUSE_TZ, weekday: 'short' });

/**
 * PURE.
 * @param week     the open week, or null (season over / not open)
 * @param entry    the reader's entry, or null
 * @param pick     the reader's pick for the open week, or null
 * @param entriesOpen  can a reader with no entry still join
 */
export function survivorRowV3({ week = null, entry = null, pick = null, entriesOpen = true, cutoffWeek = null, now = new Date() } = {}) {
  const base = { key: 'survivor', mark: 'S', name: 'Survivor', href: '/survivor' };
  if (week == null) return { ...base, line: 'Opens with its first week', tone: 'muted' };
  if (entry && entry.eliminated_week != null) {
    return { ...base, line: `Out in week ${entry.eliminated_week}`, right: 'OUT', tone: 'done' };
  }
  if (!entry && !entriesOpen) {
    return { ...base, line: cutoffWeek != null ? `Entries closed at week ${cutoffWeek} kickoff` : 'Entries closed', tone: 'muted' };
  }
  if (pick && pick.team_id != null) {
    const ko = pick.kickoff_at ? new Date(pick.kickoff_at) : null;
    const kicked = ko != null && ko.getTime() <= new Date(now).getTime();
    return {
      ...base,
      line: kicked
        ? `${pick.abbr} locked in`
        : `${pick.abbr} · locks ${PT_DOW.format(ko)} ${PT_TIME.format(ko)} PT`,
      right: pick.abbr, rightLabel: `WK ${week}`,
      tone: kicked ? 'live' : null,
    };
  }
  return { ...base, line: 'One team a week · no pick yet', rightLabel: `WK ${week}`, tone: null };
}

/** The row for a reader, from the database. Null when Survivor has no pool (118 unapplied). */
export async function survivorRowFor(uid, now = new Date()) {
  const { currentNationalPool, poolWeek, entryWithPicks } = await import('./read.js');
  const { entriesOpen, entryCutoff } = await import('./rules.js');
  const pool = await currentNationalPool();
  if (!pool) return null;
  const { week, weeks } = await poolWeek(pool, now);
  const mine = uid == null ? { entry: null, picks: [] } : await entryWithPicks(pool.id, uid);
  return survivorRowV3({
    week, entry: mine.entry, pick: mine.picks.find((p) => p.week === week) ?? null,
    entriesOpen: uid == null ? true : entriesOpen(pool, entryCutoff(pool, weeks), now),
    cutoffWeek: pool.entry_until_week ?? null, now,
  });
}
