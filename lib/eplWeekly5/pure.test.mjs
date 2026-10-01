// EPL Weekly 5's other pure pieces: the feed's availability flags (recorded
// MW5 /injuries), the perfect five under the club cap, the fixture chips,
// the in-play lines, the window label and the /games row.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { rowsByFixture } from './availability.js';
import { flagWord, cleanName, teamConceded, scorePick } from './data.js';
import { perfectFive } from './board.js';
import { fixtureChip } from './entry.js';
import { windowLabel } from './labels.js';
import { eplWeekly5Row } from './lobbyRow.js';
import { settleGate } from './settle.js';
import { linesFromFixture } from '../soccer/liveLines.js';

const INJ = JSON.parse(readFileSync(new URL('./testdata/mw5-injuries.json', import.meta.url), 'utf8'));
const MW5 = JSON.parse(readFileSync(new URL('./testdata/mw5-feed.json', import.meta.url), 'utf8'));

test('availability: the recorded MW5 /injuries response, grouped per fixture, duplicates folded', () => {
  const by = rowsByFixture(INJ);
  assert.deepEqual([...by.keys()].sort(), ['1557409', '1557410']);
  const all = [...by.values()].flatMap((m) => [...m.values()]);
  assert.equal(all.length, new Set(INJ.map((r) => `${r.fixture.id}:${r.player.id}`)).size);
  const azeez = all.find((r) => r.player_name === 'F. Azeez');
  assert.equal(azeez.kind, 'Missing Fixture');
  assert.equal(azeez.reason, 'Abdominal strain');
});

test('the flag word: injured, suspended, doubtful', () => {
  assert.deepEqual(flagWord({ kind: 'Missing Fixture', reason: 'Knee Injury' }), { kind: 'injured', label: 'INJ', reason: 'Knee Injury' });
  assert.equal(flagWord({ kind: 'Missing Fixture', reason: 'Suspended' }).label, 'SUSP');
  assert.equal(flagWord({ kind: 'Missing Fixture', reason: 'Red Card' }).kind, 'suspended');
  assert.equal(flagWord({ kind: 'Questionable', reason: 'Illness' }).label, 'DOUBT');
});

test('names lose the provider\'s HTML entities', () => {
  assert.equal(cleanName('N. O&apos;Reilly'), 'N. O’Reilly');
});

test('the perfect five obeys the slots and the two-per-club cap', () => {
  const c = (id, pos, club, points) => ({ playerId: id, pos, clubId: club, club: `C${club}`, name: id, points });
  const p = perfectFive([
    c('gk1', 'GK', 1, 9), c('m1', 'MID', 1, 12), c('f1', 'FWD', 1, 14), c('f2', 'FWD', 2, 8),
    c('m2', 'MID', 3, 6), c('d1', 'DEF', 4, 7), c('m3', 'MID', 1, 11),
  ]);
  // club 1 has gk 9, m1 12, f1 14, m3 11 - only two may stand
  const clubs = p.players.reduce((a, x) => ({ ...a, [x.club]: (a[x.club] ?? 0) + 1 }), {});
  assert.ok(Object.values(clubs).every((n) => n <= 2));
  assert.deepEqual(p.players.map((x) => x.slot), ['DEF/GK', 'MID', 'FWD', 'FLEX', 'FLEX']);
  assert.equal(p.score, 7 + 12 + 14 + 8 + 6);
  assert.equal(perfectFive([]), null);
});

test('fixture chips: FT with the score, the live minute, HT, PPD', () => {
  assert.equal(fixtureChip({ status: 'final', home_score: 2, away_score: 0 }).text, 'FT 2–0');
  assert.equal(fixtureChip({ status: 'live', live_state: { elapsed: 62, period: '2H' } }).text, "62'");
  assert.equal(fixtureChip({ status: 'live', live_state: { elapsed: 45, extra: 2, period: '1H' } }).text, "45+2'");
  assert.equal(fixtureChip({ status: 'live', live_state: { elapsed: 45, period: 'HT' } }).text, 'HT');
  assert.equal(fixtureChip({ status: 'postponed' }).text, 'PPD');
  assert.equal(fixtureChip({ status: 'scheduled' }), null);
});

