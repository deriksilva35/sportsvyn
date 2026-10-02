// lib/survivor/view.test.mjs - the room's model and the lobby row, pure; plus
// the room's grammar as source facts (the Weekly's one-scroll classes, the
// server action as the only write, no decision in the browser).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { roomModel, spreadLabel } from './view.js';
import { survivorRowV3 } from './lobbyRow.js';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const read = (f) => readFileSync(path.join(REPO, f), 'utf8');

const NOW = new Date('2026-10-11T18:00:00Z');   // Sunday 2 PM ET of a week 5
const row = (team_id, abbr, kickoff_at, spread, status = 'scheduled') => ({ team_id, abbr, name: abbr, opp_abbr: 'X', home: true, match_id: team_id, kickoff_at, status, spread });
const ROWS = [
  row(1, 'BUF', '2026-10-11T20:25:00Z', -7),
  row(2, 'KC', '2026-10-11T17:00:00Z', -3),       // kicked an hour ago
  row(3, 'DET', '2026-10-11T20:25:00Z', -2.5),
  row(4, 'SF', '2027-01-10T05:00:00Z', -1),       // placeholder time
];
const pick = (week, team_id, abbr, result, kickoff_at = '2026-10-04T17:00:00Z') => ({ week, team_id, abbr, result, kickoff_at, status: result === 'pending' ? 'scheduled' : 'final' });

test('each team row says mine / used (with its week) / locked / tbd / open', () => {
  const m = roomModel({
    rows: ROWS, week: 5, startWeek: 4, now: NOW, entry: { lives_left: 1, eliminated_week: null },
    picks: [pick(4, 3, 'DET', 'win'), pick(5, 1, 'BUF', 'pending', '2026-10-11T20:25:00Z')],
  });
  assert.deepEqual(m.list.map((r) => [r.abbr, r.state, r.usedWeek, r.disabled]), [
    ['BUF', 'mine', null, true], ['KC', 'locked', null, true], ['DET', 'used', 4, true], ['SF', 'tbd', null, true],
  ]);
  assert.equal(m.path.length, 18);
  assert.deepEqual(m.path.slice(2, 6).map((c) => [c.week, c.state, c.label, c.mark]),
    [[3, 'before', '—', ''], [4, 'won', 'DET', '✓'], [5, 'current', 'BUF', ''], [6, 'future', null, '']]);
  assert.deepEqual(m.bar, { kind: 'picked', abbr: 'BUF', kickoff_at: '2026-10-11T20:25:00Z', auto: false });
});

test('an empty room: every open team tappable, the bar asks for a pick', () => {
  const m = roomModel({ rows: ROWS, week: 5, startWeek: 5, now: NOW, entry: null, picks: [] });
  assert.deepEqual(m.list.filter((r) => !r.disabled).map((r) => r.abbr), ['BUF', 'DET']);
  assert.equal(m.bar.kind, 'none');
  assert.deepEqual(m.path.map((c) => c.state).slice(3, 6), ['before', 'current', 'future']);
  assert.equal(m.path[4].label, 'pick');
});

test('a kicked pick locks the whole list; out and closed say so', () => {
  const locked = roomModel({ rows: ROWS, week: 5, startWeek: 5, now: NOW, entry: { lives_left: 1 },
    picks: [pick(5, 2, 'KC', 'pending', '2026-10-11T17:00:00Z')] });
  assert.equal(locked.bar.kind, 'locked');
  assert.ok(locked.list.every((r) => r.disabled));
  const out = roomModel({ rows: ROWS, week: 6, startWeek: 5, now: NOW, entry: { lives_left: 0, eliminated_week: 5 },
    picks: [pick(5, 2, 'KC', 'loss')] });
  assert.deepEqual(out.bar, { kind: 'out', week: 5 });
  assert.ok(out.list.every((r) => r.disabled));
  assert.deepEqual([out.path[4].state, out.path[4].mark], ['lost', '✗']);
  const closed = roomModel({ rows: ROWS, week: 7, startWeek: 7, now: NOW, entry: null, entriesOpen: false, cutoffWeek: 6 });
  assert.deepEqual(closed.bar, { kind: 'closed', week: 6 });
  assert.ok(closed.list.every((r) => r.disabled));
});

test('spread labels: signed, PK, nothing without a line', () => {
  assert.deepEqual([spreadLabel(-7), spreadLabel(3.5), spreadLabel(0), spreadLabel(null)], ['-7', '+3.5', 'PK', null]);
});

test('the lobby row: no pick, a pick with its PT lock, locked in, out, closed, not open', () => {
  const now = new Date('2026-10-08T12:00:00Z');
  assert.equal(survivorRowV3({ week: 5, now }).line, 'One team a week · no pick yet');
  const p = survivorRowV3({ week: 5, entry: {}, pick: { team_id: 1, abbr: 'BUF', kickoff_at: '2026-10-11T17:00:00Z' }, now });
  assert.equal(p.line, 'BUF · locks Sun 10:00 AM PT');
  assert.equal(p.right, 'BUF');
  const k = survivorRowV3({ week: 5, entry: {}, pick: { team_id: 1, abbr: 'BUF', kickoff_at: '2026-10-08T00:15:00Z' }, now });
  assert.deepEqual([k.line, k.tone], ['BUF locked in', 'live']);
  assert.equal(survivorRowV3({ week: 6, entry: { eliminated_week: 5 }, now }).right, 'OUT');
  assert.equal(survivorRowV3({ week: 7, entriesOpen: false, cutoffWeek: 6, now }).line, 'Entries closed at week 6 kickoff');
  assert.equal(survivorRowV3({ week: null }).tone, 'muted');
  assert.equal(survivorRowV3({ week: 5 }).href, '/survivor');
});

test('the room is the Weekly\'s one-scroll grammar and decides nothing', () => {
  const room = read('components/survivor/SurvivorRoom.js');
  for (const cls of ['wkv-top', 'wkv-prog', 'wkv-how', 'wkv-dock', 'wkv-pan-h', 'wkv-list', 'wkv-prow', 'wkv-bar']) {
    assert.match(room, new RegExp(`className=[{"\`][^>]*${cls}`), cls);
  }
  assert.match(room, /pickSurvivorTeam\(/, 'the server action is the only write');
  assert.doesNotMatch(room, /gameOpen|chooseAuto|livesFrom/, 'no rule runs in the browser');
  const page = read('app/survivor/page.js');
  assert.match(page, /requireSignInInShell\(/);
  assert.match(page, /roomModel\(/, 'the model is built on the server');
  assert.match(read('lib/games/playRegistry.js'), /survivorRowFor\(/, 'the /games entry point (the Play registry, thu-38)');
  // The dock is the path: its height is restated for the sticky stack.
  assert.match(read('app/survivor/survivor.css'), /\.wkv\.svv \{ --wkv-dock-h: 82px; \}/);
});
