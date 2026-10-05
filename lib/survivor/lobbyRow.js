// lib/survivor/lobbyRow.js - Survivor's row on /games, in the v3 row shape
// ({ key, mark, name, href, line, right, rightLabel, tone }) every game row
// there uses (lib/games/v3Rows.js). The row says where the READER stands, in
// one line: no pick, their pick and when it locks, locked in, or out.

// THE LOCK IS AN INSTANT, NOT WORDS (sun-16 item B). The row used to bake
// "locks Sun 10:00 AM PT" into its line on the server - Pacific for everyone,
// on a lobby whose header names the reader's zone. It now hands the lobby the
// instant (`at`), and components/games/LobbyV3's PlayWhen renders it in the
// zone the rest of the screen is in.

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
      line: kicked ? `${pick.abbr} locked in` : pick.abbr,
      at: kicked || !ko ? null : { iso: ko.toISOString(), words: 'locks' },
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
