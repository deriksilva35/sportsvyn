// lib/settle/footballRules.test.mjs - the sat-5 football settle rulings, PURE.
// The DB half is settleRulesDb.test.mjs.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  voidCutoff, pastVoidCutoff, inRegradeWindow, draftCountsSix, storedVoid, VOID_GRACE_MS, REGRADE_WINDOW_MS,
  regradeEligible, REGRADE_SETTLED_FROM,
} from './footballRules.js';
import { scoreSix, draftScorer } from '../draft/bestball.js';
import { scoreLineup } from '../daily/play.js';
import { settleReadiness } from '../weekly/rules.js';
import { regradePool, boardPointsChanged } from '../weekly/settle.js';
import { boardResults, perfectMax, regradeResults } from '../pickem/settle.js';

const src = (rel) => readFileSync(new URL(`../../${rel}`, import.meta.url), 'utf8');
const H = 3_600_000;

test('the void cutoff is settles_at + 48h, inclusive at the boundary', () => {
  const c = { settles_at: '2026-10-06T12:00:00Z' };
  assert.equal(VOID_GRACE_MS, 48 * H);
  assert.equal(voidCutoff(c).toISOString(), '2026-10-08T12:00:00.000Z');
  assert.equal(pastVoidCutoff(c, new Date('2026-10-08T11:59:59Z')), false);
  assert.equal(pastVoidCutoff(c, new Date('2026-10-08T12:00:00Z')), true);
  assert.equal(voidCutoff({ settles_at: null }), null, 'no settles_at, no cutoff');
  assert.equal(pastVoidCutoff({}, new Date('2099-01-01')), false);
});

test('the re-grade window is 7 days from kickoff', () => {
  assert.equal(REGRADE_WINDOW_MS, 7 * 24 * H);
  const ko = '2026-10-04T17:00:00Z';
  assert.equal(inRegradeWindow(ko, new Date(Date.parse(ko) + 7 * 24 * H)), true);
  assert.equal(inRegradeWindow(ko, new Date(Date.parse(ko) + 7 * 24 * H + 1)), false);
  assert.equal(inRegradeWindow(null, new Date()), false, 'no kickoff: frozen');
});

test('D2: the Draft counts six from NFL 2026 week 5, never the Weekly', () => {
  assert.equal(draftCountsSix({ game_type: 'draft', season_year: 2026, week: 4 }), false);
  assert.equal(draftCountsSix({ game_type: 'draft', season_year: 2026, week: 5 }), true);
  assert.equal(draftCountsSix({ game_type: 'draft', season_year: 2027, week: 1 }), true);
  assert.equal(draftCountsSix({ game_type: 'draft', season_year: 2025, week: 18 }), false);
  assert.equal(draftCountsSix({ game_type: 'weekly', season_year: 2026, week: 9 }), false);
  assert.equal(draftScorer({ game_type: 'draft', season_year: 2026, week: 4 }), scoreLineup, 'settled weeks keep their rule');
  assert.equal(draftScorer({ game_type: 'draft', season_year: 2026, week: 5 }), scoreSix);
});

test('scoreSix counts all six; scoreLineup drops the worst', () => {
  const board = [
    { id: 1, pos: 'QB', points: 20 }, { id: 2, pos: 'RB', points: 10 }, { id: 3, pos: 'WR', points: 15 },
    { id: 4, pos: 'TE', points: 5 }, { id: 5, pos: 'WR', points: 8 }, { id: 6, pos: 'RB', points: 2 },
  ];
  const lineup = { QB: 1, RB: 2, WR: 3, TE: 4, FLEX: 5, FLEX2: 6 };
  const six = scoreSix(lineup, board);
  assert.equal(six.baseScore, 60);
  assert.equal(six.droppedSlot, null);
  assert.ok(six.picks.every((p) => p.dropped === false));
  assert.equal(scoreLineup(lineup, board).baseScore, 58);
});

