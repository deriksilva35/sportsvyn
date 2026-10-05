// lib/widget/feed.test.mjs - the widget feed's SHAPE, SIZE and FIXTURES (sun-22).
// Pure: no database. The route and its auth states are app/api/widget/v1/route.test.mjs.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  serializeFeed, signedOutFeed, ageFeed, parseTeamIds, hrefOf, badge, inYourGamesBlock, isUrgent, teamRow, clockOf, winProbFor, playBlocks, dailyBlock, z, clip,
  byteSize, SIZE_LIMIT, STAKE_KINDS, nextOpening, lineupStakes, topPlayerOf, livePossession, GAMES_MAX, TEAMS_MAX, IN_YOUR_GAMES_MAX, URGENT_MS, STR_MAX,
} from './shape.js';
import { validate, FEED, PICKER } from './schema.js';
import { fixtureFeeds, fixturePicker, FIXTURE_NOW } from '../../scripts/widget-fixtures/inputs.mjs';
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
  // NOTHING OPEN: the quiet day's list is the next opening, not empty
  // NOTHING OPEN: games[] is empty and the top-level nextOpening says what is next
  assert.deepEqual(f['signed-in-quiet'].games, []);
  assert.deepEqual(f['signed-in-quiet'].nextOpening,
    { key: 'nfl-weekly', sport: 'NFL', name: 'The Weekly', title: 'Week 6', opensAt: at(60 * 40), href: '/weekly' });
  assert.equal(f['signed-in-busy'].nextOpening.key, 'nba-pickem', 'the busy fixture carries it too');
  assert.equal('nextOpening' in f['live-game'], false, 'absent, never null, when no door is ahead');
  // THE LINEUP STAKES: October + Run + a series pick in PHI@MIL
  const phi = f['signed-in-busy'].inYourGames.find((g) => g.away === 'PHI');
  assert.deepEqual([phi.via, phi.pick, phi.players], [['series', 'october', 'run'], 'PHI', 2]);
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
    oppColor: '#CCCCCC', oppAltColor: '#DDDDDD',
    plays: [{ period: 4, clock: '15:00', down: 3, distance: 10, yardsToGoal: 45, yardsGained: 2, offenseTeamId: 200000 + i, playType: 'Rush', text: 'x' }],
  }));
  const games = Array.from({ length: 10 }, (_, i) => ({
    id: 9999990 + i, slug: 's'.repeat(54), leagueSlug: 'mlb', status: 'live', kickoffAt: at(-60), homeScore: 100, awayScore: 99,
    liveState: { period: 4, clock: '14:59' },
    home: { id: 1, abbreviation: long(6), colors: { primary: '#AAAAAA' } }, away: { id: 2, abbreviation: long(6), colors: { primary: '#BBBBBB' } },
  }));
  const stakes = new Map(games.map((g) => [g.id, { pick: { side: 'home', abbr: long(6), state: 'winning' },
    weekly: Array.from({ length: 6 }, () => ({ name: long(24), points: 33.33 })) }]));
  const payload = serializeFeed({
    view: playLobby(items, { now: NOW, signedIn: true }), daily: { state: 'in-progress', closesAt: at(60) }, streak: 99999,
    items: [...items, { key: `up-${long(32)}`, sport: 'nba', name: long(STR_MAX), title: long(STR_MAX), href: `/${'h'.repeat(63)}`, opensAt: at(600), locksAt: null }],
    teamRows: teams, stakeGames: games, stakes, phoneOn: true,
    // EVERY LINEUP KIND ON EVERY GAME, so `via` is at its longest
    lineups: {
      october: Object.fromEntries(games.map((g, i) => [`b${i}`, { matchId: g.id, name: 'x' }])),
      six: Object.fromEntries(games.map((g, i) => [`s${i}`, { matchId: g.id, name: 'x' }])),
      run: { arm: { teamId: 1, name: 'x' } },
      series: { board: [{ series_key: 'k', teams: [{ team_id: 1 }, { team_id: 2 }] }], lineup: { k: 1 } },
      // The Draft is NFL-only and The Run / Series MLB-only, so no real game
      // carries all seven; these MLB rows carry six, the most one can.
      draft: [],
    },
  }, NOW);
  assert.deepEqual(validate(payload, FEED), []);
  assert.ok(payload.inYourGames.every((r) => r.via.length === STAKE_KINDS.length - 1), 'via at its longest (six of seven)');
  assert.ok(payload.inYourGames.every((r) => r.topPlayer?.length === 24), 'topPlayer at its cap');
  assert.ok(payload.teams.every((t) => t.oppColor && t.oppAltColor && t.possession && t.fieldPos), 'every optional team field present');
  assert.equal(payload.games.length, GAMES_MAX);
  assert.equal(payload.nextOpening.href.length, 64, 'nextOpening present and at its caps');
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

