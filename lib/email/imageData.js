// lib/email/imageData.js - the PUBLIC data behind the morning email's pictures
// (mon-3). A match by its slug, the opener games of a date: nothing about any
// reader. app/og/email/* and scripts/morning-email.mjs both read through here.

import { sql } from '../db.js';
import { easternLocalToUtc } from '../gridiron/ingest.js';
import { markPath } from './cards.js';
import { ptEt } from './morningSend.js';
import { LEAGUE_LABEL, SEASON_OPENERS } from './morningModules.js';

const team = (league, r, side) => ({
  name: r[`${side}_name`], abbr: r[`${side}_abbr`], c1: r[`${side}_c1`] ?? '#1A1650', c2: r[`${side}_c2`] ?? '#D4FF00',
  path: markPath(league, r[`${side}_abbr`]),
});
const shape = (r) => {
  const [pt, et] = ptEt(r.kickoff_at).split(' / ');
  return { slug: r.slug, leagueSlug: r.league, league: LEAGUE_LABEL[r.league] ?? String(r.league).toUpperCase(), pt, et,
    away: team(r.league, r, 'away'), home: team(r.league, r, 'home'), kickoffAt: r.kickoff_at };
};
// The columns both readers select (written out in each query: neon does not nest tagged queries).

/** One game's chip data by its public slug, or null. */
export async function chipData(slug) {
  if (!/^[a-z0-9-]{3,120}$/.test(String(slug))) return null;
  const [r] = await sql`
    SELECT m.slug, m.kickoff_at, m.status, l.slug AS league,
           h.name AS home_name, h.abbreviation AS home_abbr, h.color_primary AS home_c1, h.color_secondary AS home_c2,
           a.name AS away_name, a.abbreviation AS away_abbr, a.color_primary AS away_c1, a.color_secondary AS away_c2
      FROM matches m JOIN leagues l ON l.id = m.league_id
      JOIN teams h ON h.id = m.home_team_id JOIN teams a ON a.id = m.away_team_id
     WHERE m.slug = ${slug} LIMIT 1`;
  return r ? shape(r) : null;
}

/** The opener hero of an ET date: { league, games } for the first SEASON_OPENERS league opening that day, or null. */
export async function heroData(day) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(day))) return null;
  const start = await easternLocalToUtc(`${day} 00:00:00`);
  const [y, m, d] = day.split('-').map(Number);
  const next = new Date(Date.UTC(y, m - 1, d) + 86_400_000).toISOString().slice(0, 10);
  const end = await easternLocalToUtc(`${next} 00:00:00`);
  for (const cfg of SEASON_OPENERS) {
    const rows = await sql`
      SELECT m.slug, m.kickoff_at, m.status, l.slug AS league,
           h.name AS home_name, h.abbreviation AS home_abbr, h.color_primary AS home_c1, h.color_secondary AS home_c2,
           a.name AS away_name, a.abbreviation AS away_abbr, a.color_primary AS away_c1, a.color_secondary AS away_c2, m.season_year
        FROM matches m JOIN leagues l ON l.id = m.league_id
        JOIN teams h ON h.id = m.home_team_id JOIN teams a ON a.id = m.away_team_id
       WHERE l.slug = ${cfg.league} AND m.stage IS NULL AND m.status <> 'not_needed'
         AND m.kickoff_at >= ${start}::timestamptz AND m.kickoff_at < ${end}::timestamptz
       ORDER BY m.kickoff_at`;
    if (!rows.length) continue;
    const [{ n }] = await sql`
      SELECT count(*)::int n FROM matches m JOIN leagues l ON l.id = m.league_id
       WHERE l.slug = ${cfg.league} AND m.season_year = ${rows[0].season_year} AND m.stage IS NULL AND m.kickoff_at < ${start}::timestamptz`;
    if (n === 0) return { league: cfg.league, eyebrow: `${LEAGUE_LABEL[cfg.league]} OPENING NIGHT`, title: cfg.eyebrow, games: rows.map(shape) };
  }
  return null;
}

/** The empty tiles by key: pickem-<sport>, daily, weekly, or another game's name. */
export const TILE_KINDS = Object.freeze({
  daily: { kind: 'daily', label: 'The Daily' }, weekly: { kind: 'weekly', label: 'The Weekly' },
  'pickem-nfl': { kind: 'pickem', label: "Pick'em NFL" }, 'pickem-cfb': { kind: 'pickem', label: "Pick'em CFB" },
  'pickem-nba': { kind: 'pickem', label: "Pick'em NBA" }, october: { kind: 'other', label: 'October' },
  run: { kind: 'other', label: 'The Run' }, draft: { kind: 'other', label: 'The Draft' },
  'epl-weekly-5': { kind: 'other', label: 'EPL Weekly 5' }, 'draft-game': { kind: 'other', label: 'Primetime Draft' },
});
