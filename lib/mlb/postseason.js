// lib/mlb/postseason.js - the bracket's vocabulary, and where a round comes
// from.
//
// FOUR STAGE NAMES, AND `final` IS NOT ONE OF THEM. matches.stage is a shared
// column and it already carries a World Cup vocabulary - group, round_of_16,
// quarter, semi, final - written by an importer that knows nothing about
// baseball. 'final' there means the World Cup final. The World Series gets its
// own name for exactly that reason, and no reader of either sport has to ask
// which tournament a 'final' belongs to.
//
// THE PROVIDER WE IMPORT GAMES FROM DOES NOT CARRY THE ROUND. Measured, not
// assumed: the 2025 postseason comes back as 47 rows whose only round-ish
// field is season_type: "postseason". There is no round, no series number, no
// game-in-series. So the stage has to come from somewhere, and this file is
// the somewhere - two sources, each honest about what it can prove.

/** The four rounds, in bracket order. The ONLY stage values MLB writes. */
export const STAGES = Object.freeze(['wild_card', 'division', 'championship', 'world_series']);

/**
 * BEST-OF BY STAGE, which is a rule of the competition and not a fact about
 * any particular series - a sweep is still a best-of-five.
 */
export const BEST_OF = Object.freeze({
  wild_card: 3, division: 5, championship: 7, world_series: 7,
});

/** Wins needed to take a series. 3 -> 2, 5 -> 3, 7 -> 4. */
export const clinch = (bestOf) => Math.floor(Number(bestOf) / 2) + 1;

/** How many series a full round has, and therefore what a complete one is. */
export const SERIES_IN_ROUND = Object.freeze({
  wild_card: 4, division: 4, championship: 2, world_series: 1,
});

/** Display, for the bracket's column heads. */
export const STAGE_LABEL = Object.freeze({
  wild_card: 'Wild Card', division: 'Division Series',
  championship: 'Championship Series', world_series: 'World Series',
});

/** Points a correct pick is worth, by round (relay B2 item 3): 1 / 2 / 3 / 4. */
export const ROUND_POINTS = Object.freeze({
  wild_card: 1, division: 2, championship: 3, world_series: 4,
});

export const isStage = (s) => STAGES.includes(s);

// ---------------------------------------------------------------------------
// SOURCE 1: the second provider, which DOES carry the round.
// ---------------------------------------------------------------------------

/**
 * statsapi's gameType -> our stage. This is the LIVE path and the one the
 * Monday import uses: it is a per-game fact from the competition's own feed,
 * not an inference from the shape of a bracket that is still being played.
 *
 *   F  Wild Card      D  Division Series
 *   L  League Championship Series      W  World Series
 *
 * S (Spring), R (Regular), A (All-Star), E (Exhibition) map to null - they are
 * not postseason and a caller must not file them under one.
 */
export const GAME_TYPE_STAGE = Object.freeze({
  F: 'wild_card', D: 'division', L: 'championship', W: 'world_series',
});

export function stageFromGameType(gameType) {
  const k = String(gameType ?? '').trim().toUpperCase();
  return GAME_TYPE_STAGE[k] ?? null;
}

// ---------------------------------------------------------------------------
// SOURCE 2: the bracket's own shape, for a bracket that is already over.
// ---------------------------------------------------------------------------

/**
 * THE BACKWARDS WALK. A COMPLETED bracket carries its own rounds in its
 * structure, and this reads them out exactly - no dates, no game counts, no
 * "the wild card is whatever starts first".
 *
 *   The World Series is the one series whose two clubs come from DIFFERENT
 *   leagues. Every other series in the tournament is American-only or
 *   National-only, by construction, forever.
 *
 *   From there it is a walk: the previous series of each World Series club is
 *   a Championship Series; the previous series of each of THOSE clubs is a
 *   Division Series; the previous series of each of those is a Wild Card.
 *
 * BYES FALL OUT FOR FREE, which is why this is a walk and not an index. A
 * club with a first-round bye simply has no previous series before its
 * Division Series, so nothing is assigned and nothing is wrong. An
 * index-into-each-club's-series-list would have called that club's Division
 * Series a Wild Card.
 *
 * IT IS FOR A FINISHED BRACKET ONLY and it says so by refusing: no
 * cross-league series means no World Series means the tournament is still
 * being played, and this returns null rather than a guess. The live path is
 * stageFromGameType() above.
 *
 * @param groups  [{ key, teams: [{ id, league }], firstDate }]
 * @returns Map(key -> stage), or null when the bracket is not complete
 */