test('a pick: pending, live (no clean sheet yet), final, off; DNP in a final scores 0', () => {
  const pick = { playerId: '1', matchId: 9, clubId: 5, pos: 'DEF' };
  const row = { minutes_played: 70, goals: 0, assists: 0, yellow_cards: 0, red_cards: 0, conceded_on_pitch: 0 };
  const m = (status) => ({ status, home_team_id: 5, away_team_id: 6, home_score: 1, away_score: 0 });
  assert.equal(scorePick(pick, m('scheduled'), null).state, 'pending');
  assert.equal(scorePick(pick, m('live'), { row, source: 'live' }).points, 2);
  assert.equal(scorePick(pick, m('final'), { row, source: 'stats' }).points, 6);
  assert.equal(scorePick(pick, m('final'), null).points, 0);
  assert.equal(scorePick(pick, m('postponed'), null).state, 'off');
  assert.equal(teamConceded(m('final'), 5), 0);
  assert.equal(teamConceded(m('final'), 6), 1);
});

test('in-play lines from the tick\'s own payload, keyed by provider id, in the stats vocabulary', () => {
  const f = MW5.find((x) => x.fixture === 1557416); // Spurs 2-3 Villa
  const lines = linesFromFixture(f);
  const manzambi = f.players.flatMap((t) => t.players).find((p) => p.player.name === 'Johan Manzambi');
  const l = lines[String(manzambi.player.id)];
  assert.equal(l.goals, 1);
  assert.equal(l.came_off_at_minute, 72);
  assert.equal(l.conceded_on_pitch, 0);
});

test('the window label: one zone, both ends', () => {
  assert.equal(windowLabel('2026-10-10T11:30:00Z', '2026-10-12T19:00:00Z', { tz: 'Europe/London' }), 'Sat 10 – Mon 12 Oct');
  assert.equal(windowLabel('2026-10-31T12:30:00Z', '2026-11-02T20:00:00Z', { tz: 'Europe/London' }), 'Sat 31 Oct – Mon 2 Nov');
  assert.equal(windowLabel('2026-12-02T20:00:00Z', '2026-12-02T20:00:00Z', { tz: 'Europe/London' }), 'Wed 2 Dec');
});

test('the /games row says GW, and its state', () => {
  const now = new Date('2026-10-08T12:00:00Z');
  assert.equal(eplWeekly5Row(null).tone, 'muted');
  const open = eplWeekly5Row({ week: 6 }, { filled: 2, nextKickoff: '2026-10-10T11:30:00Z', kicked: false }, now);
  assert.equal(open.line, 'GW 6 · 2 of 5 picked');
  assert.equal(open.rightLabel, 'Sat 4:30 AM PT', 'the first lock, in the house zone');
  assert.equal(open.name, 'EPL Weekly 5');
  assert.equal(open.href, '/epl-weekly-5');
  const live = eplWeekly5Row({ week: 6 }, { filled: 5, nextKickoff: '2026-10-11T15:30:00Z', kicked: true }, new Date('2026-10-10T12:00:00Z'));
  assert.match(live.line, /^GW 6 · in play/);
  const fin = eplWeekly5Row({ week: 6, settled: true }, { filled: 5, score: 43 });
  assert.equal(fin.right, '43');
  assert.equal(fin.tone, 'done');
});

test('the settle gate: off fixtures do not hold it; a missing re-check holds it until the grace', () => {
  const board = [{ match_id: 1, slug: 'a', kickoff_at: '2026-10-10T11:30:00Z' }, { match_id: 2, slug: 'b', kickoff_at: '2026-10-11T11:30:00Z' }];
  const fx = new Map([['1', { status: 'final', kickoff_at: '2026-10-10T11:30:00Z', resync_at: 'x' }], ['2', { status: 'postponed', kickoff_at: '2026-10-11T11:30:00Z' }]]);
  assert.equal(settleGate(board, fx, new Date('2026-10-12T00:00:00Z')).ready, true);
  fx.get('1').resync_at = null;
  assert.equal(settleGate(board, fx, new Date('2026-10-12T00:00:00Z')).ready, false);
  assert.equal(settleGate(board, fx, new Date('2026-10-15T00:00:00Z')).ready, true, '72h after the last kickoff');
});
