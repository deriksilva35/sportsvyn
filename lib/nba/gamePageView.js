// lib/nba/gamePageView.js - every read the NBA game page makes, assembled into
// the one object components/gridiron/GamePageArcade.js draws (nba-card, thu-37).
//
// THE ARCADE GAME PAGE'S STRUCTURE, NOT A COPY OF IT: the same component, the
// same card (CardFace, onPage), the same In your games / chips / leaders
// modules - fed basketball's reads and basketball's pure shaping
// (lib/nba/card.js). The gridiron view (lib/gridiron/gamePageArcadeView.js)
// is the model: one Promise.all, each read caught, a module whose read fails
// is a module not drawn.
//
// NOT HERE, by ruling: win probability (no basketball model, no module), the
// Live Activity (lib/push/liveActivityState.js liveActivitySupported stays
// false for nba), per-basket push.

import { getSpreadHome, getTotalPoints, getH2hOdds } from '../gridiron/oddsReader.js';
import { getTeamRecordChip } from '../standings/read.js';
import { closingLine, networkFor, etWeekday, pageState } from '../gridiron/gamePageArcade.js';
import { nbaBoxRows, nbaPlays, nbaTeamFinals } from './gameDetail.js';
import { nbaInYourGames, sixYourRow } from './yours.js';
import { sixEntryTouchingMatch } from '../six/entry.js';
import {
  nbaLine, nbaCardExtras, lastPlayText, performerLine, nbaLeaders, nbaTeamStats,
  nbaBoxTables, nbaPlayRows, nbaModules, nbaChips,
} from './card.js';
import * as pageFeed from './pageFeed.js';
import {
  pickOdds, standingRecord, shapeInjuries, updatedLabel, lineupsBlock, seasonLeaders,
  finalFromGame, finalsOf, last5, seriesLine, latestGameId,
  gamesPlayed, leadersSource, seasonLeadersFallback, last5Filled,
} from './pagePre.js';

const caught = (p, fallback) => Promise.resolve(p).catch(() => fallback);
// A feed read that is not there (a test passing `feed: {}`) fails like a slow
// one: the module is not drawn.
const via = (feed, name, ...args) => (typeof feed?.[name] === 'function' ? feed[name](...args) : Promise.reject(new Error(`no ${name}`)));

/**
 * THE PRE-GAME MODULES, each read caught on its own. { odds, record, injuries,
 * lineups, seasonLeaders, last5 } - a null is a module not drawn.
 */
