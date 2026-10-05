// scripts/widget-fixtures/inputs.mjs - STUB INPUTS for the widget fixtures (sun-22).
//
// OUT OF lib/ ON PURPOSE (sun-24 A): these are documentation inputs - typed
// team colours and copy for the Mac's offline fixtures - not product code, so
// they live beside the script that writes them, outside the trees the colour
// ratchet (lib/brand/hexCensus.js) and the round-label guard walk. Round words
// still go through lib/soccer/roundLabel.js like everywhere else.
//
// docs/widgets/fixtures/*.json are the REAL serializer (lib/widget/shape.js)
// run over these inputs at a fixed clock - scripts/widget-fixtures.mjs writes
// them, lib/widget/feed.test.mjs regenerates them and fails on any drift. The
// play items go through the real playLobby() too, so YOUR MOVE and the games
// list are ordered by the same code the Play tab uses.
//
// EVERY TIME IS RELATIVE TO FIXTURE_NOW, which is fixed: the fixtures are a
// document for the Mac to build against offline, not a test of today.

import { playLobby } from '../../lib/games/playLobby.js';
import { serializeFeed, signedOutFeed, ageFeed, pickerFeed } from '../../lib/widget/shape.js';
import { gameweekLabel } from '../../lib/soccer/roundLabel.js';

/** Sunday 4 Oct 2026, 1:30 PM ET. */
export const FIXTURE_NOW = new Date('2026-10-04T17:30:00.000Z');
const at = (min) => new Date(FIXTURE_NOW.getTime() + min * 60_000).toISOString();

const item = (o) => ({
  settled: false, complete: false, opensAt: null, progress: null, href: '/games', mark: 'X', cta: 'PLAY', kicker: '', ...o,
});

// ---- the play items (the registry's shape, lib/games/playRegistry.js) ------

const BUSY_ITEMS = [
  item({ key: 'nfl-weekly', sport: 'nfl', game: 'weekly', name: 'The Weekly', title: 'Week 5', status: '4 of 6', locksAt: at(25), progress: { done: 4, total: 6 }, href: '/weekly' }),
  item({ key: 'nfl-pickem', sport: 'nfl', game: 'pickem', name: "Pick'em", title: 'Week 5', status: '9 of 14 picked', locksAt: at(25), progress: { done: 9, total: 14 }, href: '/pickem/nfl' }),
  item({ key: 'nfl-draft', sport: 'nfl', game: 'draft', name: 'The Draft', title: 'Week 5 room', status: 'Roster in · waiting for lock', locksAt: at(25), complete: true, href: '/draft' }),
  item({ key: 'cfb-pickem', sport: 'cfb', game: 'pickem', name: "Pick'em", title: 'Week 6', status: 'All games kicked · grading', locksAt: null, progress: { done: 20, total: 25 }, href: '/pickem/cfb' }),
  item({ key: 'mlb-october', sport: 'mlb', game: 'october', name: 'October', title: 'Five a day', status: '2 of 5 picked', locksAt: at(150), progress: { done: 2, total: 5 }, href: '/october' }),
  item({ key: 'mlb-run', sport: 'mlb', game: 'run', name: 'The Run', title: 'Wild Card', status: '0 of 9 set', locksAt: at(150), progress: { done: 0, total: 9 }, href: '/run' }),
  item({ key: 'mlb-series', sport: 'mlb', game: 'pickem', name: "Series Pick'em", title: 'Division Series', status: '0 of 4 series picked', locksAt: at(600), progress: { done: 0, total: 4 }, href: '/pickem/mlb' }),
  item({ key: 'epl-weekly-5', sport: 'epl', game: 'epl_weekly_5', name: 'EPL Weekly 5', title: gameweekLabel(7), status: `${gameweekLabel(7)} · in play`, locksAt: null, progress: { done: 5, total: 5 }, href: '/epl-weekly-5' }),
  item({ key: 'daily', sport: 'all', game: 'daily', name: 'The Daily', title: "Today's board", status: "Today's puzzle · 8 slots", locksAt: at(630), href: '/daily/board' }),
  // NOT OPEN YET: the feed's nextOpening (NBA opening night, 6 AM ET 20 Oct)
  item({ key: 'nba-pickem', sport: 'nba', game: 'pickem', name: "Pick'em", title: 'Next slate', status: 'Daily · 2 games', opensAt: '2026-10-20T10:00:00.000Z', locksAt: null, href: '/pickem/nba' }),
];

