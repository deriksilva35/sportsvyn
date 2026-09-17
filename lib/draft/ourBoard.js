// lib/draft/ourBoard.js - OUR OWN BOARD. Value over replacement, with FFC's
// preseason market as the prior.
//
// ============================================================================
// WHY THE ROOM STOPPED DRAFTING FROM ADP
// ============================================================================
// FFC's ADP is a PRESEASON market that thins as the season runs - the ppr/12
// pool went 271 rows on 31 Aug to 78 on 17 Sep, because fewer people mock-draft
// in week 2 than in August. Two things follow. The board shrank until it could
// not seat a twelve-by-eight room (fixed once, by reaching back for a snapshot
// that fits - lib/draft/pool.js chooseSnapshot). And the prices themselves went
// stale: an August market cannot know what September has shown, so a back who
// has been the best player in football for two weeks is still priced where the
// mock drafters left him.
//
// AND IT IS A FULL-SEASON MARKET PRICING A ONE-WEEK GAME. FFC ranks players for
// a sixteen-week roster; our room is eight picks that score for ONE weekend,
// best six of eight. The two questions have different answers, and the loudest
// disagreement is at quarterback: a full-season board takes the position early
// because a bad QB costs you all year, while a one-week best-ball roster starts
// exactly one and can take the sixth-best one late for almost the same points.
//
// ============================================================================
// WHAT REPLACES IT: PPG MINUS THE REPLACEMENT AT HIS POSITION
// ============================================================================
// vor = ppg - (the ppg of the last man who would start at that position)
//
// That subtraction is the whole idea. Twelve teams starting one quarterback
// means the thirteenth-best quarterback is free; a quarterback is worth only
// what he scores ABOVE that free one. Twelve teams starting three receivers
// plus a share of the flex means the forty-third receiver is the free one, and
// the gap between the best receiver and him is enormous. This is why the board
// puts backs and receivers first without anyone hardcoding a "WR bump".
//
// THE REPLACEMENT RANKS ARE DERIVED FROM THE CONFIG, NEVER TYPED. A hardcoded
// 13/32/41/14 is right for exactly one roster shape and silently wrong for
// every other one the console can build, and the console can build a lot of
// them (SLOT_KEYS in lib/fantasy/config.js). See replacementRanks.
//
// ============================================================================
// THE WINDOW, AND WHY IT IS TWO SEASONS
// ============================================================================
// 2025 REG plus 2026 REG to date, FINALS ONLY, PPR through the one scorer.
// One season alone is not a measurement in September: a man with one game has
// a ppg made of one game, and the board would reshuffle itself every Sunday
// around whoever had the loudest afternoon. Two seasons of finals is enough
// signal to rank on, and the blend below is what lets the new season take over
// as it earns the right to.
//
// FINALS ONLY, for the same reason lib/weekly/seasonLine.js reads finals only:
// a man three carries into the first quarter is not a per-game average.
//
// ============================================================================
// THE PRIOR, AND THE BLEND
// ============================================================================
// A board built only on last year plus two weeks of this one has no idea who
// changed teams, who is hurt, who lost his job in camp, or who a rookie is.
// FFC's PRESEASON market knows all of that - it is thousands of humans pricing
// the season after every camp report. So the largest preseason snapshot is the
// PRIOR, and the season's own evidence takes the board over as it accumulates:
//
//     weight = min(games this season, 6) / 6
//     board rank = (1 - weight) * prior rank + weight * VOR rank
//
// Week 2 is weight 1/6 - the market still holds the board, with this year's
// evidence nudging it. By week 7 the weight is 1 and the board is pure VOR,
// which is the right end state: by then the season IS the information.
//
// NO PRIOR AND NO GAMES RANKS LAST, and is still on the board, still
// searchable. A man nobody mock-drafted and who has not played is not a man we
// know to be bad - he is a man we know nothing about - so he goes to the back
// rather than off the edge.
//
// ============================================================================
// THE UNIVERSE IS THE FFC IDENTITY SET, AND THAT IS A CONSTRAINT, NOT A CHOICE
// ============================================================================
// A drafted player is bridged to his real points through
// sim_player_pool.matched_player_id (lib/draft/entry.js, lib/draft/room.js), so
// a man with no sim_player_pool row cannot be scored on Tuesday no matter how
// well he played. 304 players carry an identity in the ppr/12 FFC pool and all
// 304 are matched; 1,064 players have 2026 finals. The 760 with no identity are
// deep-bench (measured: the top of that list is one-game special-teamers), but
// the rule is the rule - this board ranks the men the settle can pay.
//
// ============================================================================
// WHAT IT EMITS, AND WHY THE ROOM NEEDS NO CHANGE
// ============================================================================
// The row shape is mapPoolRow's (lib/fantasy/drafts.js) exactly, with `adp`
// carrying the BOARD RANK in overall-pick units - so valueGap, adp_at_pick,
// the grade, the engine's par calculation and every seat report keep working
// on the number they already read. `vor` and `ppg` ride along for display.
//
// stdev IS NULL ON EVERY ROW, deliberately. The engine already has a path for
// a pool with no spread (tempMode 'adp', built for Fantrax's feed): temperature
// becomes proportional to board rank instead of to stdev. Inventing a spread we
// have not measured would be worse than using the path that exists.

