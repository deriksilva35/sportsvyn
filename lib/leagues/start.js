// lib/leagues/start.js - the two anchors a new league can start on, READ from
// the schedule, never typed. The choice between them is pure
// (chooseStart in lib/leagues/settings.js); this only loads them.
//
//   nfl  the next NFL regular-season week whose FIRST kickoff is still ahead.
//        Not lib/weekly/create.js nextNflRegWeek(): that is the week of the
//        next KICKOFF, which mid-week is a week already under way - a league
//        made on a Saturday must not start on a week whose Thursday is played.
//   day  tomorrow's ET date and its midnight. Today's Daily may be half played
//        by the time a league is made; tomorrow is the first whole day.
//
// ET-local -> UTC goes through easternLocalToUtc, the one sanctioned helper.

import { sql } from '../db.js';
import { easternLocalToUtc } from '../gridiron/ingest.js';

export function etDateOf(now = new Date()) {
  const p = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(now).reduce((a, x) => (a[x.type] = x.value, a), {});
  return `${p.year}-${p.month}-${p.day}`;
}

export function nextDay(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d) + 86_400_000).toISOString().slice(0, 10);
}

export async function loadStartAnchors(now = new Date()) {
  const at = new Date(now).toISOString();
  const [wk] = await sql`
    SELECT m.season_year, m.week, min(m.kickoff_at) AS ko
      FROM matches m JOIN leagues l ON l.id = m.league_id
     WHERE l.slug = 'nfl' AND m.season_phase = 'REG'
     GROUP BY m.season_year, m.week
    HAVING min(m.kickoff_at) >= ${at}
     ORDER BY min(m.kickoff_at) ASC LIMIT 1`;
  const date = nextDay(etDateOf(now));
  const midnight = await easternLocalToUtc(`${date} 00:00:00`);
  return {
    nfl: wk ? { season: wk.season_year, week: wk.week, at: new Date(wk.ko).toISOString() } : null,
    day: midnight ? { date, at: midnight } : null,
  };
}
