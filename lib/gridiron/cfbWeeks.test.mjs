// lib/gridiron/cfbWeeks.test.mjs - the windowed tick asks for weeks, not the season.
// Pure: planCfbFetch over hand-built rows; no database, no network.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { planCfbFetch, cfbGamesPaths, RECENT_FINAL_HOURS } from './cfbWeeks.js';

const H = 3600_000;
const now = new Date('2026-10-04T05:00:00Z');   // early Sunday UTC, Saturday night ET
const at = (h) => new Date(now.getTime() + h * H).toISOString();
const row = (week, h, status, src = 'window', season_phase = 'REG') => ({ season_phase, week, kickoff_at: at(h), status, src });

test('a Saturday night asks for the current week, plus the next week\'s number', () => {
  const p = planCfbFetch([
    row(5, -10, 'final'), row(5, -3, 'live'), row(5, -1, 'live'),
    row(6, 60, 'scheduled', 'next'),
  ], { now, regLeft: 400 });
  assert.deepEqual(p.regularWeeks, [5, 6]);
  assert.equal(p.postseason, false);
  assert.deepEqual(cfbGamesPaths(p, 2026), {
    regular: ['/games?year=2026&seasonType=regular&week=5', '/games?year=2026&seasonType=regular&week=6'],
    post: [],
  });
});

test('a straggler from last week still live past midnight keeps its week', () => {
  const p = planCfbFetch([
    row(4, -30, 'live'),              // week 4, kicked off 30 h ago, never settled
    row(5, -20, 'final'),             // old final: not by itself a reason
    row(5, 20, 'scheduled'),          // upcoming
  ], { now, regLeft: 300 });
  assert.deepEqual(p.regularWeeks, [4, 5]);
});

test('a week whose games all settled more than RECENT_FINAL_HOURS ago drops out', () => {
  const p = planCfbFetch([
    row(5, -(RECENT_FINAL_HOURS + 2), 'final'), row(5, -(RECENT_FINAL_HOURS + 1), 'final'),
    row(6, 50, 'scheduled', 'next'),
  ], { now, regLeft: 300 });
  assert.deepEqual(p.regularWeeks, [6], 'only the upcoming week');
  const fresh = planCfbFetch([row(5, -4, 'final'), row(6, 50, 'scheduled', 'next')], { now, regLeft: 300 });
  assert.deepEqual(fresh.regularWeeks, [5, 6], 'a just-settled game keeps its week: CFBD\'s points can trail ours');
});

test('a game rescheduled under its old week number is asked for by THAT number', () => {
  // DEV, 3 Oct: week 4 holds a game kicking off inside week 5's dates. The
  // window is computed from kickoffs; the page is named by matches.week.
  const p = planCfbFetch([row(4, 6, 'scheduled'), row(5, 8, 'scheduled')], { now, regLeft: 200 });
  assert.deepEqual(p.regularWeeks, [4, 5]);
});

test('the postseason page only when the season is in it', () => {
  assert.equal(planCfbFetch([row(13, 5, 'scheduled')], { now, regLeft: 60 }).postseason, false);
  assert.equal(planCfbFetch([row(1, 30, 'scheduled', 'next', 'POST')], { now, regLeft: 0 }).postseason, true);
  const bowls = planCfbFetch([row(1, 2, 'live', 'window', 'POST')], { now, regLeft: 0 });
  assert.equal(bowls.postseason, true);
  assert.deepEqual(bowls.regularWeeks, [], 'no regular page in bowl season');
  assert.equal(planCfbFetch([row(15, -40, 'final', 'window')], { now, regLeft: 0 }).postseason, true,
    'no REG game left ahead: ask for the postseason even before bowls reach our table');
});

test('a season the table knows nothing about is fetched whole, as before', () => {
  const p = planCfbFetch([], { now, totalRows: 0 });
  assert.equal(p.regularWeeks, null);
  assert.equal(p.postseason, true);
  assert.deepEqual(cfbGamesPaths(p, 2026), {
    regular: ['/games?year=2026&seasonType=regular'], post: ['/games?year=2026&seasonType=postseason'],
  });
});

test('syncCfbGames plans only when windowed; the daily full-season run is unchanged', () => {
  const S = readFileSync(new URL('./sync.js', import.meta.url), 'utf8');
  const fn = S.slice(S.indexOf('export async function syncCfbGames'));
  assert.match(fn, /let plan = \{ regularWeeks: null, postseason: true, reason: 'full season' \};\s*if \(window\) \{/);
  assert.match(fn, /cfbGamesPaths\(plan, seasonYear\)/);
  assert.doesNotMatch(fn, /for \(const st of \['regular', 'postseason'\]\)/, 'no unconditional two-page loop');
});