import { sql } from '../db.js';
import { fantasyPoints } from '../fantasy/scoring.js';
import { toStatLine } from '../fantasy/playerStats.js';
import { displayName } from '../fantasy/dstName.js';
import { nflClubs } from '../fantasy/clubs.js';
import { ROOKIE_SEASON } from '../fantasy/movement.js';

/**
 * drafts.pool_source for a room playing this board.
 *
 * IT IS A PROVENANCE STAMP, NOT A TABLE NAME. 'ffc' means the room drafted
 * FFC's market, 'fantrax' means an imported league's own pool, and this means
 * the board below - which is the one value in that column with no table behind
 * it. poolFor (lib/fantasy/drafts.js) is the only reader that branches on it,
 * and it must, because pool_snapshot_date means something different here.
 */
export const OUR_SOURCE = 'sportsvyn';

/** Positions a FLEX slot accepts (engine.js FLEX_ELIGIBLE, same set). */
export const FLEX_ELIGIBLE = ['RB', 'WR', 'TE'];
/** Positions a SUPERFLEX slot accepts. */
export const SUPERFLEX_ELIGIBLE = ['QB', 'RB', 'WR', 'TE'];
/** The positions this board ranks on value. Everything else sorts below them. */
export const SKILL = ['QB', 'RB', 'WR', 'TE'];
/** Games of the current season at which the board is pure VOR. */
export const FULL_WEIGHT_GAMES = 6;

/**
 * The rank of the replacement player at each position, from the roster config.
 *
 * THE DEDICATED SLOTS ARE ARITHMETIC: twelve teams starting three receivers
 * means thirty-six receivers start, so the thirty-seventh is the free one -
 * except that the flex is also starting receivers, and they have to come from
 * somewhere.
 *
 * THE FLEX SHARE RULE, STATED AND CHOSEN: a flex slot is divided among the
 * positions it accepts IN PROPORTION TO THEIR DEDICATED SLOT COUNTS. For
 * QB1/RB2/WR3/TE1 that splits the twelve flex slots 4 RB / 6 WR / 2 TE, giving
 * replacement ranks QB 13, RB 29, WR 43, TE 15.
 *
 * WHY THAT RULE. The alternative is to measure how flexes are ACTUALLY filled
 * and share by observed frequency, which is a better model and a worse
 * function: it would make the board depend on how this room's bots behaved
 * last week, so two rooms in the same week could disagree about who the
 * replacement receiver is. Proportional-to-dedicated is a property of the
 * CONFIG alone - the same config always yields the same board - and it is
 * right for the reason the dedicated counts are the model in the first place:
 * a roster that starts three receivers and two backs is a roster whose flex is
 * more often a receiver.
 *
 * A config with no flex gets the dedicated counts and nothing else. A config
 * with no dedicated slots at a flex-eligible position (all-flex, which the
 * console permits) shares evenly rather than dividing by zero.
 *
 * @param {object} rosterSlots e.g. { QB: 1, RB: 2, WR: 3, TE: 1, FLEX: 1 }
 * @param {number} teamsCount
 * @returns {{QB:number, RB:number, WR:number, TE:number}} 1-indexed ranks
 */
