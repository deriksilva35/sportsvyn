// lib/widget/feed.test.mjs - the widget feed's SHAPE, SIZE and FIXTURES (sun-22).
// Pure: no database. The route and its auth states are app/api/widget/v1/route.test.mjs.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  serializeFeed, signedOutFeed, ageFeed, parseTeamIds, hrefOf, badge, isUrgent, teamRow, clockOf, winProbFor, playBlocks, dailyBlock, z, clip,
  byteSize, SIZE_LIMIT, GAMES_MAX, TEAMS_MAX, IN_YOUR_GAMES_MAX, URGENT_MS, STR_MAX,
} from './shape.js';
import { validate, FEED, PICKER } from './schema.js';
import { fixtureFeeds, fixturePicker, FIXTURE_NOW } from './fixtureInputs.js';
import { fixtureFiles } from '../../scripts/widget-fixtures.mjs';
import { playLobby } from '../games/playLobby.js';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const FIX_DIR = path.join(REPO, 'docs', 'widgets', 'fixtures');
const NOW = FIXTURE_NOW;
const at = (min) => new Date(NOW.getTime() + min * 60_000).toISOString();

// ---------------------------------------------------------------------------
// FIXTURES: the six the Mac builds against
// ---------------------------------------------------------------------------

test('the six fixtures exist, and nothing else is in the directory', () => {
  assert.deepEqual(readdirSync(FIX_DIR).sort(),
    ['age-pending.json', 'live-game.json', 'signed-in-busy.json', 'signed-in-quiet.json', 'signed-out.json', 'teams.json']);
});

test('every fixture on disk is the real serializer\'s output today (no drift: rerun scripts/widget-fixtures.mjs)', () => {
  const want = fixtureFiles();
  for (const [f, text] of Object.entries(want)) {
    assert.equal(readFileSync(path.join(FIX_DIR, f), 'utf8'), text, `${f} is stale - run node scripts/widget-fixtures.mjs`);
  }
});

test('every feed fixture validates against the schema; the teams fixture against the picker schema', () => {
  for (const f of readdirSync(FIX_DIR)) {
    const payload = JSON.parse(readFileSync(path.join(FIX_DIR, f), 'utf8'));
    const errs = validate(payload, f === 'teams.json' ? PICKER : FEED);
    assert.deepEqual(errs, [], `${f}: ${errs.join('; ')}`);
  }
});

test('the fixtures cover what they are named for', () => {
  const f = fixtureFeeds();
  assert.equal(f['signed-out'].state, 'signed_out');
  assert.equal(f['age-pending'].state, 'age_required');
  assert.equal(f['age-pending'].cta.href, '/age');
  assert.equal(f['signed-in-busy'].games.length, GAMES_MAX, 'busy is maxed: games');
  assert.equal(f['signed-in-busy'].teams.length, TEAMS_MAX, 'busy is maxed: teams');
  assert.equal(f['signed-in-busy'].inYourGames.length, IN_YOUR_GAMES_MAX, 'busy is maxed: inYourGames');
  assert.ok(f['signed-in-busy'].games.some((g) => g.urgent) && f['signed-in-busy'].games.some((g) => !g.urgent));
  assert.equal(f['signed-in-quiet'].yourMove.count, 0);
  const live = f['live-game'];
  assert.equal(live.teams[0].status, 'live');
  assert.equal(live.teams[0].clock, 'Q3 7:22');
  assert.equal(live.teams[0].winProb, 81);
  assert.equal(live.inYourGames[0].pickState, 'winning');
  assert.ok(fixturePicker().followed.length >= 1);
});

// ---------------------------------------------------------------------------
// SIZE
// ---------------------------------------------------------------------------

