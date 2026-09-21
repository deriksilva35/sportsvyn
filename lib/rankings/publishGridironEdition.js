// lib/rankings/publishGridironEdition.js - the computed gridiron board.
//
// WHAT IT REPLACES. nfl-power and cfb-top25 have each carried exactly ONE
// edition since 27 Jul 2026: edition 0, hand-authored from
// content/preseason-edition-0.md, whose `score` is literally 99.99 minus the
// rank. Every movement column on the product is blank because there has never
// been a second edition to move against. This publishes one, computed from
// finished games.
//
// THE PIPELINE, AND EVERY STEP OF IT IS SOMEBODY ELSE'S FUNCTION:
//   lib/ratings/elo.js          finals        -> a rating per team
//   gridironDims.js             rating        -> result + momentum, 0-10
//   teamPowerScorer.js          dims          -> editorial_composite (mean of
//                                                the dims actually scored)
//   sitesLayer.js               AP rank       -> ap_score on the same 0-10 curve
//   editionRunner.js            both          -> the outer blend
// Nothing here re-implements any of them. That is the point: the World Cup
// board has used this machinery for 21 editions and a second copy of the
// blend would be a second answer to "what is this team's number".
//
// EDITION 0 IS NEVER A PREVIOUS. Movement is computed against the last
// COMPUTED edition only. Diffing against the hand-seeded board would produce a
// column of enormous arrows on the first run that mean "the model disagrees
// with a human's July opinion", not "this team moved" - and it would say so
// once and never again, which is the worst kind of chart.
//
// IDEMPOTENT WITHIN A DAY. A re-run on the same UTC day REPLACES that day's
// edition rather than appending one, and takes its previous_rank from the
// edition before it. A cron that retries, or a hand re-run after a fix, must
// not leave two editions for one Monday and must not make the second one
// "moved zero places since this morning".
//
// THE CONSTANTS BELOW ARE CHOICES, NOT RULINGS. Nothing in this repository
// specifies k, hfa or the regression fraction for either league - there was no
// Elo here before this relay - so they are set here, in one block, with the
// reasoning written down, and they are the first thing to change if the board
// reads wrong. They are NOT threaded through as arguments, for the same reason
// sitesLayer.js keeps its curve constants local: a future change should be a
// one-file diff somebody can audit.

import { readFileSync, existsSync } from 'node:fs';
import { sql } from '../db.js';
import { runElo, deltaOverLast, lastResults, FCS_KEY, START_ELO } from '../ratings/elo.js';
import { gridironDims } from './gridironDims.js';
import { computeEditorialComposite } from './teamPowerScorer.js';
import { composeOuterScores } from './editionRunner.js';
import { normalizeRankToScore } from './sitesLayer.js';

/** The AP poll is a 25-team field, so that is the field size its curve uses. */
export const AP_FIELD_SIZE = 25;

/**
 * THE EDITOR'S LIST IS A 25-TEAM FIELD TOO, and goes through the same curve.
 * A separate constant from AP_FIELD_SIZE because they are separate facts that
 * happen to agree: if the editor ever writes a 40, this moves and the AP's
 * does not.
 */
export const EDITOR_FIELD_SIZE = 25;

/**
 * A PRESEASON POLL RANK, AS A RATING. normalizeRankToScore puts the rank on
 * the 0-10 dimension scale; this puts that score on the Elo scale so the
 * ladder can average it with a carried-forward rating.
 *
 *   anchor = START_ELO + (score - 5) * AP_ANCHOR_ELO_PER_POINT
 *
 * 40 POINTS PER SCORE POINT IS MY CHOICE, like k and hfa, and it is set by
 * looking at the spread it has to be comparable with: the CFB ladder runs
 * roughly 1285-1765 after two seasons, so +/-200 around 1500 is the band a
 * preseason opinion should occupy. 40 gives rank 1 -> 1700 and rank 25 ->
 * 1380 - a strong opinion without being an unanswerable one, since four
 * September results move a team further than its August anchor ever placed it.
 */
export const AP_ANCHOR_ELO_PER_POINT = 40;

export function anchorElo(apRank) {
  const score = normalizeRankToScore(apRank, AP_FIELD_SIZE);
  return score == null ? null : START_ELO + (score - 5) * AP_ANCHOR_ELO_PER_POINT;
}

