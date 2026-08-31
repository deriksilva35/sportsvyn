// lib/wire/polls.js — the poll moved.
//
// EMITS NOTHING UNTIL THERE IS A SECOND WEEK, and that is the correct output
// rather than a gap. ap_rankings holds exactly one week today (2026 W1), so the
// self-join finds no prior and produces zero rows. The first real output is AP
// week 2. Tested with a synthetic prior week, because waiting for the calendar
// is not a test.
//
// THE NFL ARM READS previous_rank OFF THE ENTRY, which the edition machinery
// already stores - no join at all, because whoever published the edition
// recorded where each club came from.

import { sql } from '../db.js';
import { wireKey } from './hash.js';

/** "Texas to No. 3 from No. 5" / "Texas enters at No. 22". PURE. */
export function pollHeadline(r) {
  const who = r.abbreviation ?? r.name;
  if (!who || r.rank == null) return null;
  if (r.previous_rank == null) return `${who} enters at No. ${r.rank}`;
  if (Number(r.previous_rank) === Number(r.rank)) return null;   // held: not news
  return `${who} to No. ${r.rank} from No. ${r.previous_rank}`;
}

export function toRows(rows, { pollName, season, week, leagueSlug }) {
  // A FIRST EDITION IS NOT THIRTY-TWO ARRIVALS. When no row carries a previous
  // rank the poll has simply never run before, and "SEA enters at No. 2" x32 is
  // the list existing rather than anything moving. Same rule as movement being
  // absent on week 1 - and it is the whole poll that is new, not the teams.
  const anyPrior = (rows ?? []).some((r) => r.previous_rank != null);
  if (!anyPrior) return [];
  const out = [];
  for (const r of rows ?? []) {
    const headline = pollHeadline(r);
    if (!headline) continue;
    out.push({
      league_id: r.league_id ?? null,
      team_ids: [r.team_id].filter(Boolean),
      lane: 'poll',
      headline: `${headline} · ${pollName}`,
      url: `/${leagueSlug}/rankings`,
      source: 'Sportsvyn',
      published_at: null,
      // ONE PER TEAM PER POLL PER WEEK. A poll is published once a week, so the
      // week IS the bucket - no clock involved.
      dedupe_hash: wireKey('poll', leagueSlug, pollName, season, week, r.team_id),
      payload: { rank: r.rank, previousRank: r.previous_rank ?? null, week, season },
    });
  }
  return out;
}

export async function apMovement({ season, week } = {}) {
  if (!season || !week || week < 2) return [];
  const rows = await sql`
    SELECT ap.team_id, ap.rank, prev.rank AS previous_rank,
           t.abbreviation, t.name, t.league_id
      FROM ap_rankings ap
      JOIN teams t ON t.id = ap.team_id
      LEFT JOIN ap_rankings prev
             ON prev.team_id = ap.team_id AND prev.season = ap.season
            AND prev.season_type = ap.season_type AND prev.week = ${week} - 1
     WHERE ap.season = ${season} AND ap.week = ${week} AND ap.season_type = 'regular'`;
  return toRows(rows, { pollName: 'AP Top 25', season, week, leagueSlug: 'cfb' });
}

export async function powerMovement({ season } = {}) {
  const rows = await sql`
    SELECT e.team_id, e.rank, e.previous_rank, ed.edition_number,
           t.abbreviation, t.name, t.league_id
      FROM ranking_entries e
      JOIN ranking_editions ed ON ed.id = e.ranking_edition_id
                              AND ed.is_current AND ed.status = 'published'
      JOIN ranking_lists rl ON rl.id = ed.ranking_list_id
      LEFT JOIN teams t ON t.id = e.team_id
     WHERE rl.slug = 'nfl-power'`;
  const edition = rows[0]?.edition_number ?? 0;
  return toRows(rows, {
    pollName: 'Sportsvyn Power Rankings', season, week: edition, leagueSlug: 'nfl',
  });
}
