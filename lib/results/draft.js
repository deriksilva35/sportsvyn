// lib/results/draft.js - the Draft's results, in the one shape plus what only
// this game has: two ranks, and a pick that knows where it happened.
//
// THE CEILING HERE IS A REAL ENTRY, and that is a ruling, not a shortcut
// (lib/weekly/settle.js): every drafter has a DIFFERENT eight, so there is no
// shared pool to build a dream team from. contests.perfect =
// { score, entry_id, user_id, seat } names the best roster that actually
// existed. The mock's module is called "The best draft" for that reason.
//
// NOTHING IS REBUILT FROM THE ROOM'S PICK ORDER. draft_picks stores round,
// overall_pick and adp_at_pick on EVERY pick - 47,938 of 47,938, measured - so
// "1.06 · ADP 3 · taken 6th · +3 value" is four stored numbers and one
// subtraction. The pick WITHIN the round is overall_pick - (round-1)*teams,
// which needs the room size (drafts.pool_teams_count, 527 of 527) and not the
// order.

import { sql } from '../db.js';
import { draftFieldLeaderboard } from '../games/leaderboard.js';
import { header, distribution, axisFor, lastName, scoresOf, noEntryLine } from './shape.js';

/** One drafted player, with where it happened. PURE. */
export function pickRow(p, { teams = null, points = null, counted = false } = {}) {
  const overall = p?.overall_pick == null ? null : Number(p.overall_pick);
  const round = p?.round == null ? null : Number(p.round);
  const size = Number(teams) || null;
  // "1.06" - the round and the pick within it. A room size we do not have
  // leaves the pick-in-round absent rather than guessing twelve.
  const inRound = round != null && overall != null && size
    ? overall - (round - 1) * size : null;
  const adp = p?.adp_at_pick == null ? null : Number(p.adp_at_pick);
  // VALUE IS ADP MINUS WHERE HE WENT. Positive means he lasted longer than his
  // ADP said - value; negative means you took him early - a reach. adp_at_pick
  // is the ADP AS OF THE PICK, frozen, which is the only honest number for a
  // retrospective: today's ADP knows how the season went.
  const gap = adp != null && overall != null ? Math.round(adp - overall) : null;
  return {
    at: round != null && inRound != null ? `${round}.${String(inRound).padStart(2, '0')}` : null,
    round, overall, inRound,
    pos: p?.position ?? p?.roster_slot ?? null,
    name: p?.player_name ?? null,
    short: p?.player_name ? `${p.player_name.split(/\s+/)[0][0]}. ${lastName(p.player_name)}` : null,
    adp,
    takenLabel: overall == null ? null : `taken ${overall}${ordSuffix(overall)}`,
    gap,
    gapLabel: gap == null ? null : (gap === 0 ? 'at ADP' : gap > 0 ? `+${gap} value` : `${gap} reach`),
    reach: gap != null && gap < 0,
    points: points == null ? null : Math.round(Number(points) * 10) / 10,
    counted,
  };
}

const ordSuffix = (n) => {
  const i = Number(n); const teen = i % 100;
  if (teen >= 11 && teen <= 13) return 'th';
  return ({ 1: 'st', 2: 'nd', 3: 'rd' })[i % 10] ?? 'th';
};

/** One entry's eight picks, in draft order, with the started six marked. */
async function draftOf(entry, byId) {
  const draftId = entry?.meta?.draftId == null ? null : Number(entry.meta.draftId);
  if (!draftId) return { seat: null, teams: null, picks: [] };
  const [d] = await sql`
    SELECT pick_position AS seat, pool_teams_count AS teams FROM drafts WHERE id = ${draftId}`;
  const picks = await sql`
    SELECT round, overall_pick, roster_slot, ffc_player_id, player_name, position, adp_at_pick
      FROM draft_picks WHERE draft_id = ${draftId} ORDER BY overall_pick ASC`;
  // WHICH OF THE EIGHT SCORED. The entry's lineup is the STARTED six (best ball
  // starts the best of what was drafted); meta.roster carries the bridge from
  // the FFC pool to the scored board's ids.
  const started = new Set(Object.values(entry?.lineup ?? {}).map(String));
  const roster = entry?.meta?.roster ?? [];
  const idByName = new Map(roster.map((r) => [String(r.name ?? ''), String(r.id)]));
  // THIS SEAT'S PICKS, NOT THE ROOM'S. draft_picks holds every pick of the
  // draft - twelve seats by eight rounds is ninety-six rows - and the first cut
  // rendered all of them: the served page read "96 picks, 6 counted" over a list
  // that opened with three players the reader never had.
  //
  // THE ROSTER IS THE FILTER, not picked_by. meta.roster IS this entry's eight,
  // written at bridge time, and a player is taken once in a draft - so a name in
  // both places is this drafter's and nobody else's. picked_by would have worked
  // today ('ai' for the eleven simulated seats) and broken the moment two humans
  // shared a room.
  const mine = picks.filter((p) => idByName.has(String(p.player_name)));
  return {
    seat: d?.seat ?? null,
    teams: d?.teams ?? null,
    picks: (mine.length ? mine : picks).map((p) => {
      const boardId = idByName.get(String(p.player_name)) ?? null;
      const card = boardId ? byId.get(String(boardId)) : null;
      return pickRow(p, {
        teams: d?.teams ?? null,
        points: card?.points ?? null,
        counted: boardId != null && started.has(String(boardId)),
      });
    }),
  };
}

