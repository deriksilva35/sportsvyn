// lib/gridiron/gamePageArcadeView.js - every read the arcade game page makes,
// assembled into one plain object for components/gridiron/GamePageArcade.js.
//
// The route resolves the game, the viewer and the shell; this does the rest,
// in one Promise.all where the reads are independent, each read caught - a
// module whose read fails is a module that is not drawn. The component is
// then a pure function of this object, which is what lets the proof shots
// render it from read-only PROD rows when DEV has no live game.

import { gamecastFor } from './playsImport.js';
import { simulateAsOf, lastActionPlay } from './driveStrip.js';
import { regTeamTables } from './regLines.js';
import { getH2hOdds, getSpreadHome, getTotalPoints } from './oddsReader.js';
import { isPreGame, showsProps } from './oddsFormat.js';
import { propsSlate } from '../market/reads.js';
import { getTeamRecordChip } from '../standings/read.js';
import { currentApRanks } from '../cfb/rankings.js';
import { cfbBoxScoreFor } from '../cfb/boxScore.js';
import { lineFor } from '../scores/expand.js';
import { driveStripFor } from './scoresV2Shape.js';
import { liveWinProbView } from '../../components/gridiron/LiveWinProb.js';
import { inYourGames } from './inYourGames.js';
import { scoringSummary } from './scoringSummary.js';
import {
  pageState, arcadeModules, liveChips, scoreChanges, gameLeaders, cfbLeaders, closingLine,
  curvePoints, curvePath, wpNow, lineFromPlays, elapsedAt, gameOrder, winProbRows, playsFeed,
  networkFor, etWeekday, winProbShown,
} from './gamePageArcade.js';

const caught = (p, fallback) => Promise.resolve(p).catch(() => fallback);

/** The top passer of the night, for the final card's moment - statLineText()'s input. */
function topPasser(rows) {
  const qb = (rows ?? []).filter((r) => Number(r.pass_att) > 0)
    .sort((a, b) => Number(b.pass_yds ?? 0) - Number(a.pass_yds ?? 0))[0];
  return qb ? { name: qb.full_name, passCmp: qb.pass_cmp, passAtt: qb.pass_att, passYds: qb.pass_yds, passTd: qb.pass_td } : null;
}

/**
 * @param game      getGamePage(slug)
 * @param viewerId  the signed-in user id, or null
 * @param asOf      ?asOf=N - replays a stored game as it stood after N plays (the dark page's own tool)
 * @param allPlays  ?plays=all - the whole feed in the Plays section
 */