// ---------------------------------------------------------------------------
// sun-23: THE NEXT OPENING, THE LINEUP STAKES, THE PER-LEAGUE PHONE SWITCH
// ---------------------------------------------------------------------------

test('NEXT OPENING (sun-25): top-level and optional; the soonest door; never the Daily; never a games[] row', () => {
  const items = [
    { key: 'cfb-pickem', sport: 'cfb', name: "Pick'em", title: 'Week 7', status: 'Top 25 Saturday', opensAt: at(60 * 20), locksAt: null, href: '/pickem/cfb' },
    { key: 'nfl-weekly', sport: 'nfl', name: 'The Weekly', title: 'Week 6', status: 'Set six', opensAt: at(60 * 40), locksAt: null },
    { key: 'daily', sport: 'all', name: 'The Daily', opensAt: at(60), locksAt: null },
    { key: 'old', sport: 'mlb', name: 'Done', settled: true },
  ];
  assert.equal(nextOpening(items, NOW).key, 'cfb-pickem');
  const feed = serializeFeed({ view: playLobby(items, { now: NOW, signedIn: true }), items }, NOW);
  assert.deepEqual(feed.games, [], 'no synthetic row');
  assert.deepEqual(feed.nextOpening, { key: 'cfb-pickem', sport: 'CFB', name: "Pick'em", title: 'Week 7', opensAt: at(60 * 20), href: '/pickem/cfb' });
  assert.doesNotMatch(JSON.stringify(feed.nextOpening), /AM|PM|\bET\b|\bPT\b/, 'no zone in any word');
  assert.deepEqual(validate(feed, FEED), []);
  assert.equal(nextOpening([], NOW), null);
  const none = serializeFeed({ view: playLobby([], { now: NOW, signedIn: true }), items: [] }, NOW);
  assert.equal('nextOpening' in none, false);
  assert.deepEqual(validate(none, FEED), [], 'absent is valid');
  assert.match(validate({ ...none, nextOpening: null }, FEED).join(), /nextOpening: null not allowed/);
  assert.match(validate({ ...none, nextOpen: {} }, FEED).join(), /nextOpen: not in the schema/, 'unknown keys still refused');
});

test('LINEUP STAKES: October and Six by match, The Run by club, Series by the two clubs', () => {
  const g = (id, lg, h, a) => ({ id, leagueSlug: lg, home: { id: h, abbreviation: `H${h}` }, away: { id: a, abbreviation: `A${a}` } });
  const games = [g(1, 'mlb', 10, 11), g(2, 'mlb', 12, 10), g(3, 'nba', 20, 21), g(4, 'mlb', 13, 14)];
  const m = lineupStakes(games, {
    october: { bat1: { matchId: 1, name: 'Bat' } },
    run: { arm: { teamId: 10, name: 'Arm' } },
    six: { G1: { matchId: 3, name: 'Guard' } },
    series: { board: [{ series_key: 'k', teams: [{ team_id: 13 }, { team_id: 14 }] }], lineup: { k: 14 } },
  });
  assert.deepEqual(m.get(1).players.map((p) => p.kind), ['october', 'run']);
  assert.deepEqual(m.get(2).players.map((p) => p.kind), ['run'], 'the club plays twice in the slate: both');
  assert.deepEqual(m.get(3).players, [{ kind: 'six', name: 'Guard' }]);
  assert.deepEqual(m.get(4).seriesPick, { side: 'away', abbr: 'A14' });
  assert.deepEqual(lineupStakes(games, {}).size, 0);
  const rows = inYourGamesBlock(games, new Map(), NOW, { six: { G1: { matchId: 3, name: 'Guard' } } });
  assert.deepEqual(rows.map((r) => [r.gameId, r.via, r.players, r.points, r.pick]), [[3, ['six'], 1, null, null]]);
});