async function preReads({ game, feed, finalsFn }) {
  const aB = game.away?.bdlId ?? null, hB = game.home?.bdlId ?? null;
  const season = game.seasonYear;
  const sideOf = (id) => (String(id) === String(hB) ? 'home' : String(id) === String(aB) ? 'away' : null);

  // THE FINALS: our own matches first; a team they hold none for is asked of the feed.
  const finals = caught((async () => {
    let own = await caught(finalsFn(game), []);
    const out = [...own];
    for (const id of [aB, hB]) {
      if (!id || finalsOf(own, id).length) continue;
      const fed = (await caught(via(feed, 'readTeamGames', id, season), [])).map(finalFromGame).filter(Boolean);
      out.push(...fed);
    }
    return out;
  })(), []);

  const odds = !game.bdlGameId ? null
    : caught(via(feed, 'readOdds', game.bdlGameId).then(pickOdds), null);
  // ONE standings read: the W-L chips and the games each team has played (the fallbacks' switch).
  const standings = aB && hB ? caught(via(feed, 'readStandings', season), null) : Promise.resolve(null);
  const record = standings.then((rows) => (rows ? { away: standingRecord(rows, aB), home: standingRecord(rows, hB) } : null));
  // Games played THIS season, per side: the standings' W+L, else our own finals (null = unknown).
  const gp = Promise.all([standings, finals]).then(([rows, fin]) => {
    const of = (id) => { const g = rows ? gamesPlayed(rows, id) : null; return g ?? (rows ? null : finalsOf(fin, id).length); };
    return { away: of(aB), home: of(hB) };
  });
  // Last season's games for a side that needs the fill (fewer than five finals this season), else [].
  const prevGames = (id, fin) => (finalsOf(fin, id).length >= 5 ? [] : caught(via(feed, 'readTeamGames', id, season - 1), []).then((rs) => rs.map(finalFromGame).filter(Boolean)));
  const injuries = aB && hB
    ? caught(via(feed, 'readInjuries', [aB, hB]).then(({ rows, fetchedAt }) => {
      const list = shapeInjuries(rows, sideOf);
      return list ? { ...list, updated: updatedLabel(fetchedAt) } : null;
    }), null)
    : null;
  const lineups = aB && hB && game.bdlGameId
    ? caught((async () => {
      const [now, fin] = await Promise.all([caught(via(feed, 'readLineups', game.bdlGameId), []), finals]);
      const priorOf = async (id) => { const gid = latestGameId(fin, id); return gid ? caught(via(feed, 'readLineups', gid), []) : []; };
      const prior = { away: await priorOf(aB), home: await priorOf(hB) };
      return lineupsBlock({ thisGame: now, prior, awayBdl: aB, homeBdl: hB });
    })(), null)
    : null;
  const leaders = aB && hB
    ? caught((async () => {
      const [ra, rh] = await Promise.all([via(feed, 'readRoster', aB), via(feed, 'readRoster', hB)]);
      const side = new Map();
      for (const p of ra) side.set(p.id, 'away');
      for (const p of rh) side.set(p.id, 'home');
      if (!side.size) return null;
      const counts = await gp;
      const src = { away: leadersSource(counts.away), home: leadersSource(counts.home) };
      const ids = (sd) => [...side].filter(([, v]) => v === sd).map(([k]) => k);
      const [thisRows, prevRows] = await Promise.all([
        via(feed, 'readSeasonAverages', season, [...side.keys()]),
        // Last season's averages, for the current roster of only the side(s) that need them.
        ['away', 'home'].some((sd) => src[sd] === 'prev')
          ? caught(via(feed, 'readSeasonAverages', season - 1, ['away', 'home'].filter((sd) => src[sd] === 'prev').flatMap(ids)), [])
          : [],
      ]);
      return seasonLeadersFallback({ thisRows, prevRows, rosterSide: (id) => side.get(id) ?? null, src, season });
    })(), null)
    : null;
  const lastFive = aB && hB
    ? caught(finals.then(async (fin) => {
      const [pa, ph] = await Promise.all([prevGames(aB, fin), prevGames(hB, fin)]);
      const a = last5Filled(fin, pa, aB, season), h = last5Filled(fin, ph, hB, season);
      if (!a && !h) return null;
      return {
        away: a?.list ?? null, home: h?.list ?? null, prevFrom: { away: a?.prevFrom ?? null, home: h?.prevFrom ?? null },
        series: seriesLine(fin, { awayBdl: aB, homeBdl: hB, awayAbbr: game.away?.abbreviation, homeAbbr: game.home?.abbreviation }),
      };
    }), null)
    : null;
  const [o, r, i, l, s, f] = await Promise.all([odds, record, injuries, lineups, leaders, lastFive]);
  return { odds: o, record: r, injuries: i, lineups: l, seasonLeaders: s, last5: f };
}

/**
 * @param game      getNbaGame(slug)
 * @param viewerId  the signed-in user id, or null
 * @param allPlays  ?plays=all - the whole list in the Plays section
 * @param boxOpen   ?box=all - the final's full box score, drawn on the page
 * @param feed      lib/nba/pageFeed.js (the secondary feed's cached page reads); a test passes its own
 * @param finalsFn  lib/nba/gameDetail.js nbaTeamFinals
 */
