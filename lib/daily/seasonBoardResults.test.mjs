// lib/daily/seasonBoardResults.test.mjs - the Daily has a yesterday. Pure.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { dayBefore, bestRosterLines, yesterdayLine, youCellV2, historyRow, latestAnswer } from './seasonBoardResults.js';
import { regradeStoredRun } from './seasonBoardRuns.js';
import { SLOTS, dailyResultsPath } from './boardShape.js';
import { copyFor } from '../push/copy.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FX = JSON.parse(readFileSync(path.join(__dirname, 'fixtures', 'board-2026-09-08.json'), 'utf8'));
const board = { id: 2, edition_date: '2026-09-08', season_year: 2015, ceiling: FX.ceiling, board: FX.board, best_roster: FX.best_roster };

test('dayBefore is calendar arithmetic, DST-proof', () => {
  assert.equal(dayBefore('2026-09-09'), '2026-09-08');
  assert.equal(dayBefore('2026-03-01'), '2026-02-28');
  assert.equal(dayBefore('2026-01-01'), '2025-12-31');
});

test('one constant builds the results href', () => {
  assert.equal(dailyResultsPath('2026-09-08'), '/daily/board/2026-09-08');
});

test('THE MIDNIGHT PUSH lands on YESTERDAY\'S RESULTS, never today\'s board', () => {
  assert.equal(copyFor('daily-revealed:2026-09-08').url, '/daily/board/2026-09-08');
  assert.equal(copyFor('daily-live:2026-09-09').url, '/daily/board', 'the morning push still opens the board');
  assert.equal(copyFor('daily-revealed').url, '/daily/board', 'a bare prefix falls back rather than building /daily/board/');
  assert.equal(copyFor('daily-revealed:2026-09-08').urlFor, undefined, 'urlFor never leaks into the payload');
});

test('the best roster reads the same whether stored raw (board 2) or flat', () => {
  const lines = bestRosterLines(board);
  assert.equal(lines.length, 8);
  assert.deepEqual(lines[0], { slot: 'QB', abbr: 'CAR', name: 'Cam Newton', points: 397.1, meta: '3837 yds · 35 TD' });
  const flat = { ...board, best_roster: lines.map((l) => ({ slot: l.slot, teamKey: l.abbr, abbr: l.abbr, name: l.name, points: l.points, meta: l.meta, position: 'QB' })) };
  assert.deepEqual(bestRosterLines(flat)[0].name, 'Cam Newton');
});

test("Derik's yesterday line: 'Yesterday · 1,840.2 · 90% · 4 of 8', from a REGRADE, not the stored matched=0", () => {
  const { grade } = regradeStoredRun(board, FX.picks, SLOTS);
  const line = yesterdayLine({ date: '2026-09-08', grade, score: '1840.2' });
  assert.deepEqual(line, { text: 'Yesterday · 1,840.2 · 90% · 4 of 8', href: '/daily/board/2026-09-08' });
});

test('no run, or a DNF, is NO yesterday line', () => {
  assert.equal(yesterdayLine({ date: '2026-09-08', grade: null }), null);
  assert.equal(yesterdayLine({ date: null, grade: {} }), null);
});

test("Derik's Sep 9 row is a DNF and stays a DNF - the you cell says so", () => {
  const dnfRun = { picks: null, score: null, pct: null, started_at: '2026-09-09T04:36:59Z' };
  assert.deepEqual(youCellV2(dnfRun, null), { played: false, dnf: true });
  assert.deepEqual(youCellV2(null, null), { played: false });
  const { grade } = regradeStoredRun(board, FX.picks, SLOTS);
  assert.deepEqual(youCellV2({ picks: FX.picks, score: '1840.2', pct: '0.9023' }, grade), { played: true, score: 1840.2, pct: 90, matched: 4, slotCount: 8 });
});

test('history: today is sealed with no season or score; a closed day carries the season, ceiling, top and you', () => {
  const sealed = historyRow({ board: { edition_date: '2026-09-09', season_year: 2021, ceiling: 2270.6 }, closed: false });
  assert.deepEqual(sealed, { date: '2026-09-09', edition: '025', label: 'Ed. 025', sealed: true });
  const row = historyRow({ board, closed: true, top: { handle: 'sportsvyn_og', score: '1840.2' }, you: { played: false, dnf: true } });
  assert.equal(row.sealed, false); assert.equal(row.season, 2015); assert.equal(row.perfect, 2039.4);
  assert.equal(row.href, '/daily/board/2026-09-08'); assert.deepEqual(row.top, { name: 'sportsvyn_og', score: 1840.2 });
  assert.deepEqual(row.you, { played: false, dnf: true });
  assert.equal('you' in historyRow({ board, closed: true }), false, 'signed out: no you column at all');
});

test('latest answer is the newest CLOSED edition: best roster, ceiling, top, href', () => {
  const y = latestAnswer({ board, top: { handle: 'sportsvyn_og', score: '1840.2' } });
  assert.equal(y.date, '2026-09-08'); assert.equal(y.edition, '024'); assert.equal(y.perfect, 2039.4);
  assert.equal(y.bestRoster.length, 8); assert.equal(y.href, '/daily/board/2026-09-08');
  assert.equal(latestAnswer({ board: null }), null);
});
