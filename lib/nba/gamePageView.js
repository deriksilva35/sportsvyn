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
import { nbaBoxRows, nbaPlays } from './gameDetail.js';
import { nbaInYourGames, sixYourRow } from './yours.js';
import { sixEntryTouchingMatch } from '../six/entry.js';
import {
  nbaLine, nbaCardExtras, lastPlayText, performerLine, nbaLeaders, nbaTeamStats,
  nbaBoxTables, nbaPlayRows, nbaModules, nbaChips,
} from './card.js';

const caught = (p, fallback) => Promise.resolve(p).catch(() => fallback);

/**
 * @param game      getNbaGame(slug)
 * @param viewerId  the signed-in user id, or null
 * @param allPlays  ?plays=all - the whole list in the Plays section
 * @param boxOpen   ?box=all - the final's full box score, drawn on the page
 */
export async function nbaGameView({ game, viewerId = null, allPlays = false, boxOpen = false, signinHref = '/signin', now = new Date() }) {
  const state = pageState(game.status);
  const homeId = game.home?.id ?? null, awayId = game.away?.id ?? null;
  const [box, feed, spreads, totals, h2h, records, network, yourData, six] = await Promise.all([
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
  ]);

  const g = { ...game, network, etWeekday: etWeekday(game.kickoffAt) };
  const detail = game.detail ?? {};
  const extras = nbaCardExtras(game.status, detail);
  const closing = closingLine(game.marketPrior, g);
  const x = {
    rank: { home: null, away: null },
    record: { home: records[0], away: records[1] },
    spreadHome: spreads.get(game.id) ?? null, total: totals.get(game.id) ?? null, openHome: null,
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
  const plays = { latest: nbaPlayRows(feed.latest, { abbrOf }), total: feed.total, all: Boolean(allPlays) };
  const leaders = nbaLeaders(box, { homeId, awayId });
  const teamBox = nbaTeamStats(box, { homeId, awayId });
  const boxTables = nbaBoxTables(box, g).filter((t) => t.tables.length);
  const chips = state === 'live' ? nbaChips({
    plays: plays.total, box: boxTables.length > 0, leaders: leaders.length > 0 || Boolean(teamBox), market: Boolean(closing),
  }) : [];
  const odds = h2h.get?.(game.id) ?? null;
  const modules = nbaModules({
    state, hasMarket: Boolean(odds), hasYours: yours.rows.length > 0 || yours.open.length > 0,
    hasLeaders: leaders.length > 0, hasTeamStats: Boolean(teamBox), hasBox: boxTables.length > 0, boxOpen,
  });

  return {
    state, league: 'nba', simulated: false, modules,
    g, x, signinHref,
    odds, winprob: null, yours,
    chips, plays, box: boxTables, leaders, teamBox,
    market: { closing, propsCard: null },
    scoring: [],
    boxHref: `/nba/game/${game.slug}?box=all#gpa-box`,
    crumb: ['NBA', g.etWeekday].filter(Boolean).join(' · '),
  };
}
