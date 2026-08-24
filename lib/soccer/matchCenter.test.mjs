// lib/soccer/matchCenter.test.mjs - the EPL match center's laws.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { compareRows, fullStatRows, timelineRows, eventGrammar, eventMinute, halfTimeScore, pitchRows } from './matchCenter.js';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const src = (rel) => readFileSync(path.join(REPO, rel), 'utf8');

const HOME = { 'Ball Possession': '39%', 'Total Shots': 13, 'Shots on Goal': 4, expected_goals: '1.42', 'Corner Kicks': 2, Fouls: 16 };
const AWAY = { 'Ball Possession': '61%', 'Total Shots': 11, 'Shots on Goal': 6, expected_goals: '2.10', 'Corner Kicks': 5, Fouls: 9 };

test('the compare bar reads EXISTING provider fields and invents nothing', () => {
  const rows = compareRows(HOME, AWAY);
  assert.deepEqual(rows.map((r) => r.label), ['Possession', 'Shots', 'On target', 'xG', 'Corners']);
  const poss = rows[0];
  assert.deepEqual([poss.home, poss.away], ['39%', '61%']);
  assert.deepEqual([poss.homePct, poss.awayPct], [39, 61], 'the split bar IS the number for possession');
  // Every label must correspond to a key the provider actually ships.
  const providerKeys = new Set([...Object.keys(HOME), ...Object.keys(AWAY)]);
  for (const r of rows) assert.ok(providerKeys.has(r.key), `${r.key} is a provider field`);
});

test('A HALF-KNOWN COMPARISON IS NOT A COMPARISON - the row drops', () => {
  // xG live-vs-final is undecidable from the payload (it rides the same
  // team-stats document as possession), so the rule is presence-based:
  // missing on either side, the row is absent - and it returns by itself
  // when the provider fills it, with no code change.
  const liveHome = { ...HOME }; delete liveHome.expected_goals;
  const rows = compareRows(liveHome, AWAY);
  assert.ok(!rows.some((r) => r.label === 'xG'), 'xG absent on one side drops the row');
  assert.deepEqual(rows.map((r) => r.label), ['Possession', 'Shots', 'On target', 'Corners']);
  assert.deepEqual(compareRows(HOME, AWAY).map((r) => r.label).includes('xG'), true, 'and returns when both carry it');
});

test('full stats carry the fields the compare bar left behind', () => {
  const rows = fullStatRows(HOME, AWAY);
  assert.deepEqual(rows.map((r) => r.label), ['Fouls']);
  assert.ok(!rows.some((r) => r.label === 'Possession'), 'no duplication of the compare bar');
});

test('event grammar maps the provider vocabulary to the mock icons', () => {
  assert.deepEqual(eventGrammar({ event_type: 'Goal', detail: 'Normal Goal', assist_name: 'W. Osula' }),
    { icon: '⚽', kind: 'goal', note: 'Assist: W. Osula' });
  assert.equal(eventGrammar({ event_type: 'Goal', detail: 'Penalty' }).note, 'Penalty');
  assert.equal(eventGrammar({ event_type: 'Goal', detail: 'Own Goal' }).note, 'Own goal');
  assert.equal(eventGrammar({ event_type: 'Card', detail: 'Yellow Card' }).icon, '🟨');
  assert.equal(eventGrammar({ event_type: 'Card', detail: 'Red Card' }).note, 'Sent off');
  assert.equal(eventGrammar({ event_type: 'subst' }).icon, '🔁');
});

test("minutes carry stoppage the soccer way", () => {
  assert.equal(eventMinute({ minute: 67 }), "67'");
  assert.equal(eventMinute({ minute: 90, minute_extra: 9 }), "90+9'");
  assert.equal(eventMinute({}), null);
});