export function replacementRanks(rosterSlots, teamsCount) {
  const teams = Number(teamsCount) || 0;
  const slots = rosterSlots ?? {};
  const dedicated = {};
  for (const pos of SKILL) dedicated[pos] = (Number(slots[pos]) || 0) * teams;

  const share = (perTeam, eligible) => {
    const total = (Number(perTeam) || 0) * teams;
    const out = {};
    if (total <= 0) return out;
    let weight = 0;
    for (const pos of eligible) weight += Number(slots[pos]) || 0;
    for (const pos of eligible) {
      out[pos] = weight > 0 ? (total * (Number(slots[pos]) || 0)) / weight : total / eligible.length;
    }
    return out;
  };
  const flex = share(slots.FLEX, FLEX_ELIGIBLE);
  const superflex = share(slots.SUPERFLEX, SUPERFLEX_ELIGIBLE);

  const ranks = {};
  for (const pos of SKILL) {
    const starters = dedicated[pos] + (flex[pos] ?? 0) + (superflex[pos] ?? 0);
    // The man AFTER the last starter is the replacement, and a position nobody
    // starts still has one - the best of them is free, so rank 1 is the floor.
    ranks[pos] = Math.max(1, Math.round(starters) + 1);
  }
  return ranks;
}

/**
 * The replacement ppg at each position: the ppg of the player AT that rank.
 *
 * A position with fewer measured players than its replacement rank takes the
 * last one measured - the shallowest honest answer - rather than 0, which
 * would hand everyone at that position a free VOR equal to his whole output.
 *
 * @param {Array<{position:string, ppg:number|null}>} rows
 * @param {object} ranks from replacementRanks
 * @returns {Record<string, number|null>}
 */
export function replacementPpg(rows, ranks) {
  const out = {};
  for (const pos of SKILL) {
    const ranked = (rows ?? [])
      .filter((r) => r.position === pos && r.ppg != null)
      .sort((a, b) => b.ppg - a.ppg);
    if (!ranked.length) { out[pos] = null; continue; }
    const idx = Math.min(Number(ranks?.[pos] ?? 1) - 1, ranked.length - 1);
    out[pos] = ranked[Math.max(0, idx)].ppg;
  }
  return out;
}

/** Points per game above the replacement at his position, to a tenth. */
export function vorOf(ppg, replacement) {
  if (ppg == null || replacement == null) return null;
  return Math.round((Number(ppg) - Number(replacement)) * 10) / 10;
}

/** How much this season's evidence owns the board: 0 at no games, 1 at six. */
export function blendWeight(games) {
  const g = Number(games);
  if (!Number.isFinite(g) || g <= 0) return 0;
  return Math.min(g, FULL_WEIGHT_GAMES) / FULL_WEIGHT_GAMES;
}

/**
 * The blended rank. Lower is better; a man with neither input ranks last.
 *
 * ONE MISSING INPUT IS NOT A VERDICT. A man the market never priced but who
 * has played takes `lastRank` for the side we lack, so his games still move
 * him - they just move him up from the back rather than down from the front.
 */