test('SIZE: a feed with every list full and every string at its cap stays under 8 KB', () => {
  const long = (n) => 'W'.repeat(n + 20); // clipped by the serializer, with a multi-byte ellipsis
  const items = Array.from({ length: 12 }, (_, i) => ({
    key: `k${i}-${long(32)}`, sport: 'nfl', name: long(STR_MAX), title: long(STR_MAX), status: long(STR_MAX), href: `/${'h'.repeat(63)}`, // HREF_MAX exactly: a longer one is dropped, not clipped
    locksAt: at(10 + i), opensAt: null, settled: false, complete: false, progress: { done: 1, total: 99999 },
  }));
  const teams = Array.from({ length: 10 }, (_, i) => ({
    teamId: 100000 + i, teamAbbr: long(6), teamName: long(24), teamSlug: 'x', leagueSlug: 'nfl', color: '#AAAAAA', altColor: '#BBBBBB',
    gameId: 9999990 + i, gameSlug: 'g'.repeat(54), status: 'live', kickoffAt: at(-60), homeTeamId: 100000 + i, homeScore: 100, awayScore: 99,
    liveState: { period: 4, clock: '14:59', win_prob: 99, win_prob_at: at(0) }, oppId: 200000 + i, oppAbbr: long(6), oppName: long(24), nextAt: at(9999),
  }));
  const games = Array.from({ length: 10 }, (_, i) => ({
    id: 9999990 + i, slug: 's'.repeat(54), leagueSlug: 'nfl', status: 'live', kickoffAt: at(-60), homeScore: 100, awayScore: 99,
    liveState: { period: 4, clock: '14:59' },
    home: { id: 1, abbreviation: long(6), colors: { primary: '#AAAAAA' } }, away: { id: 2, abbreviation: long(6), colors: { primary: '#BBBBBB' } },
  }));
  const stakes = new Map(games.map((g) => [g.id, { pick: { side: 'home', abbr: long(6), state: 'winning' },
    weekly: Array.from({ length: 6 }, () => ({ name: 'x', points: 33.33 })) }]));
  const payload = serializeFeed({
    view: playLobby(items, { now: NOW, signedIn: true }), daily: { state: 'in-progress', closesAt: at(60) }, streak: 99999,
    teamRows: teams, stakeGames: games, stakes, phoneOn: true,
  }, NOW);
  assert.deepEqual(validate(payload, FEED), []);
  assert.equal(payload.games.length, GAMES_MAX);
  assert.equal(payload.teams.length, TEAMS_MAX);
  assert.equal(payload.inYourGames.length, IN_YOUR_GAMES_MAX);
  assert.ok([...payload.games, ...payload.teams, ...payload.inYourGames].every((r) => r.href?.length === 64), 'every href at its cap');
  const bytes = byteSize(payload);
  assert.ok(bytes < SIZE_LIMIT, `maxed feed is ${bytes} bytes, limit ${SIZE_LIMIT}`);
  // and the busy fixture, as sent (compact JSON)
  assert.ok(byteSize(fixtureFeeds()['signed-in-busy']) < SIZE_LIMIT);
});

// ---------------------------------------------------------------------------
// TIMES
// ---------------------------------------------------------------------------

test('TIMES: every time in every fixture is UTC ISO ending in Z', () => {
  const walk = (v, k, out) => {
    if (Array.isArray(v)) v.forEach((x) => walk(x, k, out));
    else if (v && typeof v === 'object') for (const [kk, x] of Object.entries(v)) walk(x, kk, out);
    else if (/At$/.test(k ?? '') || k === 'at') out.push([k, v]);
    return out;
  };
  for (const [name, p] of Object.entries(fixtureFeeds())) {
    for (const [k, v] of walk(p, null, [])) {
      if (v == null) continue;
      assert.match(v, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/, `${name}.${k}`);
    }
  }
  assert.equal(z('2026-10-04 13:00:00-04'), '2026-10-04T17:00:00.000Z');
  assert.equal(z(null), null);
  assert.equal(z('not a date'), null);
});

// ---------------------------------------------------------------------------
// URGENT
// ---------------------------------------------------------------------------