test('the timeline is NEWEST FIRST and half time is its own row', () => {
  const events = [
    { id: 1, minute: 5, event_type: 'Goal', detail: 'Normal Goal', team_side: 'home', player_name: 'Elanga' },
    { id: 2, minute: 60, event_type: 'Card', detail: 'Yellow Card', team_side: 'away', player_name: 'Van Dijk' },
    { id: 3, minute: 90, minute_extra: 9, event_type: 'Goal', detail: 'Normal Goal', team_side: 'away', player_name: 'Szoboszlai' },
  ];
  const rows = timelineRows(events, { reachedHalfTime: true, homeScoreAtHalf: 1, awayScoreAtHalf: 0, homeAbbr: 'NEW', awayAbbr: 'LIV' });
  assert.deepEqual(rows.map((r) => r.id), [3, 2, 'half', 1], 'newest first, half time in its place');
  assert.match(rows.find((r) => r.id === 'half').name, /Half time · NEW 1–0 LIV/);
  assert.equal(rows[0].kind, 'goal');
  assert.equal(rows[0].side, 'LIV');
});

test('half-time score counts only first-half goals, current rows only', () => {
  const events = [
    { minute: 5, event_type: 'Goal', team_side: 'home', is_current: true },
    { minute: 44, event_type: 'Goal', team_side: 'away', is_current: true },
    { minute: 46, event_type: 'Goal', team_side: 'home', is_current: true },
    { minute: 20, event_type: 'Goal', team_side: 'home', is_current: false },
  ];
  assert.deepEqual(halfTimeScore(events), { home: 1, away: 1 });
});

test('the pitch reads the STORED lineup shape and keeps the bench', () => {
  const players = [
    { name: 'Alisson', number: 1, role: 'starting' },
    ...Array.from({ length: 4 }, (_, i) => ({ name: `D${i}`, number: 2 + i, role: 'starting' })),
    ...Array.from({ length: 2 }, (_, i) => ({ name: `M${i}`, number: 6 + i, role: 'starting' })),
    ...Array.from({ length: 3 }, (_, i) => ({ name: `A${i}`, number: 8 + i, role: 'starting' })),
    { name: 'S1', number: 11, role: 'starting' },
    { name: 'Bench1', number: 12, role: 'substitute' },
  ];
  const p = pitchRows('4-2-3-1', players);
  assert.equal(p.bench.length, 1, 'substitutes are the bench');
  assert.equal(p.rows.flat().length, 11, 'every starter placed');
  assert.deepEqual(p.rows[p.rows.length - 1].map((x) => x.name), ['Alisson'], 'keeper last = bottom of the pitch');
  assert.equal(p.rows[0].length, 1, 'the front line leads');
});

test('the minute chip is a SNAPSHOT - no client ticking on this surface', () => {
  const page = src('app/epl/match/[slug]/page.js');
  assert.match(page, /soccerLiveChip\(m\.live_state\)/, 'the one formatter');
  const comp = src('components/soccer/MatchCenter.js');
  assert.ok(!/setInterval|Date\.now\(\)/.test(comp), 'the component never runs a clock');
});

test("FULL TIME replaces LIVE and its chip - they can never co-render", () => {
  const comp = src('components/soccer/MatchCenter.js');
  const head = comp.slice(comp.indexOf('className="mc-gstat"'), comp.indexOf('mc-vs'));
  assert.match(head, /header\.live \? \([\s\S]*\) : header\.final \? \(/, 'live and final are branches of one ternary');
  assert.match(head, /Full time/);
});

test('NO MODEL COPY REACHES THIS SURFACE - by construction, pinned', () => {
  for (const rel of ['app/epl/match/[slug]/page.js', 'components/soccer/MatchCenter.js']) {
    const t = src(rel);
    // Strip the block comments first - they discuss the gating rule by name.
    const code = t.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
    for (const f of ['articles', 'gloss', 'watch_score', 'analyst']) {
      assert.ok(!new RegExp(f, 'i').test(code), `${rel} must not read ${f}`);
    }
  }
});

test('EPL slugs redirect off the World Cup page to the league centre', () => {
  assert.match(src('app/match/[slug]/page.js'), /league_slug === 'epl'\) permanentRedirect\(`\/epl\/match\/\$\{slug\}`\)/);
  assert.match(src('components/gridiron/Scoreboard.js'), /href=\{`\/epl\/match\/\$\{g\.slug\}`\}/);
});
