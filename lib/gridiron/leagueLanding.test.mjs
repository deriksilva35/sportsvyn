// lib/gridiron/leagueLanding.test.mjs — the league landing's claims, tested
// without rendering anything. Run: node --test lib/gridiron/leagueLanding.test.mjs
//
// EVERY ASSERTION HERE IS ABOUT SOMETHING A READER WOULD BELIEVE: that a chip's
// rank came from the AP poll and not from row order, that an arrow means a team
// moved, that a volt button means an action is available. None of those can be
// checked by counting occurrences in served HTML, which is exactly how a broken
// header shipped last week.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  railRecord, railMovement, railChip, railChips, landingEyebrow, livePill,
  stripGamesFor, tileIsOpen, tileNumber, stripTiles, scoresSlice, leagueUnit,
} from './leagueLanding.js';
import { GAME_META, GAME_ORDER } from '../games/lobby.js';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const src = (r) => readFileSync(path.join(REPO, r), 'utf8');
const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

// ------------------------------------------------------------------ the rail

test('THE RAIL DERIVES FROM A NAMED POLL, never from row order', () => {
  // The law that matters: CFBD's polls array changes membership by week, so an
  // index reads a different poll with an identical shape. The rail reads
  // ap_rankings, and rankings.js maps the poll NAME to that table - so there is
  // no array here to index into by accident.
  const rail = strip(src('lib/gridiron/leagueRail.js'));
  assert.match(rail, /FROM ap_rankings ap/);
  assert.doesNotMatch(rail, /polls\[\d\]|\[0\]/);
  assert.match(strip(src('lib/cfb/rankings.js')), /\[AP_POLL\]: 'ap_rankings'/);
  // and the rank rendered is the poll's own column, not an enumeration index.
  assert.match(strip(src('components/league/RankRail.js')), /\{c\.rank\}/);
  assert.doesNotMatch(strip(src('components/league/RankRail.js')), /map\(\(c, ?i\)/);
});

test('MOVEMENT IS NULL ON THE FIRST WEEK, and null when a team holds', () => {
  assert.equal(railMovement({ rank: 5, previous_rank: null }), null, 'no prior poll, no arrow');
  assert.equal(railMovement({ rank: 5, previous_rank: 5 }), null, 'held is not moved');
  assert.equal(railMovement({ rank: 3, previous_rank: 9 }), 'up');
  assert.equal(railMovement({ rank: 12, previous_rank: 4 }), 'down');
  assert.equal(railMovement({}), null);
  // The reader joins the PRIOR week and lets it be null rather than defaulting.
  assert.match(strip(src('lib/gridiron/leagueRail.js')), /LEFT JOIN ap_rankings prev/);
});

test('a chip may only claim knowledge - 0-0 and absent both render nothing', () => {
  assert.equal(railRecord({ wins: 1, losses: 0, ties: 0 }), '1-0');
  assert.equal(railRecord({ wins: 9, losses: 3, ties: 1 }), '9-3-1');
  assert.equal(railRecord({ wins: 0, losses: 0, ties: 0 }), null);
  assert.equal(railRecord({ wins: null, losses: null }), null);
  assert.equal(railRecord(null), null);
});

test('railChip falls back to the seeded label rather than rendering an empty chip', () => {
  const c = railChip({ rank: 1, team_id: null, abbreviation: null, name: 'Los Angeles Rams' });
  assert.equal(c.abbr, 'Los Angeles Rams');
  assert.equal(railChips([]).length, 0);
});

test('NO CHIPS, NO RAIL - an empty rail is furniture announcing an absence', () => {
  assert.match(strip(src('components/league/RankRail.js')), /if \(!chips\?\.length\) return null/);
});

// --------------------------------------------------------------- the header

test('THE EYEBROW OBEYS THE REG-ONLY LANDMARK LAW', () => {
  const d = '2026-08-29T16:00:00Z';
  assert.equal(landingEyebrow({ week: 1, phase: 'REG', date: d }), 'Week 1 · Sat Aug 29');
  // A preseason week 3 is not "Week 3" - it counts differently, so the week is
  // dropped and the date, which is always true, stands alone.
  assert.equal(landingEyebrow({ week: 3, phase: 'PRE', date: d }), 'Sat Aug 29');
  assert.equal(landingEyebrow({ week: null, phase: 'REG', date: d }), 'Sat Aug 29');
  // A failed derivation on both halves says nothing rather than something wrong.
  assert.equal(landingEyebrow({ week: null, phase: null, date: null }), null);
});

test('THE LIVE PILL IS HIDDEN AT ZERO', () => {
  assert.equal(livePill([]), null);
  assert.equal(livePill([{ status: 'final' }, { status: 'scheduled' }]), null);
  assert.equal(livePill([{ status: 'live' }, { status: 'final' }, { status: 'live' }]), 2);
  assert.equal(livePill(null), null);
  // and the component has no rule for an empty pill because it never draws one
  assert.match(strip(src('components/league/LeagueHeader.js')), /\{live \?/);
});

// ---------------------------------------------------------------- the strip

test('LEAGUE MEMBERSHIP IS DATA ON GAME_META, not a branch', () => {
  assert.deepEqual(stripGamesFor('cfb', GAME_META), ['pickem']);
  assert.deepEqual(stripGamesFor('nfl', GAME_META).sort(), ['daily', 'draft', 'pickem', 'weekly']);
  assert.deepEqual(stripGamesFor('epl', GAME_META), []);
  // The surface must not re-implement the answer.
  const s = strip(src('components/league/GamesStrip.js'));
  assert.doesNotMatch(s, /=== 'cfb'|=== 'nfl'/);
});

test('THE TILE COUNT IS THE LEAGUE\'S GAMES - one for CFB, four for NFL', () => {
  const cards = Object.fromEntries(GAME_ORDER.map((k) => [k, { key: k, state: 'open', playable: true }]));
  assert.equal(stripTiles({ leagueSlug: 'cfb', meta: GAME_META, order: GAME_ORDER, cards, signedIn: true }).length, 1);
  assert.equal(stripTiles({ leagueSlug: 'nfl', meta: GAME_META, order: GAME_ORDER, cards, signedIn: true }).length, 4);
  // and the order is GAME_ORDER's, not object-key order
  assert.deepEqual(
    stripTiles({ leagueSlug: 'nfl', meta: GAME_META, order: GAME_ORDER, cards, signedIn: true }).map((t) => t.key),
    GAME_ORDER,
  );
});

test('PRIMARY-BUTTON LAW: a volt button only where an action is open', () => {
  const open = { state: 'open', playable: true };
  assert.equal(tileIsOpen(open, { signedIn: true }), true);
  // SIGNED OUT IS NEVER OPEN - the tile still shows the game and its lock.
  assert.equal(tileIsOpen(open, { signedIn: false }), false);
  // cardState's own vocabulary, not a second one.
  assert.equal(tileIsOpen({ state: 'entered', playable: true }, { signedIn: true }), false);
  assert.equal(tileIsOpen({ state: 'settled', playable: false }, { signedIn: true }), false);
  assert.equal(tileIsOpen({ state: 'ghost', playable: false }, { signedIn: true }), false);
  assert.equal(tileIsOpen(null, { signedIn: true }), false);
});

test('the volt button count can never exceed the tile count', () => {
  const cards = {
    daily: { state: 'open', playable: true },
    pickem: { state: 'entered', playable: true },
    weekly: { state: 'ghost', playable: false },
    draft: { state: 'settled', playable: false },
  };
  const tiles = stripTiles({ leagueSlug: 'nfl', meta: GAME_META, order: GAME_ORDER, cards, signedIn: true });
  const volt = tiles.filter((t) => t.open).length;
  assert.equal(tiles.length, 4);
  assert.equal(volt, 1, 'only the open one');
  assert.ok(volt <= tiles.length);
  // Signed out: four tiles, zero primaries.
  const out = stripTiles({ leagueSlug: 'nfl', meta: GAME_META, order: GAME_ORDER, cards, signedIn: false });
  assert.equal(out.filter((t) => t.open).length, 0);
  // THE STRIP IS THE ONLY VOLT BUTTON ON THE SCREEN: no other league component
  // paints a volt background.
  for (const f of ['components/league/RankRail.js', 'components/league/LeagueScores.js',
                   'components/league/LeagueHeader.js']) {
    assert.doesNotMatch(strip(src(f)), /lgt-btn|background: var\(--volt\)/);
  }
});

test('the tile number comes from the card, never computed here', () => {
  // RELAY B MOVED THE NUMBER ONTO card.count. Relay A read it off `you`, which
  // could only ever say points or a streak; the reader now computes what each
  // game actually counts and hands it over whole.
  assert.deepEqual(tileNumber({ count: { value: '9/16', unit: 'picked' } }), { value: '9/16', unit: 'picked' });
  assert.equal(tileNumber({ count: null }), null, 'a game with nothing to count has no number');
  assert.equal(tileNumber({}), null);
});

// --------------------------------------------------------------- the scores

test('SCORES ORDER IS THE READER\'S PRIORITY: live, upcoming, final', () => {
  const g = [
    { id: 'f', status: 'final', kickoffAt: '2026-08-29T16:00:00Z' },
    { id: 's', status: 'scheduled', kickoffAt: '2026-08-29T23:00:00Z' },
    { id: 'l', status: 'live', kickoffAt: '2026-08-29T20:00:00Z' },
    { id: 's2', status: 'scheduled', kickoffAt: '2026-08-29T19:00:00Z' },
  ];
  assert.deepEqual(scoresSlice(g).shown.map((x) => x.id), ['l', 's2', 's', 'f']);
});

test('the cap and the overflow count are the real numbers', () => {
  const g = Array.from({ length: 14 }, (_, i) => ({ id: i, status: 'final', kickoffAt: `2026-08-29T${10 + i}:00:00Z` }));
  const s = scoresSlice(g, 6);
  assert.equal(s.shown.length, 6);
  assert.equal(s.total, 14);
  assert.equal(s.overflow, 8);
  // No overflow, no link - the component gates on it.
  assert.equal(scoresSlice(g.slice(0, 5), 6).overflow, 0);
  assert.match(strip(src('components/league/LeagueScores.js')), /\{overflow \?/);
});

test('THE UNIT IS THE LEAGUE\'S: college counts a day, the NFL a week', () => {
  assert.equal(leagueUnit('cfb'), 'day');
  assert.equal(leagueUnit('nfl'), 'week');
  assert.equal(leagueUnit('epl'), 'week', 'an unknown code falls to the commoner unit');
});

test('BUT THE UNIT NO LONGER TITLES THE MODULE BY ITSELF', () => {
  // WHAT THIS USED TO CLAIM. It asserted the heading was literally
  // `unit === 'day' ? 'Today' : 'This week'`, and that was a true reading of
  // the code and a false statement on the screen: CFB's unit is the day, the
  // landing hands the module slate.byDay FLATTENED - the whole week - so a CFB
  // landing titled four days of football "Today", every week, with Saturday's
  // games under it on a Tuesday.
  //
  // The unit is still right about how a code's schedule is shaped. It was just
  // never the question. What titles a list is what is IN the list, so the
  // heading now asks the games and degrades to "This week" whenever they span
  // more than one day. The unit test above is unchanged and still passes;
  // this one replaces the markup assertion that encoded the bug.
  const s = strip(src('components/league/LeagueScores.js'));
  assert.match(s, /moduleHeading\(unit, shown\)/);
  assert.doesNotMatch(s, /unit === 'day' \? 'Today'/,
    'the league alone must not decide the heading again');
});

test('THE SCORE CARD IS REUSED, NOT REBUILT', () => {
  // A second score card is a second grammar for the same fact.
  const s = strip(src('components/league/LeagueScores.js'));
  assert.match(s, /import Scoreboard from '@\/components\/gridiron\/Scoreboard'/);
  assert.doesNotMatch(s, /gi-card|TeamLine|LineScore/);
});

// ------------------------------------------------------- structural guards

test('THE LOGIC LIVES IN A PLAIN MODULE, not in JSX', () => {
  for (const f of ['components/league/LeagueHeader.js', 'components/league/RankRail.js',
                   'components/league/GamesStrip.js', 'components/league/LeagueScores.js']) {
    const code = strip(src(f));
    assert.doesNotMatch(code, /\bsql`|SELECT /i, `${f} must not query`);
    assert.doesNotMatch(code, /\.sort\(|\.filter\(\(g\) =>/, `${f} must not re-shape data`);
  }
});

test('ONE RECORDS LOADER, two callers', () => {
  const loader = strip(src('lib/gridiron/recordsLoader.js'));
  assert.match(loader, /recordChipMap/);
  assert.match(strip(src('app/scores/page.js')), /loadRecordChips\(\)/);
  assert.match(strip(src('components/gridiron/TodayPage.js')), /loadRecordChips\(\)/);
  // and neither caller resolves the season itself any more
  assert.doesNotMatch(strip(src('app/scores/page.js')), /recordChipMap\(/);
});

// ===========================================================================
// RELAY B — the counts, the bottom half, and the retirements
// ===========================================================================

test('THE COUNT COMES FROM THE READER, never from the tile', () => {
  // gamesLobby computes it per game, because only the reader knows what each
  // game counts. tileNumber renders what it was handed and nothing else.
  const lg = strip(src('lib/games/read.js'));
  assert.match(lg, /count: pickem/);
  assert.match(lg, /picked\}\/\$\{pickem\.total\}/, "pick 'em counts picks over the board");
  assert.match(lg, /unit: 'played today'/);
  assert.match(lg, /key === 'weekly'/);
  // The tile does no arithmetic of its own. (tiles.length is the strip
  // deciding whether it has one tile or four - layout, not a count about a
  // game.) What it must never do is compute a game's number.
  const tile = strip(src('components/league/GamesStrip.js'));
  assert.doesNotMatch(tile, /picked|\btotal\b|\.filter\(|Object\.keys/);
});

test('a ghosted game carries NO number', () => {
  // There is no contest to count, so a number would be a claim about nothing.
  assert.match(strip(src('lib/games/lobby.js')), /state: 'ghost'[^}]*count: null/s);
  assert.equal(tileNumber({ count: null }), null);
  assert.equal(tileNumber({ count: { value: '' } }), null);
  assert.deepEqual(tileNumber({ count: { value: '9/16', unit: 'picked' } }), { value: '9/16', unit: 'picked' });
  // A unit is optional - "Room open" has none.
  assert.deepEqual(tileNumber({ count: { value: 'Room open', unit: null } }), { value: 'Room open', unit: null });
});

test("the pick'em count is VIEWER-SCOPED - a stranger gets the board size", () => {
  const lg = strip(src('lib/games/read.js'));
  assert.match(lg, /uid != null\s*\?\s*\{ value: `\$\{pickem\.picked\}/s,
    'my picks only when there is a me');
  assert.match(lg, /: \{ value: String\(pickem\.total\), unit: 'games' \}/,
    'signed out gets the board size, never somebody else\'s progress');
});

// ------------------------------------------------------- standings snapshot

test('THE SNAPSHOT GROUP IS THE FOLLOWED TEAM\'S, else the default', () => {
  const m = strip(src('lib/gridiron/landingModules.js'));
  assert.match(m, /FROM user_team_follows f/);
  assert.match(m, /ORDER BY f\.followed_at ASC/, 'the first follow, deterministically');
  assert.match(m, /DEFAULT_GROUP = Object\.freeze\(\{ cfb: 'ACC', nfl: 'AFC East' \}\)/);
  // A follow we hold but cannot place in this season's groups falls to the
  // default rather than emptying the module.
  assert.match(m, /rows\.some\(\(r\) => groupLabel\(leagueSlug, r\) === followed\)/);
});

test('a column appears only when somebody has a number in it', () => {
  // CFBD publishes no streak and no points for college; two columns of dashes
  // would be a promise we do not keep.
  const m = strip(src('lib/gridiron/landingModules.js'));
  assert.match(m, /hasStreak: top\.some/);
  assert.match(m, /hasPoints: top\.some/);
  const c = strip(src('components/league/StandingsSnapshot.js'));
  assert.match(c, /\{hasStreak \?/);
  assert.match(c, /!isCfb && hasPoints \?/);
});

test('THE MATCHES-DERIVED getStandings IS GONE, not repointed', () => {
  // It counted final results out of `matches` and disagreed with the
  // provider-sourced team_records - two answers to one question, and the rail
  // showed the wrong one. Its only caller was that rail.
  const readers = src('lib/gridiron/readers.js');
  assert.doesNotMatch(strip(readers), /export async function getStandings/);
  assert.match(readers, /getStandings — DELETED/, 'and the deletion is explained where it stood');
  for (const f of ['components/gridiron/TodayPage.js', 'components/league/StandingsSnapshot.js']) {
    assert.doesNotMatch(strip(src(f)), /getStandings/);
  }
  // The snapshot reads the standings reader instead.
  assert.match(strip(src('lib/gridiron/landingModules.js')), /getLeagueRecords/);
});

// -------------------------------------------------------------- the market

test('ONE ODDS SOURCE - the market module opens no query of its own', () => {
  const m = strip(src('lib/gridiron/landingModules.js'));
  assert.doesNotMatch(m, /odds_markets/, 'the line comes through oddsReader or not at all');
  assert.match(m, /await import\('\.\/oddsReader\.js'\)/);
  assert.match(m, /getSpreadHome|getTotalPoints/);
  const c = strip(src('components/league/MarketModule.js'));
  assert.doesNotMatch(c, /odds_markets|sql`/);
});

test('isPreGame at the FETCH and at the RENDER', () => {
  assert.match(strip(src('lib/gridiron/landingModules.js')), /m\.status = 'scheduled'/);
  assert.match(strip(src('components/league/MarketModule.js')), /isPreGame\(statuses\?\.get/);
});

test('a market row that cannot name its favourite is DROPPED', () => {
  // The spread names a side, so a row missing an abbreviation cannot state who
  // is favoured - and a market row that will not say who is a fixture list.
  assert.match(strip(src('lib/gridiron/landingModules.js')), /g\.home_abbr && g\.away_abbr/);
  assert.match(strip(src('components/league/MarketModule.js')), /if \(!label\) return null/);
});

// ------------------------------------------------------------- week leaders

test('LEADERS ARE REG-ONLY AND WEEK-SCOPED', () => {
  const m = strip(src('lib/gridiron/landingModules.js'));
  assert.match(m, /m\.season_year = \$2 AND m\.week = \$3 AND m\.season_phase = 'REG'/,
    'a query that forgets either crowns somebody on a career total');
  // The two codes keep separate tables; neither is assumed.
  assert.match(m, /cfb_player_game_stats/);
  assert.match(m, /nfl_player_game_stats/);
  assert.match(m, /g\.player_id/);
  assert.match(m, /g\.nfl_player_id/);
});

test('a category nobody has a number in gets no row', () => {
  assert.match(strip(src('lib/gridiron/landingModules.js')), /if \(r && Number\(r\.yards\) > 0\)/);
});

test('leaders link where they resolve, identical grammar where not', () => {
  const c = strip(src('components/league/WeekLeaders.js'));
  assert.match(c, /l\.slug \? <Link className="lgm-pl"[^>]*>\{l\.name\}<\/Link> : l\.name/);
});

// -------------------------------------------------------------- reads + zero

test('EVERY MODULE IS ABSENT AT ZERO, never an empty frame', () => {
  const pairs = [
    ['components/league/ReadsModule.js', /if \(!reads\?\.length\) return null/],
    ['components/league/WeekLeaders.js', /if \(!leaders\?\.length\) return null/],
    ['components/league/StandingsSnapshot.js', /if \(!snapshot\?\.rows\?\.length\) return null/],
    ['components/league/MarketModule.js', /if \(!live\.length\) return null/],
    ['components/league/RankRail.js', /if \(!chips\?\.length\) return null/],
  ];
  for (const [f, re] of pairs) assert.match(strip(src(f)), re, `${f} must vanish at zero`);
});

// ------------------------------------------------------------ retirements

test('THE RETIRED FURNITURE IS GONE FROM THE LANDING', () => {
  const t = strip(src('components/gridiron/TodayPage.js'));
  for (const gone of ['gi-lede', 'gi-instrument', 'gi-standings', 'PlayoffPicture',
                      'SuiteTeasers', 'UpsetWatch', 'TheRead', 'EditorialBoard',
                      'MarketBoard', 'FantasyBoard', 'MovementCard']) {
    assert.equal(t.includes(gone), false, `${gone} must not render on the league landing`);
  }
  // and the readers that fed only them are no longer imported here
  for (const r of ['getStandings', 'getMarketMovers', 'getUpsetWatch', 'getEditorialBoard',
                   'getTitleContenders', 'getGlobalMostDrafted', 'getMovementCard']) {
    assert.equal(t.includes(r), false, `${r} must not be read by the landing`);
  }
});

test('the components retired to zero importers are DELETED, not left dead', () => {
  // MarketBoard, RailCards (SuiteTeasers/UpsetWatch/TheRead) and leagueCopy
  // lost their last consumer with this relay. A component nobody imports is a
  // component nobody maintains and somebody eventually re-mounts.
  for (const f of ['components/gridiron/MarketBoard.js', 'components/gridiron/RailCards.js',
                   'components/gridiron/leagueCopy.js']) {
    assert.equal(existsSync(path.join(REPO, f)), false, `${f} should have been deleted`);
  }
  // PlayoffPicture, EditorialBoard and MovementCard are still used ELSEWHERE
  // (the rankings hub, the home page, /my), so they stay.
  for (const f of ['components/gridiron/PlayoffPicture.js', 'components/gridiron/EditorialBoard.js',
                   'components/fantasy/MovementCard.js']) {
    assert.ok(existsSync(path.join(REPO, f)), `${f} is still used off the landing`);
  }
});