test('the Weekly gate: a non-final game blocks until the cutoff, then is void', () => {
  const games = [
    { id: 1, label: 'A@B', status: 'final', statLines: 40 },
    { id: 2, label: 'C@D', status: 'postponed', statLines: 0 },
  ];
  const before = settleReadiness(games);
  assert.equal(before.ready, false);
  assert.equal(before.reason, 'games not final');
  const after = settleReadiness(games, { voidAllowed: true });
  assert.equal(after.ready, true);
  assert.deepEqual(after.void, [2]);
  // A FINAL game with no stat lines still blocks after the cutoff: our feed is missing.
  const noStats = settleReadiness([{ id: 1, status: 'final', statLines: 0 }, { id: 2, status: 'scheduled' }], { voidAllowed: true });
  assert.equal(noStats.ready, false);
  assert.equal(noStats.reason, 'stat lines missing');
  // EVERY game void is an outage, not a week.
  assert.equal(settleReadiness([{ id: 2, status: 'cancelled' }], { voidAllowed: true }).ready, false);
});

test('regradePool: void stays 0, a frozen game keeps stored points, the rest recompute', () => {
  const now = new Date('2026-10-12T12:00:00Z');
  const games = [
    { id: 10, label: 'AAA@BBB', kickoff_at: '2026-10-02T00:15:00Z' }, // 10+ days: frozen
    { id: 11, label: 'CCC@DDD', kickoff_at: '2026-10-06T17:00:00Z' }, // in window
    { id: 12, label: 'EEE@FFF', kickoff_at: '2026-10-06T17:00:00Z' }, // void
  ];
  const stored = [
    { id: 1, team: 'AAA', points: 12 }, // frozen, rows say otherwise
    { id: 2, team: 'BBB', points: 7 }, // frozen, rows deleted - placed by team
    { id: 3, team: 'CCC', points: 5 }, // in window - corrected
    { id: 4, team: 'EEE', points: 0 }, // void
  ];
  const rows = [
    { id: 1, match_id: 10, rec: 10, rec_yds: 100 },
    { id: 3, match_id: 11, rec: 1, rec_yds: 90 },
    { id: 4, match_id: 12, rec: 5, rec_yds: 50 },
  ];
  const out = regradePool(stored, rows, games, { voidIds: new Set([12]), now });
  assert.deepEqual(out.map((p) => p.points), [12, 7, 10, 0]);
  assert.equal(boardPointsChanged(stored, out), true);
  assert.equal(boardPointsChanged(stored, stored.map((p) => ({ ...p }))), false);
});

test('Pick\'em results: a tie and a void are null and OUT of perfect.max (P4, ruling 2)', () => {
  const board = [{ match_id: 1 }, { match_id: 2 }, { match_id: 3 }];
  const byId = new Map([
    [1, { status: 'final', home_score: 21, away_score: 14 }],
    [2, { status: 'final', home_score: 17, away_score: 17 }],
    [3, { status: 'postponed' }],
  ]);
  const before = boardResults(board, byId);
  assert.equal(before.complete, false);
  assert.equal(before.remaining, 1);
  const after = boardResults(board, byId, { voidAllowed: true });
  assert.equal(after.complete, true);
  assert.deepEqual(after.results, { 1: 'home', 2: null, 3: null });
  assert.deepEqual(after.void, [3]);
  assert.equal(perfectMax(after.results), 1);
  const allVoid = boardResults([{ match_id: 3 }], byId, { voidAllowed: true });
  assert.equal(allVoid.complete, false, 'every game void is not a board');
});