const QUIET_ITEMS = [
  item({ key: 'nfl-weekly', sport: 'nfl', game: 'weekly', name: 'The Weekly', title: 'Week 6', status: 'Set six players · PPR', opensAt: at(60 * 40), locksAt: null, href: '/weekly' }),
  item({ key: 'daily', sport: 'all', game: 'daily', name: 'The Daily', title: "Today's board", status: 'Played · see your grade', locksAt: at(630), complete: true, href: '/daily/board' }),
];

const LIVE_ITEMS = [
  item({ key: 'nfl-pickem', sport: 'nfl', game: 'pickem', name: "Pick'em", title: 'Week 5', status: '14 of 14 picked', locksAt: at(185), complete: true, progress: { done: 14, total: 14 }, href: '/pickem/nfl' }),
  item({ key: 'nfl-weekly', sport: 'nfl', game: 'weekly', name: 'The Weekly', title: 'Week 5', status: '6 of 6', locksAt: at(185), complete: true, progress: { done: 6, total: 6 }, href: '/weekly' }),
];

// ---- teams (lib/widget/reads.js teamRows) ----------------------------------

const team = (o) => ({
  teamId: 1, teamAbbr: 'BUF', teamName: 'Bills', teamSlug: 'buffalo-bills', leagueSlug: 'nfl', color: '#00338D', altColor: '#C60C30',
  gameId: null, gameSlug: null, status: null, kickoffAt: null, homeTeamId: null, homeScore: null, awayScore: null,
  liveState: null, oppId: null, oppAbbr: null, oppName: null, nextAt: null, ...o,
});

const LIVE_BUF = team({
  teamId: 4, gameId: 9101, gameSlug: 'nyj-at-buf-2026-10-04', status: 'live', kickoffAt: at(-90), homeTeamId: 4,
  homeScore: 24, awayScore: 17, oppId: 25, oppAbbr: 'NYJ', oppName: 'Jets', nextAt: at(60 * 24 * 7),
  oppColor: '#125740', oppAltColor: '#FFFFFF',
  liveState: { period: 3, clock: '7:22', win_prob: 81, win_prob_at: at(-0.5) },
  // the recent plays (lib/gridiron/scoresV2.js latestPlays): possession + field position
  plays: [{ period: 3, clock: '7:30', down: 1, distance: 10, yardsToGoal: 39, yardsGained: 4, offenseTeamId: 4, playType: 'Rush', text: 'J. Cook 4 yd run' }],
});
const FINAL_GA = team({
  teamId: 210, teamAbbr: 'UGA', teamName: 'Georgia', teamSlug: 'georgia-bulldogs', leagueSlug: 'cfb', color: '#BA0C2F', altColor: '#000000',
  gameId: 8802, gameSlug: 'uga-at-ala-2026-10-03', status: 'final', kickoffAt: at(-60 * 17), homeTeamId: 211,
  homeScore: 27, awayScore: 31, oppId: 211, oppAbbr: 'ALA', oppName: 'Alabama', nextAt: at(60 * 24 * 6),
  oppColor: '#9E1B32', oppAltColor: '#FFFFFF',
  liveState: { period: 5 },
});
const NEXT_LAD = team({
  teamId: 3301, teamAbbr: 'LAD', teamName: 'Dodgers', teamSlug: 'los-angeles-dodgers', leagueSlug: 'mlb', color: '#005A9C', altColor: '#EF3E42',
  gameId: 7740, gameSlug: 'sd-at-lad-2026-10-04', status: 'scheduled', kickoffAt: at(150), homeTeamId: 3301,
  oppId: 3310, oppAbbr: 'SD', oppName: 'Padres', nextAt: at(60 * 26),
});
const NONE_ARS = team({ teamId: 501, teamAbbr: 'ARS', teamName: 'Arsenal', teamSlug: 'arsenal', leagueSlug: 'epl', color: '#EF0107', altColor: '#063672' });
const LIVE_PHI = team({
  teamId: 3305, teamAbbr: 'PHI', teamName: 'Phillies', teamSlug: 'philadelphia-phillies', leagueSlug: 'mlb', color: '#E81828', altColor: '#002D72',
  gameId: 7741, gameSlug: 'phi-at-mil-2026-10-04', status: 'live', kickoffAt: at(-40), homeTeamId: 3312,
  homeScore: 2, awayScore: 3, oppId: 3312, oppAbbr: 'MIL', oppName: 'Brewers', nextAt: at(60 * 25),
  liveState: { period: 4, half: 'top' },
});

