// lib/fantasy/statsFixture.js - DEV-ONLY sample stats for the ?statsfixture=1 flag.
//
// ============================================================================
// THIS IS NOT A DATA SOURCE. IT IS A RULER.
// ============================================================================
// The real path is getPlayerSeasonStats() in ./playerStats.js, which returns
// null until the gridiron 2025 backfill lands. This module exists ONLY so the
// stat strip / game log can be built and eyeballed at real density before that
// data exists. It is reachable exclusively through ?statsfixture=1 and is never
// imported by the real read path.
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
const sum = (games, i) => games.reduce((a, g) => a + Number(String(g.values[i]).split('/')[0] || 0), 0);

// Per-position game-log spec: headers + a row generator. FFC vocab (PK / DEF).
const SPEC = {
  QB: {
    columns: ['OPP', 'CMP/ATT', 'YDS', 'TD', 'INT'],
    row: (rng) => {
      const att = pick(rng, 24, 42);
      return [`${pick(rng, 14, att - 4)}/${att}`, String(pick(rng, 140, 380)), String(pick(rng, 0, 4)), String(pick(rng, 0, 2))];
    },
    totals: (g) => [
      { label: 'PASS YDS', value: String(sum(g, 2)) },
      { label: 'PASS TD', value: String(sum(g, 3)) },
      { label: 'INT', value: String(sum(g, 4)) },
    ],
  },
  RB: {
    columns: ['OPP', 'CAR', 'RUSH YDS', 'REC', 'TD'],
    row: (rng) => [String(pick(rng, 6, 24)), String(pick(rng, 18, 140)), String(pick(rng, 0, 7)), String(pick(rng, 0, 2))],
    totals: (g) => [
      { label: 'RUSH YDS', value: String(sum(g, 2)) },
      { label: 'REC', value: String(sum(g, 3)) },
      { label: 'TD', value: String(sum(g, 4)) },
    ],
  },
  WR: {
    columns: ['OPP', 'TGT', 'REC', 'REC YDS', 'TD'],
    row: (rng) => {
      const tgt = pick(rng, 3, 14);
      return [String(tgt), String(pick(rng, 1, tgt)), String(pick(rng, 5, 130)), String(pick(rng, 0, 2))];
    },
    totals: (g) => [
      { label: 'REC', value: String(sum(g, 2)) },
      { label: 'REC YDS', value: String(sum(g, 3)) },
      { label: 'TD', value: String(sum(g, 4)) },
    ],
  },
  PK: {
    columns: ['OPP', 'FGM/FGA', 'LNG', 'XP', 'PTS'],
    row: (rng) => {
      const fga = pick(rng, 1, 5);
      const fgm = pick(rng, 0, fga);
      const xp = pick(rng, 0, 5);
      return [`${fgm}/${fga}`, String(pick(rng, 28, 56)), String(xp), String(fgm * 3 + xp)];
    },
    totals: (g) => [
      { label: 'FG MADE', value: String(sum(g, 1)) },
      { label: 'XP', value: String(sum(g, 3)) },
      { label: 'PTS', value: String(sum(g, 4)) },
    ],
  },
  DEF: {
    columns: ['OPP', 'SACK', 'INT', 'FR', 'TD'],
    row: (rng) => [String(pick(rng, 0, 6)), String(pick(rng, 0, 3)), String(pick(rng, 0, 2)), String(pick(rng, 0, 1))],
    totals: (g) => [
      { label: 'SACKS', value: String(sum(g, 1)) },
      { label: 'INT', value: String(sum(g, 2)) },
      { label: 'DEF TD', value: String(sum(g, 4)) },
    ],
  },
};
SPEC.TE = SPEC.WR; // same receiving line

/**
 * DEV-ONLY invented SeasonStats mirroring the real getPlayerSeasonStats shape.
 * @param {string} ffcPlayerId  seed - same player, same fake line
 * @param {string} position     FFC vocab: QB/RB/WR/TE/PK/DEF
 * @param {number|null} bye     bye week to skip in the game log
 */
export function getPlayerSeasonStatsFixture(ffcPlayerId, position, bye = null) {
  const spec = SPEC[position] ?? SPEC.WR;
  const rng = rngFor(ffcPlayerId);
  const games = [];
  for (let week = 1; week <= 18; week++) {
    if (week === bye) continue;
    games.push({ week, values: [OPPONENTS[(week - 1) % OPPONENTS.length], ...spec.row(rng)] });
  }
  return { season: 2025, source: 'fixture', totals: spec.totals(games), columns: spec.columns, games };
}