test('Pick\'em regradeResults: stored void and frozen games stand; in-window finals re-read', () => {
  const now = new Date('2026-10-10T12:00:00Z');
  const board = [{ match_id: 1 }, { match_id: 2 }, { match_id: 3 }, { match_id: 4 }];
  const byId = new Map([
    [1, { status: 'final', home_score: 10, away_score: 20, kickoff_at: '2026-10-05T17:00:00Z' }], // corrected
    [2, { status: 'final', home_score: 30, away_score: 0, kickoff_at: '2026-10-01T00:15:00Z' }], // frozen
    [3, { status: 'final', home_score: 3, away_score: 0, kickoff_at: '2026-10-05T17:00:00Z' }], // stored void
    [4, { status: 'live', home_score: 3, away_score: 0, kickoff_at: '2026-10-05T17:00:00Z' }], // not final now
  ]);
  const stored = { 1: 'home', 2: 'away', 3: null, 4: 'away' };
  assert.deepEqual(regradeResults(board, byId, stored, { voids: [3], now }), { 1: 'away', 2: 'away', 3: null, 4: 'away' });
});

test('already-settled contests stand: only those settled from week 5\'s settle re-grade', () => {
  assert.equal(REGRADE_SETTLED_FROM, '2026-10-06T00:00:00Z');
  assert.equal(regradeEligible({ settled_at: '2026-09-29T14:00:00Z' }), false, 'week 4 stands');
  assert.equal(regradeEligible({ settled_at: '2026-10-13T09:00:00Z' }), true);
  assert.equal(regradeEligible({ settled_at: null }), false);
});

test('storedVoid reads meta.void as numbers', () => {
  assert.deepEqual(storedVoid({ meta: { void: ['5', 6] } }), [5, 6]);
  assert.deepEqual(storedVoid({ meta: {} }), []);
});

test('the crons: series boards daily, football cadence unchanged, the sweep daily', () => {
  const crons = JSON.parse(src('vercel.json')).crons;
  const by = (p) => crons.find((c) => c.path === p)?.schedule;
  assert.equal(by('/api/cron/pickem-settle'), '0 6-20 * * 0,1,2', 'football Pick\'em cadence unchanged');
  assert.equal(by('/api/cron/pickem-settle?scope=series'), '15 6-20 * * *', 'P5: series boards every day');
  assert.equal(by('/api/cron/weekly-settle'), '0 9-20 * * 2');
  assert.equal(by('/api/cron/draft-settle'), '0 10-21 * * 2');
  assert.equal(by('/api/cron/football-regrade'), '30 14 * * *');
  const route = src('app/api/cron/pickem-settle/route.js');
  assert.match(route, /searchParams\.get\('scope'\) === 'series'/);
  assert.match(route, /settleDuePickem\(\{ only: 'series' \}\)/);
  const sweep = src('app/api/cron/football-regrade/route.js');
  assert.match(sweep, /footballSweep\(\{ lock \}\)/);
  assert.match(sweep, /withAdvisoryLock\(SOURCE/);
  const lib = src('lib/settle/regrade.js');
  for (const s of ["'weekly-settle'", "'draft-settle'", "'pickem-settle'"]) assert.ok(lib.includes(s), `the sweep takes ${s}'s lock`);
  assert.match(lib, /settleDuePickem\(\{ now, only: 'football' \}\)/);
});

test('the rules are stated where players read them', () => {
  const hiw = src('app/games/how-it-works/page.js');
  assert.ok(hiw.includes("graded: 'Best ball, PPR. Best six of your eight count.'"));
  assert.ok(hiw.includes("graded: 'Right or wrong. A tie counts for nobody.'"));
  assert.equal((hiw.match(/A game not final 48 hours after the (week|board) settles is void/g) ?? []).length, 3);
  assert.equal((hiw.match(/within 7 days of a game re-grades the (week|board)/g) ?? []).length, 3);
  for (const f of ['app/draft/page.js', 'app/weekly/page.js']) {
    const t = src(f).replace(/\s+/g, ' ');
    assert.match(t, /A game not final 48 hours after the week settles is void and its players score 0\./, f);
    assert.match(t, /A stat correction within 7 days of a game re-grades the week\./, f);
    assert.doesNotMatch(t, /a settled week does not move again/, `${f}: no longer true`);
  }
  assert.match(src('app/draft/page.js'), /Best ball, PPR, best six count/);
  assert.doesNotMatch(src('app/draft/page.js'), /drop worst/);
});
