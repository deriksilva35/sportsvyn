// lib/mlb/series.js - a SERIES, which is a grouping and not a table.
//
// NO series TABLE, DELIBERATELY. A postseason series is entirely determined by
// the games in it: who is playing, how many each has won, whether it is over
// and who took it are all functions of rows we already hold. A table would be
// a second copy of that, written by a job, able to disagree with the games it
// summarises - and the first time it did, the bracket and the scoreboard would
// be telling a reader two different stories about the same series.
//
// THE KEY IS THE UNORDERED PAIR PLUS THE STAGE. Unordered because a series is
// the same series whoever is at home, and MLB alternates hosts inside one;
// plus the stage because two clubs can and do meet twice in one October (LAD
// played MIL in the 2025 NLCS having played CHC-MIL's winner) and in different
// years. Sorted abbreviations, so the key is stable no matter which row is
// read first and can be written into a Pick'em lineup that must still resolve
// weeks later.
//
// EVERYTHING HERE IS PURE EXCEPT seriesFor(), which is the query that feeds it.

import { sql } from '../db.js';
import { BEST_OF, clinch, STAGE_LABEL } from './postseason.js';

/** The series key: "division:LAD-PHI". Stable, sorted, and safe in a URL. */
export function seriesKey(stage, abbrA, abbrB) {
  const a = String(abbrA ?? '').trim().toUpperCase();
  const b = String(abbrB ?? '').trim().toUpperCase();
  if (!stage || !a || !b) return null;
  return `${stage}:${[a, b].sort().join('-')}`;
}

/**
 * Rows -> series. PURE, and the whole of the module's thinking.
 *
 * @param rows  matches joined to both clubs:
 *   { id, slug, stage, kickoff_at, status, home_score, away_score,
 *     home_team_id, away_team_id, home_abbr, away_abbr, home_name, away_name,
 *     home_league, away_league }
 */
export function shapeSeries(rows = []) {
  const by = new Map();
  for (const r of rows) {
    const key = seriesKey(r.stage, r.away_abbr, r.home_abbr);
    if (!key) continue;
    if (!by.has(key)) by.set(key, []);
    by.get(key).push(r);
  }
  return [...by.entries()]
    .map(([key, games]) => oneSeries(key, games))
    .filter(Boolean)
    // BY INSTANT, NOT BY THE STRING OF A Date. firstDate arrives from Postgres
    // as a Date object and String(Date) is "Tue Oct 14 2025 ..." - which sorts
    // alphabetically and put the LCS above the wild card on the first run.
    .sort((x, y) => (new Date(x.firstDate) - new Date(y.firstDate)) || x.key.localeCompare(y.key));
}