// ---- in your games (rowToGame shape + stakeForMatches stakes) ---------------

const game = (o) => ({
  id: 1, slug: 'x', leagueSlug: 'nfl', status: 'scheduled', kickoffAt: at(60), homeScore: null, awayScore: null, liveState: null,
  home: { id: 1, name: 'Home', abbreviation: 'HOM', colors: null }, away: { id: 2, name: 'Away', abbreviation: 'AWY', colors: null }, ...o,
});
const G_BUF = game({ id: 9101, slug: 'nyj-at-buf-2026-10-04', status: 'live', kickoffAt: at(-90), homeScore: 24, awayScore: 17,
  liveState: { period: 3, clock: '7:22' },
  home: { id: 4, name: 'Bills', abbreviation: 'BUF', colors: { primary: '#00338D', secondary: '#C60C30' } },
  away: { id: 25, name: 'Jets', abbreviation: 'NYJ', colors: { primary: '#125740', secondary: '#FFFFFF' } } });
const G_KC = game({ id: 9102, slug: 'kc-at-jax-2026-10-04', status: 'live', kickoffAt: at(-90), homeScore: 10, awayScore: 13,
  liveState: { period: 2, clock: '00:00' },
  home: { id: 15, name: 'Jaguars', abbreviation: 'JAX', colors: { primary: '#006778', secondary: '#D7A22A' } },
  away: { id: 16, name: 'Chiefs', abbreviation: 'KC', colors: { primary: '#E31837', secondary: '#FFB81C' } } });
const G_SF = game({ id: 9105, slug: 'sf-at-lar-2026-10-04', kickoffAt: at(185),
  home: { id: 20, name: 'Rams', abbreviation: 'LAR', colors: { primary: '#003594', secondary: '#FFA300' } },
  away: { id: 28, name: '49ers', abbreviation: 'SF', colors: { primary: '#AA0000', secondary: '#B3995D' } } });
const G_DAL = game({ id: 9106, slug: 'dal-at-gb-2026-10-04', kickoffAt: at(185),
  home: { id: 12, name: 'Packers', abbreviation: 'GB', colors: { primary: '#203731', secondary: '#FFB612' } },
  away: { id: 9, name: 'Cowboys', abbreviation: 'DAL', colors: { primary: '#003594', secondary: '#869397' } } });
const G_DET = game({ id: 9099, slug: 'det-at-min-2026-10-04', status: 'final', kickoffAt: at(-60 * 4), homeScore: 20, awayScore: 23,
  liveState: { period: 5 },
  home: { id: 21, name: 'Vikings', abbreviation: 'MIN', colors: { primary: '#4F2683', secondary: '#FFC62F' } },
  away: { id: 11, name: 'Lions', abbreviation: 'DET', colors: { primary: '#0076B6', secondary: '#B0B7BC' } } });

const G_PHI = game({ id: 7741, slug: 'phi-at-mil-2026-10-04', leagueSlug: 'mlb', status: 'live', kickoffAt: at(-40), homeScore: 2, awayScore: 3,
  liveState: { period: 4, half: 'top' },
  home: { id: 3312, name: 'Brewers', abbreviation: 'MIL', colors: { primary: '#12284B', secondary: '#FFC52F' } },
  away: { id: 3305, name: 'Phillies', abbreviation: 'PHI', colors: { primary: '#E81828', secondary: '#002D72' } } });

// THE LINEUP STAKES: an October bat and a Run arm in PHI@MIL, and the series picked for PHI.
const LINEUPS = {
  october: { bat1: { playerId: '501', matchId: 7741, kind: 'bat', name: 'K. Schwarber', team: 'PHI' } },
  run: { arm: { playerId: '777', teamId: 3312, kind: 'arm', name: 'F. Peralta', team: 'MIL' } },
  series: {
    board: [{ series_key: '2026-nlds-phi-mil', teams: [{ team_id: 3305, abbr: 'PHI' }, { team_id: 3312, abbr: 'MIL' }] }],
    lineup: { '2026-nlds-phi-mil': 3305 },
  },
  six: null,
  // THE DRAFT's counting six (liveEntryRows rows): a Bills receiver in NYJ@BUF
  draft: [{ slot: 'WR1', id: 9001, name: 'K. Shakir', team: 'BUF', points: 24.1, played: true }],
};