export const LEAGUE_CONFIG = Object.freeze({
  nfl: {
    listSlug: 'nfl-power',
    // Every season PROD holds. 2002 is the first, and it is also the first
    // season of the current 32-team alignment, so the ladder never spans a
    // league that had a different number of teams in it.
    minSeason: 2002,
    // k 20 is the standard NFL value: with 17 games a season it converges
    // inside a season without a single result swinging a team two places.
    k: 20,
    // ~55 rating points is the long-run NFL home edge, a little under 2.5
    // points of spread.
    hfa: 55,
    // A third of the way back to 1500 each September - the usual NFL figure.
    // Rosters change less than college ones, so the carry-over is larger.
    regress: 1 / 3,
    // NO SITES LAYER. The NFL has no poll; there is no second source to blend,
    // so the editorial weight is 1.00 and saying otherwise would imply a blend
    // that never happens.
    editorialWeight: 1, sitesWeight: 0, usesAp: false,
  },
  cfb: {
    listSlug: 'cfb-top25',
    // PROD holds 2025 and 2026 only - there is no 2024 CFB season in the
    // database at all, so the ladder starts where the data starts.
    minSeason: 2025,
    // HIGHER k THAN THE NFL, deliberately: two seasons of data and twelve
    // games a year means a rating has far fewer results to settle from, and a
    // slower k would still be reading July on Halloween.
    k: 25,
    // College home fields are worth more than professional ones.
    hfa: 65,
    regress: 1 / 3,
    // 0.70/0.30 against the AP poll, the weights every team-power edition
    // before this one has used when it had a sites source.
    editorialWeight: 0.7, sitesWeight: 0.3, usesAp: true,
  },
});

export const METHODOLOGY_VERSION = '3.0';

const round2 = (n) => (n == null ? null : Math.round(Number(n) * 100) / 100);
const utcDay = (d = new Date()) => new Date(d).toISOString().slice(0, 10);

// ---------------------------------------------------------------- reads

/**
 * Every final this league's ladder is allowed to see, oldest first.
 * PRE IS EXCLUDED IN SQL AS WELL AS IN runElo - belt and braces, because the
 * 49 NFL 2026 PRE finals on PROD are the exact rows that would otherwise look
 * like real results, and dropping them at the query saves rating 49 games only
 * to discard them.
 */
export async function loadGames(league) {
  const cfg = LEAGUE_CONFIG[league];
  if (!cfg) throw new Error(`publishGridironEdition: unknown league '${league}'`);
  return sql`
    SELECT m.id, m.season_year AS season, m.season_phase AS phase, m.kickoff_at AS "kickoffAt",
           m.home_team_id AS "homeId", m.away_team_id AS "awayId",
           m.home_score AS "homeScore", m.away_score AS "awayScore",
           h.metadata->>'classification' AS "homeClass",
           a.metadata->>'classification' AS "awayClass"
      FROM matches m
      JOIN leagues l ON l.id = m.league_id AND l.slug = ${league}
      JOIN teams h ON h.id = m.home_team_id
      JOIN teams a ON a.id = m.away_team_id
     WHERE m.status = 'final'
       AND m.home_score IS NOT NULL AND m.away_score IS NOT NULL
       AND m.season_year >= ${cfg.minSeason}
       AND COALESCE(m.season_phase, '') <> 'PRE'
     ORDER BY m.kickoff_at ASC, m.id ASC`;
}

/** Every team in the league, with the classification the pooling rule reads. */
export async function loadTeams(league) {
  return sql`
    SELECT t.id, t.slug, t.name, t.short_name AS "shortName", t.abbreviation,
           t.metadata->>'classification' AS classification
      FROM teams t JOIN leagues l ON l.id = t.league_id AND l.slug = ${league}`;
}

/**
 * THE PRESEASON ANCHORS, per season: Map(season -> Map(team_id -> elo)).
 *
 * WEEK 1 IS THE PRESEASON POLL, and that is a fact about this data rather than
 * a convention assumed: PROD's 2026 week 1 was created 25 Aug, before the
 * slate's week 1 ran 29 Aug - 7 Sep, and every later week was published in the
 * gap after the previous week's games. So AP week N precedes slate week N, and
 * week 1 is the one written before anybody played.
 *
 * A SEASON WITH NO WEEK 1 SIMPLY HAS NO ANCHORS and is carried forward on
 * regression alone. PROD holds no AP poll for CFB 2025 at all, so 2025 starts
 * flat and 2026 is the first season the prior touches.
 */
