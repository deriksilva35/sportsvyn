// lib/gridiron/leagueWeek.js — where a league is in its season, for the header.
//
// THE EYEBROW IS A FACT ABOUT THE LEAGUE, NOT ABOUT THE PAGE. It said "Week 1 ·
// Sat Aug 29" on the landing and nothing at all on /nfl/scores, because the
// landing happened to have already resolved the week for its own reads and the
// sub-routes had not. Resolving it here means every league route gets the same
// line without each one remembering to pass it, and there is one answer rather
// than one per surface.

import { getCurrentWeek, getNearestUpcomingWeek, getWeekSlate } from './readers.js';
import { resolveSeasonYear } from '../pollers/seasonResolver.js';

/**
 * @returns {{ season, week, phase, date }} - `date` is the first kickoff of the
 * resolved week, which is what the eyebrow names. Every field may be null: a
 * failed derivation renders the shorter line rather than a wrong one, per the
 * REG-only landmark law in landingEyebrow().
 */
export async function resolveLeagueWeek(leagueSlug, { now = new Date() } = {}) {
  const season = resolveSeasonYear(now);
  try {
    // The nearest UPCOMING week, so the offseason points at the opener rather
    // than at last season's final slate; the latest started week otherwise.
    const upcoming = await getNearestUpcomingWeek(leagueSlug, season);
    const cur = upcoming ?? (await getCurrentWeek(leagueSlug, season));
    const phase = cur?.seasonPhase ?? 'REG';
    const week = cur?.week ?? null;
    if (week == null) return { season, week: null, phase, date: null };
    const slate = await getWeekSlate(leagueSlug, season, phase, week).catch(() => null);
    const first = slate?.byDay?.[0]?.games?.[0]?.kickoffAt ?? upcoming?.kickoffAt ?? null;
    return { season, week, phase, date: first };
  } catch {
    return { season, week: null, phase: null, date: null };
  }
}

/**
 * THE SOCCER ROW'S EYEBROW. "EPL · Matchweek 3".
 *
 * NOT resolveLeagueWeek: that reads the gridiron week tables and a matchweek is
 * a different object with a different name. The nearest scheduled matchweek is
 * the one a supporter means by "next", and a league mid-round shows the round
 * it is in rather than the one after it.
 */
export async function resolveEplWeek({ now = new Date() } = {}) {
  const { sql } = await import('../db.js');
  try {
    const [live] = await sql`
      SELECT m.week FROM matches m JOIN leagues l ON l.id = m.league_id
       WHERE l.slug = 'epl' AND m.status = 'live' ORDER BY m.kickoff_at LIMIT 1`;
    if (live?.week != null) return { week: live.week, label: `EPL · Matchweek ${live.week}` };
    const [next] = await sql`
      SELECT m.week FROM matches m JOIN leagues l ON l.id = m.league_id
       WHERE l.slug = 'epl' AND m.status = 'scheduled'
         AND m.kickoff_at > ${new Date(now).toISOString()}
       ORDER BY m.kickoff_at LIMIT 1`;
    if (next?.week != null) return { week: next.week, label: `EPL · Matchweek ${next.week}` };
  } catch { /* the sheet still opens without an eyebrow */ }
  return { week: null, label: 'EPL' };
}