export function stagesByBacktrack(groups = []) {
  const list = (groups ?? []).filter((g) => g?.teams?.length === 2);
  if (!list.length) return null;
  const ws = list.filter((g) => {
    const [a, b] = g.teams;
    return a?.league && b?.league && a.league !== b.league;
  });
  // EXACTLY ONE, or we do not understand this bracket. Zero means it is not
  // finished; more than one means the league labels are wrong and a walk from
  // either would mis-round half the tournament.
  if (ws.length !== 1) return null;

  const out = new Map([[ws[0].key, 'world_series']]);
  const seriesOf = new Map();          // teamId -> [series, oldest first]
  for (const g of list) {
    for (const t of g.teams) {
      if (!seriesOf.has(t.id)) seriesOf.set(t.id, []);
      seriesOf.get(t.id).push(g);
    }
  }
  // BY INSTANT, for the same reason shapeSeries() sorts that way: a caller
  // may hand these in as Date objects and String(Date) sorts alphabetically.
  for (const [, gs] of seriesOf) gs.sort((x, y) => new Date(x.firstDate) - new Date(y.firstDate));

  const prevOf = (series, teamId) => {
    const gs = seriesOf.get(teamId) ?? [];
    const i = gs.indexOf(series);
    return i > 0 ? gs[i - 1] : null;
  };

  let front = [ws[0]];
  for (const stage of ['championship', 'division', 'wild_card']) {
    const next = [];
    for (const s of front) {
      for (const t of s.teams) {
        const p = prevOf(s, t.id);
        // A SERIES IS NEVER RE-ROUNDED. Two clubs can walk back into the same
        // earlier series only if they met twice, which the bracket forbids;
        // the guard is here so a malformed input degrades to "already placed"
        // instead of overwriting a round with a shallower one.
        if (p && !out.has(p.key)) { out.set(p.key, stage); next.push(p); }
      }
    }
    front = next;
  }
  // Every series placed, or we do not understand this bracket either.
  return out.size === list.length ? out : null;
}

// ---------------------------------------------------------------------------
// SOURCE 3: our own bracket - the stored seeds and who is playing whom.
// ---------------------------------------------------------------------------

/**
 * THE ROUND FROM THE TWO SEEDS, while the bracket is being played. The
 * twelve-club format fixes every pairing a round can hold, per league:
 *
 *   Wild Card     3 v 6, 4 v 5
 *   Division      1 v (4|5), 2 v (3|6)        - a bye seed against a WC winner
 *   Championship  one club from {1,4,5} against one from {2,3,6}
 *   World Series  the two leagues meet
 *
 * {1,4,5} and {2,3,6} are the two halves of a league's bracket. Two clubs from
 * the SAME half meet in the Wild Card ({4,5}, {3,6}) or the Division Series
 * (the rest); two from DIFFERENT halves can only meet in the Championship
 * Series. So the pair alone decides the round, and no pair is ambiguous.
 *
 * @returns a stage, or null when either seed is not 1-6 (we do not understand
 *          the pairing, and it stays unstaged rather than guessed)
 */
const HALF = Object.freeze({ 1: 'a', 4: 'a', 5: 'a', 2: 'b', 3: 'b', 6: 'b' });
export function stageFromSeeds(seedA, seedB, { crossLeague = false } = {}) {
  if (crossLeague) return 'world_series';
  const a = Number(seedA); const b = Number(seedB);
  if (!HALF[a] || !HALF[b] || a === b) return null;
  if (HALF[a] !== HALF[b]) return 'championship';
  const pair = [a, b].sort().join('');
  return pair === '45' || pair === '36' ? 'wild_card' : 'division';
}

/**
 * Every series in a postseason, staged from the seeds. Same input shape as
 * stagesByBacktrack(): groups of [{ key, teams: [{ id, league }] }], plus
 * seedOf: Map(team id -> seed 1-6). Works on a bracket still being played.
 *
 * REFUSES WHAT DOES NOT FIT rather than forcing it: a series with an unseeded
 * club, a round holding more series than the format has, or a club in two
 * series of one round lands in `unplaced`, and its games stay unstaged.
 *
 * @returns { stages: Map(key -> stage), unplaced: [{ key, why }] }
 */
export function stagesBySeeds(groups = [], seedOf = new Map()) {
  const stages = new Map(); const unplaced = [];
  for (const g of (groups ?? []).filter((x) => x?.teams?.length === 2)) {
    const [a, b] = g.teams;
    const cross = Boolean(a?.league && b?.league && a.league !== b.league);
    const st = stageFromSeeds(seedOf.get(a.id), seedOf.get(b.id), { crossLeague: cross });
    if (!st) { unplaced.push({ key: g.key, why: `seeds ${seedOf.get(a.id) ?? '-'} v ${seedOf.get(b.id) ?? '-'}` }); continue; }
    stages.set(g.key, st);
  }
  for (const st of STAGES) {
    const keys = [...stages].filter(([, s]) => s === st).map(([k]) => k);
    const clubs = keys.flatMap((k) => groups.find((g) => g.key === k).teams.map((t) => t.id));
    const twice = clubs.filter((c, i) => clubs.indexOf(c) !== i);
    if (keys.length > SERIES_IN_ROUND[st] || twice.length) {
      for (const k of keys) { stages.delete(k); unplaced.push({ key: k, why: `${st}: ${keys.length} series${twice.length ? `, ${twice.join('/')} twice` : ''}` }); }
    }
  }
  return { stages, unplaced };
}
