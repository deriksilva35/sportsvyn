// lib/fantasy/statsFixture.js - DEV-ONLY sample stats for the ?statsfixture=1 flag.
//
// ============================================================================
// THIS IS NOT A DATA SOURCE. IT IS A RULER.
// ============================================================================
// The real path is getPlayerSeasonStats() in ./playerStats.js, which returns
// null until the gridiron 2025 backfill lands. This module exists ONLY so the
// quick stats, fantasy points and game log can be built and eyeballed at real
// density before that data exists. It is reachable exclusively through
// ?statsfixture=1 and is never imported by the real read path.
//
// Every number here is INVENTED. Nothing in this file may ever be presented as
// a real stat: the room stamps fixture output with a visible FIXTURE badge and
// source:'fixture' so it can never be mistaken for the backfill.
//
// TODO(gridiron 2025 backfill session): delete this module and the ?statsfixture=1
// flag once getPlayerSeasonStats() returns real rows.
//
// Deterministic: seeded off ffcPlayerId, so a given player's fake line is stable
// across expand/collapse instead of reshuffling on every render.
//
// SHAPE: games carry a STRUCTURED `stats` object (the same shape the backfill
// must produce), because fantasy points are computed from it by ./scoring.js and
// displayed by ./statView.js. This module only GENERATES; it owns no rendering,
// so deleting it at backfill time takes nothing real with it.

import { fantasyPoints } from './scoring.js';

const OPPONENTS = ['@BAL', 'CIN', '@CLE', 'PIT', '@HOU', 'JAX', '@TEN', 'IND',
  'DEN', '@KC', 'LV', '@LAC', 'BUF', '@MIA', 'NE', '@NYJ', 'DAL'];

// mulberry32, same family as engine.makeRng - deterministic from a string key.
function rngFor(key) {
  let h = 2166136261;
  for (let i = 0; i < String(key).length; i++) {
    h ^= String(key).charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  let s = h >>> 0;
  return function rng() {
    s = (s + 0x6D2B79F5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const pick = (rng, lo, hi) => lo + Math.floor(rng() * (hi - lo + 1));

// Per-position invented stat line. FFC position vocab (PK = kicker, DEF = team D).
const GEN = {
  QB: (rng) => {
    const att = pick(rng, 24, 42);
    return {
      passAtt: att, passCmp: pick(rng, 14, att - 4), passYds: pick(rng, 140, 380),
      passTd: pick(rng, 0, 4), int: pick(rng, 0, 2),
      rushYds: pick(rng, -2, 45), rushTd: pick(rng, 0, 1), fumblesLost: pick(rng, 0, 1),
    };
  },
  RB: (rng) => ({
    rushAtt: pick(rng, 6, 24), rushYds: pick(rng, 18, 140), rushTd: pick(rng, 0, 2),
    rec: pick(rng, 0, 7), recYds: pick(rng, 0, 60), recTd: pick(rng, 0, 1),
    fumblesLost: pick(rng, 0, 1),
  }),
  WR: (rng) => {
    const tgt = pick(rng, 3, 14);
    const rec = pick(rng, 1, tgt);
    return { tgt, rec, recYds: pick(rng, 5, 130), recTd: pick(rng, 0, 2), fumblesLost: 0 };
  },
  PK: (rng) => {
    const fga = pick(rng, 1, 5);
    return { fga, fgm: pick(rng, 0, fga), fgLong: pick(rng, 28, 56), xp: pick(rng, 0, 5) };
  },
  DEF: (rng) => ({
    sacks: pick(rng, 0, 6), defInt: pick(rng, 0, 3), fr: pick(rng, 0, 2), defTd: pick(rng, 0, 1),
  }),
};
GEN.TE = GEN.WR;

const sumStats = (games) => games.reduce((acc, g) => {
  for (const [k, v] of Object.entries(g.stats)) acc[k] = (acc[k] ?? 0) + Number(v || 0);
  return acc;
}, {});

/**
 * DEV-ONLY invented SeasonStats mirroring the real getPlayerSeasonStats shape.
 * @param {string} ffcPlayerId    seed - same player, same fake line
 * @param {string} position       FFC vocab: QB/RB/WR/TE/PK/DEF
 * @param {number|null} bye       bye week to skip in the game log
 * @param {string} scoringFormat  from the draft's config row; drives reception value
 */
export function getPlayerSeasonStatsFixture(ffcPlayerId, position, bye = null, scoringFormat = 'ppr') {
  const gen = GEN[position] ?? GEN.WR;
  const rng = rngFor(ffcPlayerId);
  const games = [];
  for (let week = 1; week <= 18; week++) {
    if (week === bye) continue;
    const stats = gen(rng);
    games.push({ week, opp: OPPONENTS[(week - 1) % OPPONENTS.length], stats, points: fantasyPoints(stats, scoringFormat) });
  }
  return { season: 2025, source: 'fixture', position, games, totals: sumStats(games) };
}
