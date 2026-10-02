// lib/leagues/settings.test.mjs - the rules a league is made under (PURE).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  validateLeagueSettings, leagueGameChoices, gameRows, gamesFromRows, summaryLine, leagueChips,
  chooseStart, spanLine, spanHolds, SETTING_REFUSALS, MEMBERS_DEFAULT,
} from './settings.js';
import { LEAGUE_GAME_KEYS } from './gameTypes.js';
import { parseInviteKey, inviteKeyFromCallback, invitePath, INVITE_TOKEN_LENGTH, CODE_LENGTH } from './code.js';

const base = { games: ['pickem'], span: 'season', scoring: 'total', format: 'table', maxMembers: 12 };
const v = (over, opts = { survivor: false }) => validateLeagueSettings({ ...base, ...over }, opts);

test('a single game, total points, season table is a league', () => {
  const r = v({});
  assert.equal(r.ok, true);
  assert.deepEqual(r.settings, { games: ['pickem'], span: 'season', scoring: 'total', format: 'table', dropWorst: false, maxMembers: 12, lateJoins: false });
});

test('TOTAL POINTS NEEDS EXACTLY ONE GAME - a bundle must use rank points', () => {
  const bundle = v({ games: ['pickem', 'weekly'], scoring: 'total' });
  assert.equal(bundle.ok, false);
  assert.equal(bundle.reason, SETTING_REFUSALS.total_one_game);
  assert.equal(v({ games: ['pickem', 'weekly'], scoring: 'rank' }).ok, true);
  assert.equal(v({ games: ['daily'], scoring: 'rank' }).ok, true, 'rank is allowed for one game too');
});

test('at least one game, every one registered', () => {
  assert.equal(v({ games: [] }).reason, SETTING_REFUSALS.no_games);
  assert.equal(v({ games: ['bracket'] }).reason, SETTING_REFUSALS.unknown_game);
  assert.deepEqual(v({ games: 'weekly,pickem,weekly', scoring: 'rank' }).settings.games, ['pickem', 'weekly'],
    'a comma list, de-duplicated, in calendar order');
});

test('SURVIVOR IS EXCLUDED while its flag is off - offered and accepted only when on', () => {
  const off = leagueGameChoices({ survivor: false }).map((g) => g.key);
  assert.ok(!off.includes('survivor'));
  assert.deepEqual(off, LEAGUE_GAME_KEYS.filter((k) => k !== 'survivor'), 'every other game is offered');
  assert.ok(leagueGameChoices({ survivor: true }).some((g) => g.key === 'survivor'));
  assert.equal(v({ games: ['survivor'] }, { survivor: false }).reason, SETTING_REFUSALS.survivor_off);
  assert.equal(v({ games: ['survivor'] }, { survivor: true }).ok, true);
  // The default reads the real flag, and the real flag is off on this tree.
  assert.ok(!leagueGameChoices({}).some((g) => g.key === 'survivor') || process.env.SURVIVOR === 'on');
});

test('a daily span only holds day games', () => {
  assert.equal(v({ span: 'daily' }).reason, SETTING_REFUSALS.daily_span, "Pick'em is a week");
  assert.equal(v({ games: ['daily'], span: 'daily' }).ok, true);
  assert.equal(v({ games: ['daily', 'october', 'six'], span: 'daily', scoring: 'rank' }).ok, true);
  assert.equal(spanHolds('weekly', ['pickem', 'daily']), true);
});

test('guillotine and drop-worst need a season; they do not combine', () => {
  assert.equal(v({ format: 'guillotine', span: 'weekly' }).reason, SETTING_REFUSALS.guillotine_season);
  assert.equal(v({ format: 'guillotine' }).ok, true);
  assert.equal(v({ dropWorst: true, span: 'weekly' }).reason, SETTING_REFUSALS.drop_season);
  assert.equal(v({ dropWorst: true, format: 'guillotine' }).reason, SETTING_REFUSALS.drop_season);
  assert.equal(v({ dropWorst: 'on' }).settings.dropWorst, true, 'a checkbox value reads as true');
});