test('PHONE SWITCH: a per-league function decides; a boolean still works', () => {
  const o = { status: 'live', liveState: { win_prob: 70, win_prob_at: at(-1) }, home: true, now: NOW };
  const perLeague = (lg) => lg === 'nfl';
  assert.equal(winProbFor({ ...o, leagueSlug: 'nfl', phoneOn: perLeague }), 70);
  assert.equal(winProbFor({ ...o, leagueSlug: 'cfb', phoneOn: perLeague }), null, 'CFB off on the phone');
  assert.equal(winProbFor({ ...o, leagueSlug: 'nfl', phoneOn: () => false }), null);
  assert.equal(winProbFor({ ...o, leagueSlug: 'nfl', phoneOn: true }), 70);
});

// ---------------------------------------------------------------------------
// sun-24: OPTIONAL ADDITIVE FIELDS (v stays 1)
// ---------------------------------------------------------------------------

test('OPTIONAL: possession + fieldPos on live football, opp colours, topPlayer - absent, never null, when empty', () => {
  const f = fixtureFeeds()['signed-in-busy'];
  assert.equal(f.v, 1, 'additive: the version does not move');
  const buf = f.teams.find((t) => t.team === 'BUF');
  assert.deepEqual([buf.possession, buf.fieldPos, buf.oppColor, buf.oppAltColor], ['BUF', 'NYJ 35', '#125740', '#FFFFFF']);
  const lad = f.teams.find((t) => t.team === 'LAD');
  for (const k of ['possession', 'fieldPos', 'oppColor', 'oppAltColor']) assert.equal(k in lad, false, `LAD.${k} absent`);
  const phi = f.teams.find((t) => t.team === 'PHI');
  assert.equal('possession' in phi, false, 'baseball: no possession');
  const g = f.inYourGames.find((x) => x.gameId === 9101);
  assert.deepEqual([g.topPlayer, g.via, g.players], ['K. Shakir', ['pickem', 'weekly', 'draft'], 3]);
  assert.equal('topPlayer' in f.inYourGames.find((x) => x.away === 'KC'), false, 'a pick alone: no player');
});

test('topPlayerOf: by points, first on a tie, null when none', () => {
  assert.equal(topPlayerOf([{ name: 'A', points: 3 }, { name: 'B', points: 9 }, { name: 'C', points: 9 }]), 'B');
  assert.equal(topPlayerOf([{ name: 'A', points: 0 }, { name: 'B', points: 0 }]), 'A');
  assert.equal(topPlayerOf([]), null);
});

test('livePossession: football with plays only; the defence\'s half is named by the defence', () => {
  const r = { leagueSlug: 'nfl', teamId: 4, teamAbbr: 'BUF', oppId: 25, oppAbbr: 'NYJ',
    plays: [{ period: 1, clock: '9:00', down: 1, distance: 10, yardsToGoal: 70, yardsGained: 0, offenseTeamId: 25, playType: 'Pass', text: 'x' }] };
  assert.deepEqual(livePossession(r, true), { possession: 'NYJ', fieldPos: 'NYJ 30' });
  assert.deepEqual(livePossession({ ...r, leagueSlug: 'mlb' }, true), {});
  assert.deepEqual(livePossession({ ...r, plays: [] }, true), {});
});

test('the validator: an optional key may be absent, but never null or the wrong type', () => {
  const t = fixtureFeeds()['signed-in-busy'].teams[0];
  const feed = { ...fixtureFeeds()['signed-in-busy'], teams: [{ ...t, possession: null }] };
  assert.match(validate(feed, FEED).join(), /possession: null not allowed/);
  const feed2 = { ...fixtureFeeds()['signed-in-busy'], teams: [{ ...t, fieldPos: 35 }] };
  assert.match(validate(feed2, FEED).join(), /fieldPos: expected string/);
});

test('sun-25: the busy fixture carries EVERY optional field, by the Mac\'s names', () => {
  const f = fixtureFeeds()['signed-in-busy'];
  assert.ok(f.nextOpening && f.nextOpening.opensAt, 'nextOpening');
  for (const k of ['oppColor', 'oppAltColor', 'possession', 'fieldPos']) assert.ok(f.teams.some((t) => t[k] != null), `teams[].${k}`);
  assert.ok(f.inYourGames.some((g) => g.topPlayer), 'inYourGames[].topPlayer');
  assert.ok(fixtureFeeds()['signed-in-quiet'].nextOpening, 'the quiet day shows nextOpening');
});