export function blendRank(priorRank, vorRank, games, lastRank) {
  if (priorRank == null && vorRank == null) return Infinity;
  const w = blendWeight(games);
  const prior = priorRank ?? lastRank;
  const vor = vorRank ?? lastRank;
  return (1 - w) * Number(prior) + w * Number(vor);
}

/**
 * Order an enriched row set into a board. PURE - every database read is done.
 *
 * K AND DST SIT BELOW EVERY SKILL PLAYER, ordered among themselves by ppg.
 * They are not on the same value scale (a kicker has no replacement rank in
 * this model and the ranked config has no slot for one), and a board that
 * interleaved them on a VOR they do not have would put a kicker ahead of a
 * starting back. Below the skill players, in the order they scored, is the
 * honest placement: draftable if a config wants them, never priced as though
 * we had measured their value.
 *
 * @param {Array} rows enriched with position, ppg, vor, priorRank, games
 * @returns {Array} the same rows with boardRank and adp set, board order
 */
export function orderBoard(rows) {
  const all = rows ?? [];
  const skill = all.filter((r) => SKILL.includes(r.position));
  const rest = all.filter((r) => !SKILL.includes(r.position));

  const byVor = skill.filter((r) => r.vor != null).sort((a, b) => b.vor - a.vor);
  byVor.forEach((r, i) => { r.vorRank = i + 1; });
  const last = skill.length + 1;
  for (const r of skill) r.blend = blendRank(r.priorRank ?? null, r.vorRank ?? null, r.games, last);

  skill.sort((a, b) => (a.blend - b.blend)
    || ((a.priorRank ?? last) - (b.priorRank ?? last))
    || String(a.name).localeCompare(String(b.name)));

  rest.sort((a, b) => (b.ppg ?? -Infinity) - (a.ppg ?? -Infinity)
    || String(a.name).localeCompare(String(b.name)));

  const board = [...skill, ...rest];
  board.forEach((r, i) => { r.boardRank = i + 1; r.adp = i + 1; });
  return board;
}

/** 'YYYY-MM-DD' from a Date or an already-dated string. */
function ymd(d) {
  if (d == null) return null;
  if (typeof d === 'string') return d.slice(0, 10);
  const t = new Date(d);
  return Number.isFinite(t.getTime()) ? t.toISOString().slice(0, 10) : null;
}

/**
 * The largest PRESEASON snapshot of one pool pair - our prior.
 *
 * LARGEST, NOT NEWEST. The point of the prior is the deepest market anybody
 * ever made on these players, and that is August: 271 rows on 31 Aug against
 * 78 on 17 Sep. A tie goes to the later date - same depth, fresher camp news.
 *
 * PRESEASON means before the season's first kickoff, read from the schedule
 * rather than typed as a cutoff date.
 */
export async function priorSnapshot(scoringFormat, teamsCount, season, source = 'ffc') {
  const [first] = await sql`
    SELECT min(m.kickoff_at) AS k
      FROM matches m JOIN leagues l ON l.id = m.league_id
     WHERE l.slug = 'nfl' AND m.season_year = ${season} AND m.season_phase = 'REG'`;
  const rows = await sql`
    SELECT snapshot_date, count(*)::int AS rows
      FROM sim_player_pool
     WHERE scoring_format = ${scoringFormat} AND teams_count = ${teamsCount} AND source = ${source}
       ${first?.k ? sql`AND snapshot_date < ${first.k}` : sql``}
     GROUP BY snapshot_date
     ORDER BY count(*) DESC, snapshot_date DESC
     LIMIT 1`;
  if (!rows.length) return null;
  return { snapshotDate: rows[0].snapshot_date, rows: Number(rows[0].rows) };
}

