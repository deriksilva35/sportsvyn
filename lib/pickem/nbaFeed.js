// lib/pickem/nbaFeed.js - the NBA board's records and moneylines (wed-1). PURE
// shaping plus two thin reads through the NBA game page's own feed module.
//
// WHY THE FEED. The NBA has no odds_markets rows (the Odds API ingest runs the
// football leagues and MLB) and no team_records rows, so the football path
// (getH2hOdds, recordMapFor) answers nothing for it. The NBA GAME PAGE gets both
// from the secondary feed (lib/nba/pageFeed.js: /v2/odds, /nba/v1/standings) and
// the board reads the very same two functions, so a board never disagrees with
// the page it links to. Both are page-cached (10 min / 1 h) and every failure
// is swallowed by the caller: absent is the default.

import { standingRecord } from '../nba/pagePre.js';

const num = (v) => (v == null || v === '' || !Number.isFinite(Number(v)) ? null : Number(v));

/** American odds -> implied probability (0-1, vig still in), or null. */
export function impliedFromAmerican(a) {
  const n = num(a);
  if (n == null || n === 0) return null;
  return n < 0 ? -n / (-n + 100) : 100 / (n + 100);
}

/**
 * The feed's odds rows (every vendor, any games) -> Map(bdlGameId -> { home: {implied},
 * away: {implied} }), the shape homeWinPct reads. One vendor per game: the one
 * named 'draftkings' if it has both moneylines (as pickOdds does for the spread),
 * else the first that does. A game with no clean two-sided moneyline is absent.
 */
export function shapeFeedMoneylines(rows) {
  const best = new Map();
  for (const r of Array.isArray(rows) ? rows : []) {
    const h = impliedFromAmerican(r?.moneyline_home_odds);
    const a = impliedFromAmerican(r?.moneyline_away_odds);
    if (h == null || a == null) continue;
    const id = String(r?.game_id);
    const dk = String(r?.vendor).toLowerCase() === 'draftkings';
    if (best.has(id) && !(dk && !best.get(id).dk)) continue;
    best.set(id, { dk, home: { implied: h }, away: { implied: a } });
  }
  return new Map([...best].map(([k, v]) => [k, { home: v.home, away: v.away }]));
}

/**
 * Board NBA matches -> Map(match_id -> h2h-shaped odds). `bdlGameIds` maps
 * match_id -> the feed's game id. `feed` is lib/nba/pageFeed.js (a test passes its own).
 */
export async function nbaMoneylines(bdlGameIds, feed) {
  const ids = [...bdlGameIds.values()].filter(Boolean);
  if (!ids.length) return new Map();
  const rows = await feed.readOddsMany(ids);
  const byGame = shapeFeedMoneylines(rows);
  const out = new Map();
  for (const [matchId, gid] of bdlGameIds) {
    const o = byGame.get(String(gid));
    if (o) out.set(matchId, o);
  }
  return out;
}

/** team_id -> "34-12" from the feed's standings. `bdlTeamIds` maps team_id -> the feed's team id. */
export async function nbaRecords(bdlTeamIds, season, feed) {
  if (!bdlTeamIds.size || !season) return new Map();
  const rows = await feed.readStandings(season);
  const out = new Map();
  for (const [teamId, bdl] of bdlTeamIds) {
    const s = standingRecord(rows, bdl);
    if (s) out.set(teamId, s);
  }
  return out;
}