export async function buildApAnchors(league) {
  if (!LEAGUE_CONFIG[league]?.usesAp) return new Map();
  const rows = await sql`
    SELECT season, team_id, rank FROM ap_rankings
     WHERE week = 1 AND season_type = 'regular'`;
  const out = new Map();
  for (const r of rows) {
    const elo = anchorElo(Number(r.rank));
    if (elo == null) continue;
    const season = Number(r.season);
    if (!out.has(season)) out.set(season, new Map());
    out.get(season).set(Number(r.team_id), elo);
  }
  return out;
}

/**
 * The newest AP week held, as a Map(team_id -> rank). CFB only - the NFL has
 * no poll and asking for one would return an empty map that reads the same as
 * "the poll is missing", which are different problems.
 */
export async function loadApWeek() {
  const [latest] = await sql`
    SELECT season, max(week) AS week FROM ap_rankings
     WHERE season_type = 'regular' GROUP BY season ORDER BY season DESC LIMIT 1`;
  if (!latest) return { season: null, week: null, byTeam: new Map() };
  const rows = await sql`
    SELECT team_id, rank FROM ap_rankings
     WHERE season = ${latest.season} AND week = ${latest.week} AND season_type = 'regular'`;
  return {
    season: latest.season, week: latest.week,
    byTeam: new Map(rows.map((r) => [Number(r.team_id), Number(r.rank)])),
  };
}

/**
 * The last COMPUTED edition of a list, and whether it is today's.
 * Edition 0 is excluded by methodology_version: the hand-seeded boards are
 * '1.0', every edition this file writes is METHODOLOGY_VERSION.
 */
export async function loadPriorComputedEdition(listSlug) {
  const [ed] = await sql`
    SELECT rd.id, rd.edition_number, rd.published_at
      FROM ranking_editions rd
      JOIN ranking_lists rl ON rl.id = rd.ranking_list_id
     WHERE rl.slug = ${listSlug} AND rd.methodology_version = ${METHODOLOGY_VERSION}
     ORDER BY rd.edition_number DESC LIMIT 1`;
  if (!ed) return null;
  const entries = await sql`
    SELECT team_id, rank, score FROM ranking_entries WHERE ranking_edition_id = ${ed.id}`;
  return {
    id: ed.id,
    editionNumber: ed.edition_number,
    publishedAt: ed.published_at,
    isToday: ed.published_at != null && utcDay(ed.published_at) === utcDay(),
    byTeam: new Map(entries.filter((e) => e.team_id != null)
      .map((e) => [Number(e.team_id), { rank: e.rank, score: e.score == null ? null : Number(e.score) }])),
  };
}

/** The highest edition_number on a list, computed or not. */
export async function loadLastEditionNumber(listSlug) {
  const [r] = await sql`
    SELECT max(rd.edition_number) AS n FROM ranking_editions rd
      JOIN ranking_lists rl ON rl.id = rd.ranking_list_id WHERE rl.slug = ${listSlug}`;
  return r?.n == null ? -1 : Number(r.n);
}

// ----------------------------------------------------------- the editor

/**
 * THE EDITOR'S 25, PARSED. `# heading` and blank lines are skipped; every
 * other line is `<rank> <team name>`.
 *
 * PURE, so the parse can be tested without a file or a database, and so the
 * error messages below are reachable from a test rather than only from a
 * failed cron at six in the morning.
 *
 * A LINE THAT IS NOT A RANK AND A NAME IS A FAILURE, not a skipped line. This
 * file is twenty-five lines a person types by hand; the single most likely
 * defect in it is a typo, and a parser that shrugged at one would publish a
 * 24-team editorial layer and say nothing.
 */
export function parseEditorList(text) {
  const rows = [];
  const seenRanks = new Set();
  let lineNo = 0;
  for (const raw of String(text ?? '').split('\n')) {
    lineNo += 1;
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const m = line.match(/^(\d+)[.)]?\s+(.+)$/);
    if (!m) throw new Error(`editor list line ${lineNo}: expected "<rank> <team>", got ${JSON.stringify(line)}`);
    const rank = Number(m[1]);
    const name = m[2].trim();
    if (seenRanks.has(rank)) throw new Error(`editor list line ${lineNo}: rank ${rank} appears twice`);
    seenRanks.add(rank);
    rows.push({ rank, name });
  }
  return rows;
}