export async function nbaGameView({ game, viewerId = null, allPlays = false, boxOpen = false, signinHref = '/signin', now = new Date(), feed = pageFeed, finalsFn = nbaTeamFinals }) {
  const state = pageState(game.status);
  const homeId = game.home?.id ?? null, awayId = game.away?.id ?? null;
  const [box, feedPlays, spreads, totals, h2h, records, network, yourData, six, starterRows, pre] = await Promise.all([
    state !== 'pre' ? caught(nbaBoxRows(game.id), []) : [],
    state === 'live' ? caught(nbaPlays(game.id, { all: allPlays }), { latest: [], total: 0 }) : { latest: [], total: 0 },
    state !== 'final' ? caught(getSpreadHome([game.id]), new Map()) : new Map(),
    state !== 'final' ? caught(getTotalPoints([game.id]), new Map()) : new Map(),
    state === 'pre' ? caught(getH2hOdds([game.id]), new Map()) : new Map(),
    Promise.all([
      caught(getTeamRecordChip('nba', homeId, game.seasonYear), null),
      caught(getTeamRecordChip('nba', awayId, game.seasonYear), null),
    ]),
    caught(networkFor(game.id), null),
    caught(nbaInYourGames({ userId: viewerId, game, now }), { rows: [], open: [] }),
    // TONIGHT'S SIX (fri-1): this user's Six slots in this game, or null.
    caught(sixEntryTouchingMatch(viewerId, game.id), null),
    // THE STARTERS, for the box's marker (live and final): the feed's lineups.
    state !== 'pre' && game.bdlGameId ? caught(via(feed, 'readLineups', game.bdlGameId, { live: state === 'live' }), []) : [],
    state === 'pre' ? preReads({ game, feed, finalsFn }) : null,
  ]);

  const g = { ...game, network, etWeekday: etWeekday(game.kickoffAt) };
  const detail = game.detail ?? {};
  const extras = nbaCardExtras(game.status, detail);
  const closing = closingLine(game.marketPrior, g);
  // THE HEADER'S LINE AND TOTAL: our own odds rows if any (none for the NBA
  // today), else the feed's, pre-game only.
  const dbSpread = spreads.get(game.id) ?? null, dbTotal = totals.get(game.id) ?? null;
  const fedOdds = dbSpread == null && dbTotal == null ? (pre?.odds ?? null) : null;
  const rec = (side, i) => records[i] ?? pre?.record?.[side] ?? null;
  const x = {
    rank: { home: null, away: null },
    record: { home: rec('home', 0), away: rec('away', 1) },
    spreadHome: dbSpread ?? fedOdds?.spreadHome ?? null, total: dbTotal ?? fedOdds?.total ?? null, openHome: null,
    preview: null, drive: null, diamond: null, stat: null, hasStats: box.length > 0,
    mlbFoot: null, probables: null, prob: null, stake: null, open: false,
    line: nbaLine(g, detail),
    closing: state === 'final' ? closing : null,
    lastPlay: state === 'live' ? lastPlayText(detail) : null,
    nba: { ...extras, perf: performerLine(box, { status: game.status, homeId, awayId }) },
  };

  const yours = {
    signedIn: viewerId != null, rows: [...yourData.rows, ...[sixYourRow(six, state)].filter(Boolean)], open: yourData.open, pre: state === 'pre',
    playHref: viewerId != null ? (yourData.open[0]?.href ?? null) : signinHref,
  };

  const abbrOf = (id) => (id === homeId ? game.home?.abbreviation : id === awayId ? game.away?.abbreviation : null);
  const plays = { latest: nbaPlayRows(feedPlays.latest, { abbrOf }), total: feedPlays.total, all: Boolean(allPlays) };
  const leaders = nbaLeaders(box, { homeId, awayId });
  const teamBox = nbaTeamStats(box, { homeId, awayId });
  const starters = new Set((starterRows ?? []).filter((r) => r?.starter === true && r?.player?.id != null).map((r) => String(r.player.id)));
  const boxTables = nbaBoxTables(box, g, { starters: starters.size ? starters : null }).filter((t) => t.tables.length);
  const chips = state === 'live' ? nbaChips({
    plays: plays.total, box: boxTables.length > 0, leaders: leaders.length > 0 || Boolean(teamBox), market: Boolean(closing),
  }) : [];
  const odds = h2h.get?.(game.id) ?? null;
  const modules = nbaModules({
    state, hasMarket: Boolean(odds), hasYours: yours.rows.length > 0 || yours.open.length > 0,
    hasLeaders: leaders.length > 0, hasTeamStats: Boolean(teamBox), hasBox: boxTables.length > 0, boxOpen,
    hasInjuries: Boolean(pre?.injuries), hasLineups: Boolean(pre?.lineups),
    hasSeasonLeaders: Boolean(pre?.seasonLeaders), hasLast5: Boolean(pre?.last5),
  });

  return {
    state, league: 'nba', simulated: false, modules,
    g, x, signinHref,
    odds, winprob: null, yours,
    chips, plays, box: boxTables, leaders, teamBox,
    // THE PRE-GAME MODULES (thu1-nba-page): each null unless its read answered.
    injuries: pre?.injuries ?? null, lineups: pre?.lineups ?? null,
    seasonLeaders: pre?.seasonLeaders?.rows ?? null, seasonLeadersFrom: pre?.seasonLeaders?.from ?? null, last5: pre?.last5 ?? null,
    market: { closing, propsCard: null },
    scoring: [],
    boxHref: `/nba/game/${game.slug}?box=all#gpa-box`,
    crumb: ['NBA', g.etWeekday].filter(Boolean).join(' · '),
  };
}