/**
 * OUR BOARD, ranked, for one pool pair and one roster shape.
 *
 * @param {object} opts
 * @param {string} opts.scoringFormat pool pair, for the identity universe and the prior
 * @param {number} opts.teamsCount    pool pair, and the replacement arithmetic
 * @param {object} opts.rosterSlots   the config's slots - the replacement arithmetic
 * @param {number} opts.season        the season being played
 * @param {Array<number>} [opts.seasons] the window; defaults to [season - 1, season]
 * @returns {Promise<{computedAt: Date, label: string, priorDate: string|null, rows: Array}>}
 */
export async function ourBoard({
  scoringFormat = 'ppr', teamsCount = 12, rosterSlots, season,
  seasons = null, source = 'ffc',
} = {}) {
  const window = seasons ?? [Number(season) - 1, Number(season)];

  // ONE IDENTITY PER PLAYER, from the most recent snapshot that carried him.
  // Across every snapshot rather than one of them, so a man FFC added in
  // September is on the board even though the preseason prior never priced him.
  // THE ROOKIE FLAG AND THE CLUB NAME COME FROM THE SAME PLACES getPoolAt READS
  // THEM: a LEFT JOIN on matched_player_id (an FK to a serial primary key, so
  // strictly many-to-one and unable to fan out), and displayName for a defense,
  // whose provider name never leaves dstName.js.
  const [ident, clubs] = await Promise.all([
    sql`
    SELECT DISTINCT ON (p.ffc_player_id)
           p.ffc_player_id, p.matched_player_id, p.name, p.position, p.team, p.bye,
           p.league, p.ncaaf_adp,
           (np.rookie_season = ${ROOKIE_SEASON}) AS rookie
      FROM sim_player_pool p
      LEFT JOIN nfl_players np ON np.id = p.matched_player_id
     WHERE p.scoring_format = ${scoringFormat} AND p.teams_count = ${teamsCount}
       AND p.source = ${source} AND p.matched_player_id IS NOT NULL
     ORDER BY p.ffc_player_id, p.snapshot_date DESC`,
    nflClubs(),
  ]);
  if (!ident.length) return { computedAt: new Date(), label: null, priorDate: null, rows: [] };

  const prior = await priorSnapshot(scoringFormat, teamsCount, season, source);
  const priorRows = prior
    ? await sql`SELECT ffc_player_id, adp FROM sim_player_pool
                 WHERE scoring_format = ${scoringFormat} AND teams_count = ${teamsCount}
                   AND source = ${source} AND snapshot_date = ${prior.snapshotDate}
                 ORDER BY adp ASC`
    : [];
  const priorRank = new Map();
  priorRows.forEach((r, i) => priorRank.set(String(r.ffc_player_id), i + 1));

  // THE WINDOW, summed in SQL and scored once. scoring.js is linear, so points
  // of the sum equals the sum of the points and beats adding rounded per-game
  // figures - the same argument lib/weekly/seasonLine.js makes.
  const pids = ident.map((r) => Number(r.matched_player_id));
  const stats = await sql`
    SELECT s.nfl_player_id                                            AS id,
           count(DISTINCT s.match_id)::int                            AS gp,
           count(DISTINCT s.match_id) FILTER (WHERE m.season_year = ${Number(season)})::int AS gp_now,
           sum(COALESCE(s.pass_cmp, 0))::int                          AS pass_cmp,
           sum(COALESCE(s.pass_att, 0))::int                          AS pass_att,
           sum(COALESCE(s.pass_yds, 0))::int                          AS pass_yds,
           sum(COALESCE(s.pass_td, 0))::int                           AS pass_td,
           sum(COALESCE(s.pass_int, 0))::int                          AS pass_int,
           sum(COALESCE(s.rush_att, 0))::int                          AS rush_att,
           sum(COALESCE(s.rush_yds, 0))::int                          AS rush_yds,
           sum(COALESCE(s.rush_td, 0))::int                           AS rush_td,
           sum(COALESCE(s.tgt, 0))::int                               AS tgt,
           sum(COALESCE(s.rec, 0))::int                               AS rec,
           sum(COALESCE(s.rec_yds, 0))::int                           AS rec_yds,
           sum(COALESCE(s.rec_td, 0))::int                            AS rec_td,
           sum(COALESCE(s.fumbles_lost, 0))::int                      AS fumbles_lost,
           sum(COALESCE(s.fgm, 0))::int                               AS fgm,
           sum(COALESCE(s.fga, 0))::int                               AS fga,
           sum(COALESCE(s.xp, 0))::int                                AS xp
      FROM nfl_player_game_stats s
      JOIN matches m ON m.id = s.match_id
      JOIN leagues l ON l.id = m.league_id
     WHERE l.slug = 'nfl'
       AND m.season_phase = 'REG'
       -- FINALS ONLY. A game in progress is not in a per-game average.
       AND m.status = 'final'
       AND m.season_year = ANY(${window})
       AND s.nfl_player_id = ANY(${pids})
     GROUP BY s.nfl_player_id`;
  const byPid = new Map();
  for (const r of stats) {
    const gp = Number(r.gp);
    if (!Number.isFinite(gp) || gp <= 0) continue;
    const pts = fantasyPoints(toStatLine(r), 'ppr');
    byPid.set(Number(r.id), {
      gp, games: Number(r.gp_now) || 0,
      ppg: Math.round((Number.isFinite(pts) ? pts : 0) / gp * 10) / 10,
    });
  }

  const rows = ident.map((r) => {
    const st = byPid.get(Number(r.matched_player_id));
    return {
      ffcPlayerId: r.ffc_player_id,
      name: displayName(r, clubs),
      position: r.position,
      team: r.team,
      bye: r.bye,
      league: r.league ?? 'nfl',
      ncaafAdp: r.ncaaf_adp == null ? null : Number(r.ncaaf_adp),
      matchedPlayerId: Number(r.matched_player_id),
      // `=== true` because SQL hands back NULL for both "no match" and
      // "matched but rookie_season is NULL", and both must land as false.
      rookie: r.rookie === true,
      ppg: st?.ppg ?? null,
      windowGames: st?.gp ?? 0,
      games: st?.games ?? 0,
      priorRank: priorRank.get(String(r.ffc_player_id)) ?? null,
    };
  });

  const ranks = replacementRanks(rosterSlots ?? {}, teamsCount);
  const repl = replacementPpg(rows, ranks);
  for (const r of rows) r.vor = vorOf(r.ppg, repl[r.position] ?? null);

  const board = orderBoard(rows);
  const computedAt = new Date();
  return {
    computedAt,
    label: `Sportsvyn board · ${season}`,
    priorDate: ymd(prior?.snapshotDate ?? null),
    priorRows: prior?.rows ?? 0,
    replacementRanks: ranks,
    replacementPpg: repl,
    rows: board.map((r) => boardRow(r)),
  };
}

/**
 * ONE BOARD ROW, IN THE SHAPE THE ROOM ALREADY CONSUMES (mapPoolRow's).
 *
 * adp carries the board rank, in overall-pick units, because that is what
 * every downstream reader means by adp: valueGap subtracts it from a pick
 * number, adp_at_pick freezes it on the pick, grade.js differences the two.
 * adpHigh/adpLow/stdev/timesDrafted are NULL because we did not measure a
 * market - we computed a rank, and inventing a spread around it would be a
 * claim we cannot support.
 */
export function boardRow(r) {
  return {
    ffcPlayerId: r.ffcPlayerId,
    name: r.name,
    position: r.position,
    team: r.team,
    adp: r.adp,
    adpHigh: null,
    adpLow: null,
    timesDrafted: null,
    stdev: null,
    bye: r.bye,
    league: r.league ?? 'nfl',
    ncaafAdp: r.ncaafAdp ?? null,
    rookie: r.rookie === true,
    // Ours, and new: the two numbers the board was built from.
    vor: r.vor ?? null,
    ppg: r.ppg ?? null,
  };
}