/**
 * NAMES TO TEAM IDS, EXACTLY, SCOPED TO THE LEAGUE - the rule
 * scripts/ranking-entries-resolve-teams.mjs already states and the reason it
 * gives: "St. Francis" is three different schools and a loose comparison is
 * how a Pennsylvania row ends up attached to an Indiana club. Case-insensitive
 * because that is not ambiguity, it is typing.
 *
 * A MISS IS FATAL HERE, and that is the one place this differs from the
 * resolver script. That script is fixing up rows that already exist and can
 * leave one null; this is BUILDING a dimension, and a name that resolves to
 * nothing would silently drop a team the editor deliberately ranked - moving
 * every team below it up one, with no error anywhere. It throws, naming every
 * miss at once so a person fixing the file fixes all of them in one pass.
 */
export function resolveEditorRows(rows, teams) {
  const byName = new Map();
  for (const t of teams ?? []) {
    for (const key of [t.name, t.shortName]) {
      if (key) byName.set(String(key).trim().toLowerCase(), t);
    }
  }
  const out = [];
  const misses = [];
  for (const r of rows) {
    const hit = byName.get(r.name.toLowerCase());
    if (!hit) { misses.push(`#${r.rank} ${JSON.stringify(r.name)}`); continue; }
    out.push({ ...r, teamId: Number(hit.id), abbreviation: hit.abbreviation ?? null });
  }
  if (misses.length) {
    throw new Error(`editor list: ${misses.length} name(s) match no team in this league: ${misses.join(', ')}`);
  }
  return out;
}

/** content/power/<league>-<season>-w<week>.md, or null when there is none. */
export function editorFilePath(league, season, week) {
  if (season == null || week == null) return null;
  return new URL(`../../content/power/${league}-${season}-w${week}.md`, import.meta.url);
}

/**
 * THE EDITOR'S LAYER FOR ONE EDITION: Map(team_id -> { rank, score }).
 *
 * NO FILE IS NOT AN ERROR. The NFL has no editor list and never will under
 * this relay; a CFB week whose file has not been written yet publishes on the
 * model alone, which is a weaker board and not a broken one. A file that
 * EXISTS and does not parse, or names a team that does not exist, IS an error
 * - the difference is between "the editor did not write one" and "the editor
 * wrote one and we could not read it".
 */
export function buildEditorLayer({ text = null, teams = [] } = {}) {
  if (text == null) return { rows: [], byTeam: new Map(), present: false };
  const resolved = resolveEditorRows(parseEditorList(text), teams);
  const byTeam = new Map(resolved.map((r) => [r.teamId, {
    rank: r.rank, score: normalizeRankToScore(r.rank, EDITOR_FIELD_SIZE),
  }]));
  return { rows: resolved, byTeam, present: true };
}

// ------------------------------------------------------------ the build

/**
 * COMPETITION RANKING: equal scores SHARE a rank and the next rank skips.
 * 1, 2, 2, 4 - never 1, 2, 3, 4 with an arbitrary tiebreak, because two teams
 * on the same number are on the same number and inventing an order between
 * them would be the board's only unexplainable fact.
 */
export function rankBySort(rows) {
  const sorted = [...rows].sort((a, b) => (b.score - a.score) || (a.teamId - b.teamId));
  let rank = 0; let seen = 0; let last = null;
  for (const r of sorted) {
    seen += 1;
    if (last == null || r.score !== last) { rank = seen; last = r.score; }
    r.rank = rank;
  }
  return sorted;
}

/**
 * PURE. Ratings + poll -> the rows an edition is made of. Separated from every
 * read and every write so the dry run and the real publish compute the SAME
 * numbers from the same function, and so this can be tested without a database.
 *
 * @param table     runElo()'s Map(key -> {elo, history})
 * @param teams     loadTeams()'s rows
 * @param apByTeam  Map(team_id -> AP rank), empty for the NFL
 * @param cfg       a LEAGUE_CONFIG entry
 */