const stake = (pick, weekly = []) => ({ pick, weekly, alerts: false, follow: null });

// ---- the feeds -------------------------------------------------------------

const view = (items) => playLobby(items, { now: FIXTURE_NOW, signedIn: true, chip: 'all' });
const dailyCard = (state, closesMin = 630) => ({ state, closesAt: at(closesMin) });

export function fixtureFeeds() {
  return {
    'signed-in-busy': serializeFeed({
      view: view(BUSY_ITEMS), items: BUSY_ITEMS,
      daily: dailyCard('play'), streak: 12,
      teamRows: [NEXT_LAD, NONE_ARS, FINAL_GA, LIVE_BUF, LIVE_PHI],
      stakeGames: [G_SF, G_DAL, G_DET, G_KC, G_BUF, G_PHI],
      lineups: LINEUPS,
      stakes: new Map([
        [9101, stake({ side: 'home', abbr: 'BUF', state: 'winning' }, [{ name: 'J. Allen', pos: 'QB', points: 21.36 }, { name: 'J. Cook', pos: 'RB', points: 9.8 }])],
        [9102, stake({ side: 'away', abbr: 'KC', state: 'winning' })],
        [9105, stake({ side: 'away', abbr: 'SF', state: 'pending' }, [{ name: 'C. McCaffrey', pos: 'RB', points: 0 }])],
        [9106, stake({ side: 'home', abbr: 'GB', state: 'pending' })],
        [9099, stake({ side: 'away', abbr: 'DET', state: 'won' })],
      ]),
      phoneOn: true,
    }, FIXTURE_NOW),
    'signed-in-quiet': serializeFeed({
      view: view(QUIET_ITEMS), items: QUIET_ITEMS,
      daily: dailyCard('done'), streak: 3,
      teamRows: [team({ teamId: 4, gameId: 9201, gameSlug: 'buf-at-ne-2026-10-11', status: 'scheduled', kickoffAt: at(60 * 24 * 7 - 30), homeTeamId: 19,
        oppId: 19, oppAbbr: 'NE', oppName: 'Patriots', nextAt: at(60 * 24 * 14) })],
      stakeGames: [], stakes: new Map(), phoneOn: false,
    }, FIXTURE_NOW),
    'live-game': serializeFeed({
      view: view(LIVE_ITEMS), items: LIVE_ITEMS,
      daily: dailyCard('in-progress'), streak: 0,
      teamRows: [LIVE_BUF],
      stakeGames: [G_BUF],
      stakes: new Map([[9101, stake({ side: 'home', abbr: 'BUF', state: 'winning' }, [{ name: 'J. Allen', pos: 'QB', points: 21.36 }])]]),
      phoneOn: true,
    }, FIXTURE_NOW),
    'signed-out': signedOutFeed(FIXTURE_NOW),
    'age-pending': ageFeed(FIXTURE_NOW),
  };
}

const pick = (id, abbreviation, name, leagueSlug, primary, secondary) => ({ id, abbreviation, name, leagueSlug, colors: { primary, secondary } });

export function fixturePicker() {
  const all = [
    pick(210, 'UGA', 'Georgia', 'cfb', '#BA0C2F', '#000000'),
    pick(211, 'ALA', 'Alabama', 'cfb', '#9E1B32', '#FFFFFF'),
    pick(501, 'ARS', 'Arsenal', 'epl', '#EF0107', '#063672'),
    pick(3301, 'LAD', 'Dodgers', 'mlb', '#005A9C', '#EF3E42'),
    pick(2201, 'BOS', 'Celtics', 'nba', '#007A33', '#BA9653'),
    pick(4, 'BUF', 'Bills', 'nfl', '#00338D', '#C60C30'),
    pick(16, 'KC', 'Chiefs', 'nfl', '#E31837', '#FFB81C'),
  ];
  return pickerFeed({ state: 'ok', followed: [all[5], all[0]], all, now: FIXTURE_NOW });
}