test('max members is 2 to 100, an integer', () => {
  for (const bad of [1, 101, 2.5, 'x', null]) assert.equal(v({ maxMembers: bad }).reason, SETTING_REFUSALS.bad_members, String(bad));
  assert.equal(v({ maxMembers: '2' }).ok, true);
  assert.equal(v({ maxMembers: 100 }).ok, true);
  assert.equal(MEMBERS_DEFAULT, 12);
});

test('bad span / scoring / format each get their sentence', () => {
  assert.equal(v({ span: 'monthly' }).reason, SETTING_REFUSALS.bad_span);
  assert.equal(v({ scoring: 'avg' }).reason, SETTING_REFUSALS.bad_scoring);
  assert.equal(v({ format: 'bracket' }).reason, SETTING_REFUSALS.bad_format);
});

test("game rows: one per sport, 'all' for a game with none; round-trips to keys", () => {
  const rows = gameRows(['pickem', 'daily']);
  assert.deepEqual(rows, [
    { game_type: 'pickem', sport: 'nfl' }, { game_type: 'pickem', sport: 'cfb' }, { game_type: 'daily', sport: 'all' },
  ]);
  assert.deepEqual(gamesFromRows(rows), ['pickem', 'daily']);
});

test('the summary bar and the card chips read the settings', () => {
  assert.equal(summaryLine({ games: ['pickem', 'weekly'], span: 'season', scoring: 'rank', format: 'table' }),
    "Pick'em + The Weekly · Season · Rank points · Table");
  assert.deepEqual(leagueChips({ games: ['daily'], span: 'season', format: 'guillotine' }), ['The Daily', 'Season', 'Guillotine']);
});

test('the start anchor: week games on the NFL week, day games on tomorrow, the league on the earliest', () => {
  const anchors = {
    nfl: { season: 2026, week: 5, at: '2026-10-09T00:15:00.000Z' },
    day: { date: '2026-10-03', at: '2026-10-03T04:00:00Z' },
  };
  assert.deepEqual(chooseStart(['pickem'], anchors),
    { startsAt: '2026-10-09T00:15:00.000Z', startSeason: 2026, startWeek: 5, startDate: null });
  assert.deepEqual(chooseStart(['daily'], anchors),
    { startsAt: '2026-10-03T04:00:00.000Z', startSeason: null, startWeek: null, startDate: '2026-10-03' });
  const both = chooseStart(['pickem', 'daily'], anchors);
  assert.equal(both.startsAt, '2026-10-03T04:00:00.000Z', 'the earliest anchor is the late-join line');
  assert.equal(both.startWeek, 5);
  assert.deepEqual(chooseStart(['pickem'], { nfl: null, day: anchors.day }).startsAt, null, 'no NFL week left: not anchored');
  assert.match(spanLine('season', ['pickem'], anchors), /^Season runs Week 5 to Week 18/);
  assert.match(spanLine('daily', ['daily'], anchors), /every day, from Sat, Oct 3/);
});

test('invite keys: six is a code, twelve is a token, anything else is nothing', () => {
  assert.deepEqual(parseInviteKey(' abc-def '.replace('c', 'C')), { kind: 'code', value: 'ABCDEF' });
  assert.equal(parseInviteKey('ABCDEFGHJKMN').kind, 'token');
  assert.equal(INVITE_TOKEN_LENGTH, 12);
  assert.equal(CODE_LENGTH, 6);
  assert.equal(parseInviteKey('ABCDE'), null);
  assert.equal(parseInviteKey('ABCDE0'), null, 'a confusable is never ours');
  assert.equal(parseInviteKey('../../x'), null);
  assert.equal(invitePath('ABCDEF'), '/j/ABCDEF');
  assert.equal(inviteKeyFromCallback('/j/abcdef?shell=sim-app'), 'ABCDEF');
  assert.equal(inviteKeyFromCallback('/join/ABCDEFGH'), null, 'the fantasy invite is a different door');
});