export function buildEntries({ table, teams = [], apByTeam = new Map(), editorByTeam = new Map(), cfg }) {
  const meta = new Map(teams.map((t) => [Number(t.id), t]));
  const label = (key) => (key === FCS_KEY ? FCS_KEY : (meta.get(Number(key))?.abbreviation ?? String(key)));

  // THE FIELD IS THE RATED, PUBLISHABLE TEAMS. The FCS pool is rated - it is
  // what gives an FBS team's win over it a meaning - but it is not a team, so
  // it is not an entry and it is not in the field the z-scores are taken over.
  const rated = [];
  for (const [key, row] of table) {
    if (key === FCS_KEY) continue;
    const t = meta.get(Number(key));
    if (!t) continue;
    if (String(t.classification ?? '').toLowerCase() === 'fcs') continue;
    rated.push({ teamId: Number(key), team: t, elo: row.elo, history: row.history });
  }
  const eloField = rated.map((r) => r.elo);
  const delta3Field = rated.map((r) => deltaOverLast(r.history, 3)).filter((v) => v != null);

  const scorerResults = [];
  const detail = new Map();
  for (const r of rated) {
    const delta3 = deltaOverLast(r.history, 3);
    const parsed = gridironDims({ elo: r.elo, delta3, eloField, delta3Field });
    const ed = editorByTeam.get(r.teamId) ?? null;
    const editorRank = ed?.rank ?? null;
    const editorScore = ed?.score ?? null;
    // THE COMPOSITE IS RESULT AND THE EDITOR, FLAT, AND MOMENTUM IS NO LONGER
    // IN IT. Momentum is still computed, still stored in elo_delta3 and
    // momentum_score, and still shown in the expanded row - but averaging it
    // with result gave it half the ranking, and a 1418-rated team was third in
    // the NFL on nothing but a hot three weeks. It is a thing to look at, not
    // half of what a team IS.
    //   ranked by the editor  ->  mean(result, editor_score)
    //   below the 25          ->  result alone
    // computeEditorialComposite averages over the dims NAMED as scored, so
    // "below the 25" is expressed by not naming the editor dimension rather
    // than by passing it a zero.
    const compositeDims = { result: parsed.dims.result, editor: editorScore };
    const compositeScored = ['result', 'editor'].filter((d) => compositeDims[d] != null);
    const editorial = computeEditorialComposite({ dims: compositeDims, scored_dims: compositeScored });
    const apRank = cfg.usesAp ? (apByTeam.get(r.teamId) ?? null) : null;
    const apScore = apRank == null ? null : normalizeRankToScore(apRank, AP_FIELD_SIZE);
    scorerResults.push({
      ok: editorial != null, teamId: r.teamId,
      team_name: r.team.shortName ?? r.team.name, editorial_composite: editorial, parsed,
    });
    detail.set(r.teamId, {
      elo: round2(r.elo), delta3: round2(delta3), apRank, apScore, editorRank, editorScore,
      last3: lastResults(r.history, 3, label), parsed,
      compositeDims, compositeScored,
    });
  }

  // THE OUTER BLEND IS editionRunner's, weights and all. sites_composite is
  // NOT used to carry the AP score: it is a MEAN OVER SOURCES, and a mean over
  // one source implies a blend that does not exist here. The AP score is put
  // in the map's sites_composite slot because that is the field the composer
  // reads, and it is stored on the row as ap_score - its real name.
  const sitesMap = new Map();
  for (const [teamId, d] of detail) {
    if (d.apScore != null) sitesMap.set(teamId, { sites_composite: d.apScore });
  }
  const composed = composeOuterScores({
    scorerResults, sitesMap,
    editorial_weight: cfg.editorialWeight, sites_weight: cfg.sitesWeight,
  });

  const rows = composed.map((c) => {
    const d = detail.get(c.teamId);
    return {
      teamId: c.teamId,
      abbreviation: meta.get(c.teamId)?.abbreviation ?? null,
      name: c.team_name,
      score: c.score,
      editorialComposite: c.editorial_composite,
      dims: d.parsed.dims,
      scoredDims: d.parsed.scored_dims,
      heldDims: d.parsed.held_dims,
      elo: d.elo, delta3: d.delta3, apRank: d.apRank, apScore: d.apScore,
      editorRank: d.editorRank, editorScore: d.editorScore,
      compositeDims: d.compositeDims, compositeScored: d.compositeScored,
      inputs: {
        elo: d.elo,
        delta3: d.delta3,
        last3: d.last3,
        ap: d.apRank == null ? null : { rank: d.apRank, score: d.apScore },
        // THE EDITOR LINE. null where the editor did not rank the team, which
        // is most of a 138-team field - the same shape `ap` uses, so a reader
        // of the blob does not have to learn two conventions for "absent".
        editor: d.editorRank == null ? null : { rank: d.editorRank, score: d.editorScore },
        // WHAT THE COMPOSITE WAS ACTUALLY AVERAGED OVER, and what came out.
        // A reader who can see "result, editor -> 8.4" can check the mean in
        // their head; a reader shown only the final number cannot.
        composite: { dims: d.compositeScored, values: d.compositeDims, value: c.editorial_composite },
        weights: { editorial: cfg.editorialWeight, sites: cfg.sitesWeight },
      },
    };
  });
  return rankBySort(rows);
}