export async function arcadeGameView({ game, viewerId = null, asOf = null, allPlays = false, signinHref = '/signin', now = new Date() }) {
  const league = game.leagueSlug;
  const homeId = game.home?.id ?? null, awayId = game.away?.id ?? null;
  const gamecast = await caught(gamecastFor(game.id), null);
  const sim = simulateAsOf(gamecast?.plays ?? [], asOf);
  const simulated = sim.simulated;
  const status = simulated ? 'live' : game.status;
  const state = pageState(status);
  const nfl = league === 'nfl';

  const [reg, cfbBox, odds, spreads, totals, props, records, ap, network, wpRows, feed] = await Promise.all([
    nfl && !game.lines?.length ? caught(regTeamTables(game.id), null) : null,
    !nfl && game.status !== 'scheduled' ? caught(cfbBoxScoreFor(game.id, game.status), null) : null,
    isPreGame(status) ? caught(getH2hOdds([game.id]), new Map()) : new Map(),
    state !== 'final' ? caught(getSpreadHome([game.id]), new Map()) : new Map(),
    state !== 'final' ? caught(getTotalPoints([game.id]), new Map()) : new Map(),
    showsProps(status) && !simulated ? caught(propsSlate({ matchIds: [game.id] }), []) : [],
    Promise.all([
      caught(getTeamRecordChip(league, homeId, game.seasonYear), null),
      caught(getTeamRecordChip(league, awayId, game.seasonYear), null),
    ]),
    !nfl ? caught(currentApRanks(), { ranks: new Map() }) : { ranks: new Map() },
    caught(networkFor(game.id), null),
    // NFL ONLY, and only where the page will draw it (lib/winprob/live.js DISPLAYED).
    winProbShown(league) && state !== 'pre' ? caught(winProbRows(game.id), []) : [],
    state === 'live' && !simulated ? caught(playsFeed(game.id), { latest: [], total: 0 }) : null,
  ]);

  // ---- the stat rows: NFL from regTeamTables, CFB from its box score ------
  const statRows = reg?.rows ?? [];
  const sideTables = nfl
    ? [{ side: 'away', abbr: game.away?.abbreviation, tables: reg?.tables.get(awayId) ?? [] },
      { side: 'home', abbr: game.home?.abbreviation, tables: reg?.tables.get(homeId) ?? [] }]
    : ['away', 'home'].map((side) => {
      const t = side === 'home' ? game.home : game.away;
      const hit = (cfbBox?.teams ?? []).find((b) => b.name === t?.name || b.name === t?.short_name);
      return { side, abbr: t?.abbreviation, tables: hit?.tables ?? [] };
    });
  const hasBox = sideTables.some((t) => t.tables.length);

  // ---- the simulated cut: the game as it stood after play N --------------
  const ordered = gameOrder(sim.plays);
  // The score at the cut is the last score CHANGE, not the last row's score:
  // a stoppage row can carry a stale 0-0 (see scoreChanges).
  const lastScored = simulated ? scoreChanges(sim.plays).at(-1) ?? null : null;
  const lastSnap = ordered.at(-1) ?? null;
  const g = {
    ...game,
    status,
    homeScore: simulated ? (lastScored?.homeScore ?? 0) : game.homeScore,
    awayScore: simulated ? (lastScored?.awayScore ?? 0) : game.awayScore,
    liveState: simulated ? { period: lastSnap?.period ?? null, clock: lastSnap?.clock ?? null } : game.liveState,
    network,
    etWeekday: etWeekday(game.kickoffAt),
    home: { ...game.home, shortName: game.home?.short_name ?? null },
    away: { ...game.away, shortName: game.away?.short_name ?? null },
  };

  // ---- the card's extras: /scores' `x`, filled from this page's reads ----
  const x = {
    rank: { home: ap.ranks?.get?.(homeId) ?? null, away: ap.ranks?.get?.(awayId) ?? null },
    record: { home: records[0], away: records[1] },
    spreadHome: spreads.get(game.id) ?? null, total: totals.get(game.id) ?? null, openHome: null,
    preview: null,
    drive: state === 'live' ? driveStripFor({ plays: sim.plays, game: g }) : null,
    diamond: null,
    stat: state === 'final' ? topPasser(statRows) ?? (cfbBox ? cfbTopPasser(sideTables) : null) : null,
    hasStats: hasBox, mlbFoot: null, probables: null, prob: null,
    stake: null, open: false,
    line: simulated ? lineFromPlays(sim.plays, g) : lineFor(g),
    closing: state === 'final' ? closingLine(game.marketPrior, g) : null,
    // THE LAST PLAY ON THE CARD (thu-5): the board's field strip carries it in
    // x.drive.lastPlay; when no down can be named (driveStripFor returns null
    // after a score or a turnover) the page's card still says what happened.
    lastPlay: state === 'live' ? (lastActionPlay(sim.plays)?.text ?? null) : null,
  };

  // ---- win probability (NFL) ---------------------------------------------
  const upTo = simulated && lastSnap ? elapsedAt(lastSnap.period, lastSnap.clock) : null;
  const curve = curvePoints(wpRows, { upTo });
  const liveView = state === 'live' && !simulated ? liveWinProbView(game.liveState, now) : null;
  const lastP = curve.points.at(-1)?.p ?? null;
  const nowRead = liveView ? wpNow(liveView.home / 100, g) : state === 'live' ? wpNow(lastP, g) : null;
  const winner = state === 'final'
    ? (Number(g.homeScore) > Number(g.awayScore) ? g.home : Number(g.awayScore) > Number(g.homeScore) ? g.away : null)
    : null;
  const winprob = winProbShown(league) && (curve.points.length >= 2 || nowRead) ? {
    path: curve.points.length >= 2 ? curvePath(curve) : null,
    marks: [900, 1800, 2700].map((s) => Math.round((s / curve.end) * 3580) / 10),
    dot: curve.points.length ? curvePath({ points: [curve.points.at(-1)], end: curve.end }) : null,
    now: state === 'final' ? (winner ? `${winner.abbreviation} won` : 'Tie') : nowRead ? `${nowRead.abbr} ${nowRead.pct}%` : null,
    stale: Boolean(liveView?.stale),
    homeAbbr: game.home?.abbreviation, awayAbbr: game.away?.abbreviation,
    ot: curve.end > 3600,
  } : null;

  // ---- in your games ----------------------------------------------------
  // Signed out it still reads the week's contests: the "Play this game" card
  // offers only what is OPEN for this match (thu-5), and nothing is after kickoff.
  const yourData = await caught(inYourGames({
    userId: viewerId,
    game: { ...game, status: g.status, homeScore: g.homeScore, awayScore: g.awayScore },
    statRows: simulated ? [] : statRows, now,
  }), { rows: [], open: [] });
  const yours = {
    signedIn: viewerId != null, rows: yourData.rows, open: yourData.open, pre: state === 'pre',
    playHref: viewerId != null ? (yourData.open[0]?.href ?? null) : signinHref,
  };

  // ---- live sections behind the chips -------------------------------------
  const abbrOf = (id) => (id === homeId ? game.home?.abbreviation : id === awayId ? game.away?.abbreviation : null);
  const playsAll = gameOrder(sim.plays).reverse();
  const plays = simulated || allPlays
    ? { latest: allPlays ? playsAll : playsAll.slice(0, 5), total: sim.plays.length, all: Boolean(allPlays) }
    : { ...(feed ?? { latest: [], total: 0 }), all: false };
  plays.latest = plays.latest.map((p) => ({ when: whenOf(p), abbr: abbrOf(p.offenseTeamId) ?? '', text: p.text ?? '' }));
  const leaders = nfl ? gameLeaders(statRows, { homeId, awayId }) : cfbLeaders(sideTables);
  const teamBox = game.teamBox && Object.keys(game.teamBox).length ? game.teamBox : null;
  const propsCard = props?.[0] ?? null;
  // A REPLAY SHOWS NO BOX AND NO STATS: the stored rows are the end of the
  // game, and a box score beside "Q2 4:10" would be the final's numbers.
  const chips = state === 'live' ? liveChips({
    plays: plays.total, box: hasBox && !simulated, stats: (leaders.length > 0 || Boolean(teamBox)) && !simulated,
    market: Boolean(propsCard || closingLine(game.marketPrior, g)),
  }) : [];

  // ONE LINE PER SCORE (thu-5): the summary is parsed from the play's own
  // sentence (lib/gridiron/scoringSummary.js), never the raw paragraph.
  const scoring = state === 'final'
    ? scoreChanges(gamecast?.plays ?? []).map((s) => ({ ...s, summary: scoringSummary(s.text, { playType: s.playType }) }))
    : [];
  const h2h = odds.get?.(game.id) ?? null;
  const modules = arcadeModules({
    state, league, hasCurve: curve.points.length >= 2, hasNow: Boolean(nowRead),
    hasMarket: Boolean(h2h), hasYours: yours.rows.length > 0 || yours.open.length > 0,
    hasScoring: scoring.length > 0, hasLeaders: leaders.length > 0,
  });

  return {
    state, league, simulated, modules,
    g, x, signinHref,
    odds: h2h, winprob, yours,
    chips, plays, box: sideTables.filter((t) => t.tables.length), leaders, teamBox,
    market: { closing: closingLine(game.marketPrior, g), propsCard },
    scoring,
    crumb: [league.toUpperCase(), game.week != null ? `Week ${game.week}` : null, g.etWeekday].filter(Boolean).join(' · '),
  };
}

/** "Q3 6:42" for a play row. */
function whenOf(p) {
  const per = Number(p.period);
  const q = !Number.isFinite(per) ? '' : per >= 5 ? (per === 5 ? 'OT' : `OT${per - 4}`) : `Q${per}`;
  return [q, p.clock].filter(Boolean).join(' ');
}

/** CFB's top passer from its passing tables (cells: C/ATT, YDS, TD, INT). */
function cfbTopPasser(sideTables) {
  const rows = sideTables.flatMap((t) => t.tables.find((x) => x.group === 'passing')?.rows ?? []);
  const top = rows.sort((a, b) => Number(b.cells?.[1] ?? 0) - Number(a.cells?.[1] ?? 0))[0];
  if (!top) return null;
  const [cmp, att] = String(top.cells[0] ?? '').split('/');
  return { name: top.name, passCmp: Number(cmp), passAtt: Number(att), passYds: Number(top.cells[1]), passTd: Number(top.cells[2]) || 0 };
}