export async function draftResults(contestId, userId = null) {
  const [contest] = await sql`
    SELECT id, sport, season_year, week, settled, settled_at, perfect, board, meta
      FROM contests WHERE id = ${Number(contestId)} AND game_type = 'draft'`;
  if (!contest || !contest.settled) return null;
  const byId = new Map((contest.board ?? []).map((p) => [String(p.id), p]));

  const [mine] = userId == null ? [] : await sql`
    SELECT id, user_id, score, lineup, meta FROM contest_entries
     WHERE contest_id = ${Number(contestId)} AND user_id = ${Number(userId)}`;
  // THE BEST DRAFT IS NAMED BY THE STORED CEILING, not re-found here.
  const bestId = contest.perfect?.entry_id ?? null;
  const [best] = bestId == null ? [] : await sql`
    SELECT e.id, e.user_id, e.score, e.lineup, e.meta, u.handle, u.is_house
      FROM contest_entries e JOIN users u ON u.id = e.user_id WHERE e.id = ${Number(bestId)}`;

  const [mineDraft, bestDraft] = await Promise.all([
    mine ? draftOf(mine, byId) : Promise.resolve({ seat: null, teams: null, picks: [] }),
    best ? draftOf(best, byId) : Promise.resolve({ seat: null, teams: null, picks: [] }),
  ]);

  const all = await sql`
    SELECT score, meta FROM contest_entries WHERE contest_id = ${Number(contestId)}`;
  // scoresOf, NOT map(Number): Number(null) is 0 and 0 is finite - see shape.js.
  const scores = scoresOf(all);
  const dnf = all.filter((r) => r.score == null || r.meta?.dnf === true).length;
  const lb = await draftFieldLeaderboard(Number(contestId), userId == null ? null : Number(userId), { limit: 3 });

  const room = mine?.meta?.room ?? null;
  const ceiling = contest.perfect?.score ?? null;
  const dist = distribution(scores, { mine: mine?.score ?? null, ceiling, dnf });
  const num = (n) => String(Math.round(Number(n) * 10) / 10);

  return {
    game: 'draft',
    title: 'The Draft',
    subtitle: `${String(contest.sport).toUpperCase()} week ${contest.week}`,
    edition: `Contest ${contest.id} · ${lb.played} entries · settled`,
    // A DRAFT, NOT A WEEK: the contest is one room. `mine` is the reader's own
    // contest_entries row, so no row is no draft, and the best draft below is
    // still worth reading without one.
    played: mine != null,
    noEntryLine: noEntryLine('draft'),
    ceilingWord: 'best draft',
    header: header({
      rank: lb.self?.rank ?? lb.top.find((r) => r.userId === Number(userId))?.rank ?? null,
      of: lb.played, score: mine?.score ?? null, ceiling,
      pct: mine?.meta?.pct ?? null,
      // TWO RANKS, BOTH TRUE (the mock's own line). The room is what the reader
      // played in and is stored per entry at settle; the field is the context.
      roomRank: room?.rank ?? null, roomOf: room?.of ?? null,
      roomName: mine?.meta?.leagueName ?? null,
    }),
    seat: mineDraft.seat,
    teams: mineDraft.teams,
    myPicks: mineDraft.picks,
    bestPicks: bestDraft.picks,
    best: best ? {
      name: best.handle ?? `player ${best.user_id}`,
      house: best.is_house === true,
      seat: bestDraft.seat,
      score: Math.round(Number(best.score) * 10) / 10,
      counted: bestDraft.picks.filter((p) => p.counted).length,
      of: bestDraft.picks.length,
    } : null,
    toCeiling: mine?.score != null && ceiling != null
      ? Math.round((Number(mine.score) - Number(ceiling)) * 10) / 10 : null,
    field: {
      distribution: dist,
      axis: axisFor(dist, { mine: mine?.score ?? null, label: num }),
      median: dist.median,
      played: lb.played,
      dnf,
      rows: [...lb.top, ...(lb.self ? [lb.self] : [])].map((r) => ({
        rank: r.rank, name: r.name, house: r.house === true,
        you: userId != null && r.userId === Number(userId),
        score: Math.round(Number(r.score) * 10) / 10,
        pct: ceiling ? Math.round((Number(r.score) / Number(ceiling)) * 1000) / 10 : null,
        sub: [r.seat != null ? `seat ${r.seat}` : null, r.method ?? null].filter(Boolean).join(' · ') || null,
        seat: r.seat ?? null,
        userId: r.userId,
      })),
    },
  };
}
