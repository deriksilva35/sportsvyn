// lib/nba/gamePageView.test.mjs - nbaGameView's feed-backed modules, with the feed injected
// (thu1-nba-page). No network: `feed` is a stub of lib/nba/pageFeed.js. The view's other
// reads (odds, chips, In your games) hit DEV with a game id nothing holds, and are caught.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { nbaGameView } from './gamePageView.js';

const game = (status = 'scheduled') => ({
  id: -4242, bdlGameId: '900', slug: 'nba-test-bos-det', leagueSlug: 'nba', status, kickoffAt: '2099-01-01T00:00:00Z',
  seasonYear: 2026, seasonPhase: 'regular', week: null, homeScore: null, awayScore: null, liveState: null, detail: {}, marketPrior: null,
  home: { id: 2, bdlId: '9', abbreviation: 'DET', name: 'Pistons', shortName: 'Pistons', colors: null },
  away: { id: 1, bdlId: '2', abbreviation: 'BOS', name: 'Celtics', shortName: 'Celtics', colors: null },
});
const pl = (id, first, team) => ({ id, first_name: first, last_name: 'Q', position: 'G', team_id: team });
const lu = (gid, team, id, name, pos) => ({ game_id: gid, starter: true, position: pos, player: pl(id, name, team), team: { id: team } });
const FINAL = { key: 'f1', bdlGameId: '800', at: '2026-10-20T19:00:00Z', homeBdl: '9', awayBdl: '2', homeAbbr: 'DET', awayAbbr: 'BOS', homeScore: 121, awayScore: 113 };
const FEED = {
  readOdds: async () => [{ vendor: 'draftkings', spread_home_value: '-1.5', total_value: '240.5' }],
  readStandings: async () => [{ team: { id: 2 }, wins: 1, losses: 0 }, { team: { id: 9 }, wins: 0, losses: 1 }],
  readInjuries: async () => ({ fetchedAt: new Date('2026-10-21T22:36:30Z'), rows: [{ player: pl(1, 'Hurt', 2), status: 'Out', description: 'Injury/Illness - Knee (2026-10-21)' }] }),
  readLineups: async (gid) => (gid === '900' ? [] : [lu(gid, 2, 11, 'Aaa', 'G'), lu(gid, 9, 12, 'Bbb', 'F')]),
  readRoster: async (t) => [pl(t === '2' ? 21 : 22, 'Lead', Number(t))],
  readSeasonAverages: async () => [{ player: pl(21, 'Lead', 2), stats: { gp: 1, pts: 30, reb: 5, ast: 4, fg3m: 3 } }],
  readTeamGames: async () => [],
};

test('PRE: every feed module is drawn from its read, the header carries the feed\'s line when we hold none', async () => {
  const v = await nbaGameView({ game: game(), feed: FEED, finalsFn: async () => [FINAL] });
  assert.equal(v.state, 'pre');
  for (const m of ['injuries', 'lineups', 'seasonleaders', 'last5']) assert.ok(v.modules.includes(m), m);
  assert.equal(v.x.spreadHome, -1.5);
  assert.equal(v.x.total, 240.5);
  assert.equal(v.injuries.updated, 'updated 3:36 PM PT');
  assert.equal(v.injuries.away[0].note, 'Knee');
  assert.equal(v.lineups.label, 'Projected', 'this game\'s lineup is empty: last time out');
  assert.deepEqual(v.lineups.away.map((p) => p.name), ['Aaa Q']);
  assert.deepEqual(v.seasonLeaders[0].away, [{ name: 'Q', line: '30.0' }]);
  assert.equal(v.last5.series, 'DET leads series 1-0');
  assert.equal(v.last5.away[0].win, false);
});

test('PRE: this game\'s own lineups, once out, are Confirmed', async () => {
  const feed = { ...FEED, readLineups: async (gid) => [lu(gid, 2, 11, 'Aaa', 'G'), lu(gid, 9, 12, 'Bbb', 'F')] };
  const v = await nbaGameView({ game: game(), feed, finalsFn: async () => [FINAL] });
  assert.equal(v.lineups.label, 'Confirmed');
});

test('PRE: a read that fails or times out hides its module and nothing else', async () => {
  const boom = async () => { throw new Error('timeout'); };
  const v = await nbaGameView({ game: game(), feed: { ...FEED, readInjuries: boom, readRoster: boom, readOdds: boom }, finalsFn: async () => [FINAL] });
  assert.ok(!v.modules.includes('injuries'));
  assert.ok(!v.modules.includes('seasonleaders'));
  assert.ok(v.modules.includes('lineups') && v.modules.includes('last5'));
  assert.equal(v.x.spreadHome, null);
  assert.equal(v.injuries, null);
  const none = await nbaGameView({ game: game(), feed: {}, finalsFn: async () => { throw new Error('db'); } });
  assert.deepEqual(none.modules.filter((m) => !['card', 'market', 'yours'].includes(m)), [], 'no feed, no database: the card alone');
});

test('PRE: no injuries for either team is no module; empty lineups and no history is no module', async () => {
  const v = await nbaGameView({ game: game(), feed: { ...FEED, readInjuries: async () => ({ rows: [], fetchedAt: new Date() }), readLineups: async () => [] }, finalsFn: async () => [] });
  assert.ok(!v.modules.includes('injuries'));
  assert.ok(!v.modules.includes('lineups'));
  assert.ok(!v.modules.includes('last5'));
});

test('PRE: a team with no finals of ours is asked of the feed (per team)', async () => {
  const asked = [];
  const feed = { ...FEED, readTeamGames: async (t) => { asked.push(t); return [{ id: 7, status_state: 'final', datetime: '2026-10-19T19:00:00Z', home_team_score: 100, visitor_team_score: 90, home_team: { id: 2, abbreviation: 'BOS' }, visitor_team: { id: 3, abbreviation: 'NYK' } }]; } };
  const v = await nbaGameView({ game: game(), feed, finalsFn: async () => [{ ...FINAL, homeBdl: '9', awayBdl: '4' }] });
  assert.deepEqual(asked, ['2'], 'DET has a final in the DB; BOS has none');
  assert.deepEqual(v.last5.away, [{ win: true, score: '100-90', opp: 'vs NYK' }]);
});

test('LIVE/FINAL: starters from the feed mark the box; no lineups, no marks; the pre modules are never read', async () => {
  let preRead = false;
  const feed = { ...FEED, readLineups: async () => [{ starter: true, player: { id: 5 }, team: { id: 2 } }], readInjuries: async () => { preRead = true; throw new Error('no'); } };
  const v = await nbaGameView({ game: game('final'), feed, finalsFn: async () => [] });
  assert.equal(v.injuries, null);
  assert.equal(preRead, false);
  assert.ok(!v.modules.includes('injuries'));
});