test('URGENT: open, not complete, next lock within 60 minutes (60:00 exactly is urgent; 60:01 is not)', () => {
  const base = { settled: false, opensAt: null, complete: false };
  assert.equal(isUrgent({ ...base, locksAt: at(60) }, NOW), true);
  assert.equal(URGENT_MS, 3_600_000);
  assert.equal(isUrgent({ ...base, locksAt: new Date(NOW.getTime() + URGENT_MS + 1000).toISOString() }, NOW), false);
  assert.equal(isUrgent({ ...base, locksAt: at(5), complete: true }, NOW), false, 'a finished card is never urgent');
  assert.equal(isUrgent({ ...base, locksAt: at(-1) }, NOW), false, 'a passed lock is not urgent, it is locked');
  assert.equal(isUrgent({ ...base, locksAt: at(5), settled: true }, NOW), false);
  assert.equal(isUrgent({ ...base, locksAt: at(5), opensAt: at(1) }, NOW), false, 'not open yet');
});

test('GAMES: moves first, then in-play; never the Daily, a settled game or an unopened door', () => {
  const items = [
    { key: 'a', sport: 'nfl', name: 'A', locksAt: at(100), complete: false },
    { key: 'b', sport: 'nfl', name: 'B', locksAt: at(10), complete: false },
    { key: 'c', sport: 'nfl', name: 'C', locksAt: null, complete: false },
    { key: 'd', sport: 'nfl', name: 'D', settled: true },
    { key: 'e', sport: 'mlb', name: 'E', opensAt: at(600), locksAt: null },
    { key: 'daily', sport: 'all', name: 'The Daily', locksAt: at(300), complete: false },
  ];
  const { yourMove, games } = playBlocks(playLobby(items, { now: NOW, signedIn: true }), NOW);
  assert.equal(yourMove.count, 3, 'a, b and the Daily are moves');
  assert.deepEqual(yourMove.nextLock, { game: 'B', sport: 'NFL', at: at(10) });
  assert.deepEqual(games.map((g) => g.key), ['b', 'a', 'c']);
});

test('DAILY: open only while playable and before it closes; streak an integer', () => {
  assert.deepEqual(dailyBlock({ state: 'play', closesAt: at(60) }, 4, NOW), { state: 'play', open: true, closesAt: at(60), streak: 4, href: '/daily/board' });
  assert.equal(dailyBlock({ state: 'done', closesAt: at(60) }, 4, NOW).open, false);
  assert.equal(dailyBlock({ state: 'play', closesAt: at(-1) }, 4, NOW).open, false);
  assert.equal(dailyBlock(null, 4, NOW), null);
  assert.equal(dailyBlock({ state: 'none', closesAt: null }, null, NOW).streak, 0);
});

// ---------------------------------------------------------------------------
// TEAMS
// ---------------------------------------------------------------------------

test('TEAMS: oriented to the followed side; W/L/T on a final; nulls (never 0) before a game', () => {
  const r = { teamId: 7, teamAbbr: 'DEN', teamName: 'Broncos', leagueSlug: 'nfl', gameId: 1, gameSlug: 's', homeTeamId: 8,
    status: 'final', homeScore: 20, awayScore: 20, kickoffAt: at(-300), oppId: 8, oppAbbr: 'LV', liveState: { period: 4 } };
  const t = teamRow(r, { now: NOW });
  assert.equal(t.home, false);
  assert.equal(t.result, 'T');
  assert.equal(t.clock, 'Final');
  const pre = teamRow({ ...r, status: 'scheduled', homeScore: 0, awayScore: 0 }, { now: NOW });
  assert.equal(pre.status, 'pre');
  assert.equal(pre.score, null);
  assert.equal(pre.oppScore, null);
  const none = teamRow({ teamId: 7, teamAbbr: 'DEN', teamSlug: 'denver-broncos', leagueSlug: 'nfl', gameId: null }, { now: NOW });
  assert.equal(none.status, 'none');
  assert.equal(none.href, '/team/denver-broncos');
  assert.equal(none.home, null);
});

