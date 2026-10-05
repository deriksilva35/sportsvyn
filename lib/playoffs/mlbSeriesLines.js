// lib/playoffs/mlbSeriesLines.js - the series line for every MLB postseason
// game on a slate, in ONE query (mon-17). The pure wording is seriesLine.js;
// the round names and best-of are lib/mlb/postseason.js's.
//
// SCOPE: the slate's staged MLB games name the seasons and stages; one read
// pulls every staged game of those seasons (a whole October is ~45 rows) and
// the pairing is grouped here by lib/mlb/series.js's key - unordered pair plus
// stage - so a series reads the same whoever is at home.

import { sql } from '../db.js';
import { BEST_OF, roundLabel } from '../mlb/postseason.js';
import { seriesKey } from '../mlb/series.js';
import { seriesLine } from './seriesLine.js';

const abbr = (t) => t?.abbreviation ?? t?.abbr ?? null;

/** PURE: slate games + the season's staged rows -> Map(gameId -> line). */
export function linesFromRows(games = [], rows = []) {
  const by = new Map();
  for (const r of rows) {
    const key = seriesKey(r.stage, r.away_abbr, r.home_abbr);
    if (!key) continue;
    if (!by.has(`${r.season_year}|${key}`)) by.set(`${r.season_year}|${key}`, []);
    by.get(`${r.season_year}|${key}`).push({
      id: r.id, kickoffAt: r.kickoff_at, status: r.status,
      homeAbbr: r.home_abbr, awayAbbr: r.away_abbr, homeScore: r.home_score, awayScore: r.away_score,
    });
  }
  const out = new Map();
  for (const g of games) {
    if (!g || g.leagueSlug !== 'mlb' || !g.stage || !BEST_OF[g.stage]) continue;
    const homeAbbr = abbr(g.home); const awayAbbr = abbr(g.away);
    const key = seriesKey(g.stage, awayAbbr, homeAbbr);
    if (!key) continue;
    const hl = g.home?.conference ?? null; const al = g.away?.conference ?? null;
    const line = seriesLine({
      game: { id: g.id, kickoffAt: g.kickoffAt, status: g.status, homeAbbr, awayAbbr,
        homeScore: g.home?.score ?? g.homeScore ?? null, awayScore: g.away?.score ?? g.awayScore ?? null },
      series: by.get(`${g.seasonYear}|${key}`) ?? [],
      round: roundLabel(g.stage, hl && hl === al ? hl : null),
      bestOf: BEST_OF[g.stage],
    });
    if (line) out.set(g.id, line);
  }
  return out;
}

/** Map(gameId -> series line) for the slate's MLB postseason games. */
export async function mlbSeriesLines(games = [], { db = sql } = {}) {
  const staged = games.filter((g) => g?.leagueSlug === 'mlb' && g.stage && BEST_OF[g.stage]);
  if (!staged.length) return new Map();
  const seasons = [...new Set(staged.map((g) => Number(g.seasonYear)).filter(Number.isFinite))];
  if (!seasons.length) return new Map();
  const rows = await db`
    SELECT m.id, m.stage, m.season_year, m.kickoff_at, m.status, m.home_score, m.away_score,
           h.abbreviation AS home_abbr, a.abbreviation AS away_abbr
      FROM matches m
      JOIN leagues l ON l.id = m.league_id AND l.slug = 'mlb'
      LEFT JOIN teams h ON h.id = m.home_team_id
      LEFT JOIN teams a ON a.id = m.away_team_id
     WHERE m.stage IS NOT NULL
       AND m.season_year = ANY(${seasons}::int[])`;
  return linesFromRows(staged, rows);
}