function oneSeries(key, games) {
  games.sort((a, b) => new Date(a.kickoff_at) - new Date(b.kickoff_at) || a.id - b.id);
  const g1 = games[0];
  const stage = g1.stage;
  const bestOf = BEST_OF[stage] ?? null;
  if (!bestOf) return null;

  // GAME 1'S HOST IS THE HIGHER SEED, which is a rule of this competition and
  // saves the bracket a join against team_records just to order two names. It
  // is not a claim about the seed NUMBER - the bracket reads that separately -
  // only about which club to print on top.
  const teams = [
    { id: g1.home_team_id, abbreviation: g1.home_abbr, name: g1.home_name, league: g1.home_league,
      colors: colorsOf(g1.home_c1, g1.home_c2) },
    { id: g1.away_team_id, abbreviation: g1.away_abbr, name: g1.away_name, league: g1.away_league,
      colors: colorsOf(g1.away_c1, g1.away_c2) },
  ];

  const wins = { [teams[0].id]: 0, [teams[1].id]: 0 };
  let played = 0; let anyLive = false;
  for (const g of games) {
    if (g.status === 'live') anyLive = true;
    if (g.status !== 'final') continue;
    played += 1;
    // A FINAL WITH NO SCORE IS NOT A WIN FOR ANYBODY. It happens - a row
    // marked final before the box lands - and Number(null) is 0, which would
    // hand the tie to neither and the game to the count anyway.
    const h = num(g.home_score); const a = num(g.away_score);
    if (h == null || a == null || h === a) continue;
    const winnerId = h > a ? g.home_team_id : g.away_team_id;
    if (winnerId in wins) wins[winnerId] += 1;
  }

  const need = clinch(bestOf);
  const winner = Object.entries(wins).find(([, n]) => n >= need)?.[0] ?? null;
  const status = winner ? 'final' : (anyLive || played > 0) ? 'live' : 'scheduled';

  return {
    key,
    stage,
    label: STAGE_LABEL[stage] ?? stage,
    bestOf,
    clinch: need,
    teams: teams.map((t) => ({ ...t, wins: wins[t.id] ?? 0 })),
    wins,
    // THE RECORD AS A READER SAYS IT: leader first, always - "2-1", never
    // "1-2", and "0-0" before a pitch is thrown.
    record: recordLine(wins, teams),
    games: games.map((g) => ({
      id: g.id, slug: g.slug, kickoffAt: g.kickoff_at, status: g.status,
      homeTeamId: g.home_team_id, awayTeamId: g.away_team_id,
      homeScore: g.home_score, awayScore: g.away_score,
    })),
    gameCount: games.length,
    played,
    // NUMBER OF THE NEXT GAME, for "Game 4 tonight". Null once it is over.
    nextGame: winner ? null : played + 1,
    firstDate: g1.kickoff_at,
    status,
    // THE ID, NOT THE OBJECT. A winner is written into a Pick'em result map
    // and compared against a stored pick; an object would never compare equal.
    winner: winner == null ? null : Number(winner),
  };
}

// THE PAIR OR NOTHING. TeamMark draws a two-tone disc and falls back to an
// ink disc with the abbreviation when either half is missing - a half-coloured
// mark would be a third rendering nobody designed.
const colorsOf = (a, b) => (a && b ? { primary: a, secondary: b } : null);

const num = (v) => (v == null || v === '' ? null : (Number.isFinite(Number(v)) ? Number(v) : null));

function recordLine(wins, teams) {
  const a = wins[teams[0].id] ?? 0; const b = wins[teams[1].id] ?? 0;
  return a >= b ? `${a}-${b}` : `${b}-${a}`;
}

/**
 * The season's series, optionally one stage. `stage` null means the whole
 * bracket, which is what /mlb/bracket asks for.
 *
 * SCOPED BY stage IS NOT NULL, not by season_phase. A postseason row carries
 * both, but the stage is the thing this module groups on and a row without one
 * cannot be placed in a bracket at all - so an unstaged postseason game is
 * ABSENT here rather than silently grouped under an empty round.
 */
export async function seriesFor(stage = null, season = null) {
  const rows = await sql`
    SELECT m.id, m.slug, m.stage, m.kickoff_at, m.status, m.home_score, m.away_score,
           m.home_team_id, m.away_team_id,
           h.abbreviation AS home_abbr, a.abbreviation AS away_abbr,
           COALESCE(h.short_name, h.name) AS home_name,
           COALESCE(a.short_name, a.name) AS away_name,
           h.current_conference AS home_league, a.current_conference AS away_league,
           h.color_primary AS home_c1, h.color_secondary AS home_c2,
           a.color_primary AS away_c1, a.color_secondary AS away_c2
      FROM matches m
      JOIN leagues l ON l.id = m.league_id AND l.slug = 'mlb'
      LEFT JOIN teams h ON h.id = m.home_team_id
      LEFT JOIN teams a ON a.id = m.away_team_id
     WHERE m.stage IS NOT NULL
       AND (${stage}::text IS NULL OR m.stage = ${stage}::text)
       AND (${season}::int IS NULL OR m.season_year = ${season}::int)
     ORDER BY m.kickoff_at ASC, m.id ASC`;
  return shapeSeries(rows);
}