test('WIN PROB: live, displayed sport, phone switch on, fresh, and from the followed side', () => {
  const ls = { period: 3, clock: '1:00', win_prob: 70, win_prob_at: at(-1) };
  const o = { status: 'live', liveState: ls, leagueSlug: 'nfl', home: true, phoneOn: true, now: NOW };
  assert.equal(winProbFor(o), 70);
  assert.equal(winProbFor({ ...o, home: false }), 30);
  assert.equal(winProbFor({ ...o, phoneOn: false }), null, 'WINPROB_PHONE off: no number on the phone');
  assert.equal(winProbFor({ ...o, leagueSlug: 'mlb' }), null, 'MLB displays none');
  assert.equal(winProbFor({ ...o, status: 'final' }), null);
  assert.equal(winProbFor({ ...o, liveState: { ...ls, win_prob_at: at(-6) } }), null, 'older than 5 minutes');
  assert.equal(winProbFor({ ...o, liveState: { ...ls, win_prob: 50.5 } }), null);
});

test('CLOCK: per sport, from the shared vocabulary', () => {
  assert.equal(clockOf('live', { period: 2, clock: '00:00' }, 'nfl'), 'HT');
  assert.equal(clockOf('live', { period: 5, clock: '3:10' }, 'cfb'), 'OT 3:10');
  assert.equal(clockOf('live', { period: 7, half: 'bottom' }, 'mlb'), 'Bot 7th');
  assert.equal(clockOf('live', { period: 3, clock: '5:55' }, 'nba'), 'Q3 5:55');
  assert.equal(clockOf('live', null, 'nfl'), 'Live');
  assert.equal(clockOf('final', { period: 10 }, 'mlb'), 'F/10');
  assert.equal(clockOf('scheduled', null, 'nfl'), null);
});

// ---------------------------------------------------------------------------
// STATES, CLIPPING, PARAMS
// ---------------------------------------------------------------------------

test('STATES: signed out and age-pending carry no data and a CTA', () => {
  for (const [p, href] of [[signedOutFeed(NOW), '/signin'], [ageFeed(NOW), '/age']]) {
    assert.deepEqual(validate(p, FEED), []);
    assert.equal(p.cta.href, href);
    assert.deepEqual([p.games, p.teams, p.inYourGames, p.daily, p.yourMove.count], [[], [], [], null, 0]);
  }
});

test('clip, hrefOf, badge and parseTeamIds', () => {
  assert.equal(badge(null, 'Abilene Christian'), 'AC', 'no abbreviation: derived from the name, never a clipped name');
  assert.equal(badge('BUF', 'Buffalo Bills'), 'BUF');
  assert.equal(hrefOf(`/${'a'.repeat(63)}`).length, 64);
  assert.equal(hrefOf(`/${'a'.repeat(64)}`), null, 'too long: dropped whole, never clipped');
  assert.equal(hrefOf('https://evil.example/x'), null, 'site paths only');
  assert.equal(clip('x'.repeat(50)).length, STR_MAX);
  assert.equal(clip('  a   b  '), 'a b');
  assert.equal(clip(''), null);
  assert.deepEqual(parseTeamIds('4, 4,abc,-2,7,9,11,13'), [4, 7, 9, 11]);
  assert.equal(parseTeamIds(''), null);
  assert.equal(parseTeamIds('x'), null);
});

test('the validator rejects what it should (an extra key, a non-Z time, a missing key)', () => {
  const ok = signedOutFeed(NOW);
  assert.match(validate({ ...ok, extra: 1 }, FEED).join(), /extra: not in the schema/);
  assert.match(validate({ ...ok, generatedAt: '2026-10-04T13:30:00-04:00' }, FEED).join(), /UTC ISO/);
  const { daily, ...noDaily } = ok;
  assert.match(validate(noDaily, FEED).join(), /daily: missing/);
});