/** previous_rank / previous_score / movement, from the prior COMPUTED edition only. */
export function applyMovement(rows, prior) {
  for (const r of rows) {
    const p = prior?.byTeam?.get(r.teamId) ?? null;
    r.previousRank = p?.rank ?? null;
    r.previousScore = p?.score ?? null;
    // POSITIVE MEANS CLIMBED, the convention lib/cfb/rankings.js already uses.
    r.rankMovement = p?.rank == null ? null : p.rank - r.rank;
    r.scoreMovement = p?.score == null ? null : round2(r.score - p.score);
    r.movementLabel = r.rankMovement == null ? 'new'
      : r.rankMovement > 0 ? 'up' : r.rankMovement < 0 ? 'down' : 'hold';
  }
  return rows;
}

// --------------------------------------------------------------- publish

/**
 * COMPUTE, and optionally WRITE, one league's edition.
 *
 * @param league 'nfl' | 'cfb'
 * @param apply  false (the default) computes everything and writes NOTHING -
 *               that is the dry run, and it is the same code path, so what it
 *               prints is what a real run would store.
 * @param now    injectable for tests; decides which UTC day "today" is.
 */
export async function publish({ league, apply = false, now = new Date() } = {}) {
  const cfg = LEAGUE_CONFIG[league];
  if (!cfg) throw new Error(`publishGridironEdition: unknown league '${league}'`);

  const [games, teams] = await Promise.all([loadGames(league), loadTeams(league)]);
  const ap = cfg.usesAp ? await loadApWeek() : { season: null, week: null, byTeam: new Map() };
  // THE PRESEASON PRIOR. Anchors are per season and only the ladder uses them;
  // a league with no poll gets an empty map and the ladder behaves exactly as
  // it did before this existed.
  const anchors = await buildApAnchors(league);
  const table = runElo({ games, k: cfg.k, hfa: cfg.hfa, regress: cfg.regress, anchors });
  // THE EDITOR'S LIST, keyed to the edition being published: the AP week is
  // what names it, because that is the week the board is FOR.
  const editorUrl = editorFilePath(league, ap.season, ap.week);
  const editorText = editorUrl && existsSync(editorUrl) ? readFileSync(editorUrl, 'utf8') : null;
  const editor = buildEditorLayer({ text: editorText, teams });
  const prior = await loadPriorComputedEdition(cfg.listSlug);
  const rows = applyMovement(
    buildEntries({ table, teams, apByTeam: ap.byTeam, editorByTeam: editor.byTeam, cfg }), prior);

  const summary = {
    league,
    listSlug: cfg.listSlug,
    games: games.length,
    rated: table.size,
    entries: rows.length,
    fcsPool: table.has(FCS_KEY) ? round2(table.get(FCS_KEY).elo) : null,
    anchors: [...anchors.entries()].map(([season, m]) => ({ season, teams: m.size })),
    editor: {
      file: editorUrl ? editorUrl.pathname.split('/content/')[1] : null,
      present: editor.present, ranked: editor.byTeam.size,
    },
    ap: cfg.usesAp ? { season: ap.season, week: ap.week, ranked: ap.byTeam.size } : null,
    weights: { editorial: cfg.editorialWeight, sites: cfg.sitesWeight },
    prior: prior ? { editionNumber: prior.editionNumber, isToday: prior.isToday } : null,
    replacedToday: Boolean(prior?.isToday),
    applied: false,
  };
  if (!apply) return { summary, rows };

  // ---- the write ----------------------------------------------------------
  const [list] = await sql`SELECT id FROM ranking_lists WHERE slug = ${cfg.listSlug} LIMIT 1`;
  if (!list) throw new Error(`publishGridironEdition: no ranking_list '${cfg.listSlug}'`);

  // IDEMPOTENT WITHIN A DAY. Today's computed edition is deleted and its
  // NUMBER reused, so a retry does not leave two Mondays on the board. Movement
  // was already taken from `prior`, which in that case is today's edition -
  // wrong - so it is recomputed against the one before it.
  let editionNumber;
  if (prior?.isToday) {
    editionNumber = prior.editionNumber;
    const before = await sql`
      SELECT rd.id, rd.edition_number FROM ranking_editions rd
        JOIN ranking_lists rl ON rl.id = rd.ranking_list_id
       WHERE rl.slug = ${cfg.listSlug} AND rd.methodology_version = ${METHODOLOGY_VERSION}
         AND rd.edition_number < ${prior.editionNumber}
       ORDER BY rd.edition_number DESC LIMIT 1`;
    const beforeRows = before.length
      ? await sql`SELECT team_id, rank, score FROM ranking_entries WHERE ranking_edition_id = ${before[0].id}`
      : [];
    applyMovement(rows, {
      byTeam: new Map(beforeRows.filter((e) => e.team_id != null)
        .map((e) => [Number(e.team_id), { rank: e.rank, score: e.score == null ? null : Number(e.score) }])),
    });
    await sql`DELETE FROM ranking_editions WHERE id = ${prior.id}`;
    summary.replacedEditionId = prior.id;
  } else {
    editionNumber = (await loadLastEditionNumber(cfg.listSlug)) + 1;
  }

  const [edition] = await sql`
    INSERT INTO ranking_editions
      (ranking_list_id, edition_number, edition_label, methodology_version,
       editorial_weight, sites_weight, user_weight, status, is_current, published_at, notes)
    VALUES (${list.id}, ${editionNumber}, ${editionLabel(league, ap, now)}, ${METHODOLOGY_VERSION},
            ${cfg.editorialWeight}, ${cfg.sitesWeight}, 0.00, 'published', false, now(),
            ${JSON.stringify({ k: cfg.k, hfa: cfg.hfa, regress: cfg.regress, games: games.length, ap: summary.ap })})
    RETURNING id`;

  for (const r of rows) {
    await sql`
      INSERT INTO ranking_entries
        (ranking_edition_id, entity_type, team_id, rank, score,
         previous_rank, rank_movement, previous_score, score_movement, movement_label,
         result_score, momentum_score, editorial_composite, selection_label,
         elo, elo_delta3, ap_rank, ap_score, editor_rank, editor_score, inputs)
      VALUES
        (${edition.id}, 'team', ${r.teamId}, ${r.rank}, ${r.score},
         ${r.previousRank}, ${r.rankMovement}, ${r.previousScore}, ${r.scoreMovement}, ${r.movementLabel},
         ${r.dims.result}, ${r.dims.momentum}, ${r.editorialComposite}, ${r.name},
         ${r.elo}, ${r.delta3}, ${r.apRank}, ${r.apScore},
         ${r.editorRank}, ${r.editorScore}, ${JSON.stringify(r.inputs)}::jsonb)`;
  }

  // THE FLIP IS LAST AND IT IS TWO STATEMENTS IN ONE ORDER: clear, then set.
  // A published edition nobody is reading is harmless; two current editions,
  // or none, is a board that renders twice or not at all.
  await sql`
    UPDATE ranking_editions SET is_current = false, updated_at = now()
     WHERE ranking_list_id = ${list.id} AND id <> ${edition.id} AND is_current`;
  await sql`
    UPDATE ranking_editions SET is_current = true, updated_at = now() WHERE id = ${edition.id}`;

  // THE DENORMALISED COLUMNS, for the ranked field only. migration 017 added
  // them for exactly this and nothing has ever written them; components/team/
  // TeamHero.js renders all three the moment they are non-null. The FCS pool
  // is not a team and every FCS row is left exactly as it was.
  for (const r of rows) {
    await sql`
      UPDATE teams SET current_power_rank = ${r.rank}, current_power_score = ${r.score},
             current_rank_movement = ${r.rankMovement}, updated_at = now()
       WHERE id = ${r.teamId}`;
  }

  summary.applied = true;
  summary.editionId = edition.id;
  summary.editionNumber = editionNumber;
  return { summary, rows };
}

/** "Week 4 · AP week 3" for CFB, "2026 Week 3" shape for the NFL. */
export function editionLabel(league, ap, now = new Date()) {
  const day = utcDay(now);
  return ap?.week != null ? `Computed ${day} · AP week ${ap.week}` : `Computed ${day}`;
}
