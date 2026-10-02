// EPL Weekly 5's scorer, pure, then on a REAL finished matchweek (MW5,
// 18-20 Sep 2026) recorded from API-Sports into testdata/mw5-feed.json - so
// it runs offline. The path under test is the production one: feed ->
// mapStatLine + playerMatchFacts (the importer's two maps) -> lineFromRow ->
// scoreLine.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { scoreLine, lineFromRow, posOf, pointsPerGame } from './scoring.js';
import { playerMatchFacts } from '../soccer/playerMatchFacts.js';
import { mapStatLine, factColumns } from '../soccer/playerStatsImport.js';

const base = { position: 'MID', minutes: 90, goals: 0, assists: 0, saves: 0, yellow: 0, red: 0, ownGoals: 0, penSaved: 0, penMissed: 0, concededOnPitch: 1 };
const pts = (o) => scoreLine({ ...base, ...o }).points;

test('appearance: 60+ is 2, under 60 is 1, an unused sub is 0', () => {
  assert.equal(pts({ minutes: 60 }), 2);
  assert.equal(pts({ minutes: 59 }), 1);
  assert.equal(pts({ minutes: 1 }), 1);
  assert.equal(pts({ minutes: 0 }), 0);
});

test('goals by position: DEF/GK 6, MID 5, FWD 4; assist 3', () => {
  assert.equal(pts({ position: 'DEF', goals: 1 }), 8);
  assert.equal(pts({ position: 'GK', goals: 1 }), 8);
  assert.equal(pts({ position: 'MID', goals: 1 }), 7);
  assert.equal(pts({ position: 'ATT', goals: 1 }), 6);
  assert.equal(pts({ assists: 2 }), 8);
});

test('clean sheet: DEF/GK 4, MID 1, FWD 0 - only 60+ and only conceding none while on', () => {
  assert.equal(pts({ position: 'DEF', concededOnPitch: 0 }), 6);
  assert.equal(pts({ position: 'GK', concededOnPitch: 0 }), 6);
  assert.equal(pts({ position: 'MID', concededOnPitch: 0 }), 3);
  assert.equal(pts({ position: 'FWD', concededOnPitch: 0 }), 2);
  assert.equal(pts({ position: 'DEF', concededOnPitch: 0, minutes: 59 }), 1, 'under 60: no clean sheet');
  assert.equal(pts({ position: 'DEF', concededOnPitch: null }), 2, 'never derived: no clean sheet');
  assert.equal(scoreLine({ ...base, position: 'DEF', concededOnPitch: 0 }, { final: false }).points, 2, 'withheld until full time');
});

test('keeper: 1 per 3 saves (floor), penalty save 5', () => {
  assert.equal(pts({ position: 'GK', saves: 2 }), 2);
  assert.equal(pts({ position: 'GK', saves: 3 }), 3);
  assert.equal(pts({ position: 'GK', saves: 8 }), 4);
  assert.equal(pts({ position: 'DEF', saves: 6 }), 2, 'saves score for keepers only');
  assert.equal(pts({ position: 'GK', penSaved: 1 }), 7);
});

test('negatives: yellow -1, red -3 (a second yellow is the red only), own goal -2, pen miss -2', () => {
  assert.equal(pts({ yellow: 1 }), 1);
  assert.equal(pts({ red: 1 }), -1);
  assert.equal(pts({ yellow: 1, red: 1 }), -1);
  assert.equal(pts({ ownGoals: 1 }), 0);
  assert.equal(pts({ penMissed: 1 }), 0);
});

test('A SECOND YELLOW IS -3, THE RED ONLY (ruled thu-42): one Red chip, no Yellow chip', () => {
  const s = scoreLine({ ...base, yellow: 1, red: 1 });
  assert.deepEqual(s.parts.map((p) => p.text), ['60+ min 2', 'Red −3']);
  assert.equal(s.points, -1);
});

test('the provisional clean sheet (thu-42): a dimmed "CS +4?" chip while live, never in the live total', () => {
  const live = (o) => scoreLine({ ...base, concededOnPitch: 0, ...o }, { final: false });
  const def = live({ position: 'DEF', minutes: 70 });
  const chip = def.parts.find((p) => p.key === 'cs');
  assert.equal(chip.text, 'CS +4?');
  assert.equal(chip.provisional, true);
  assert.equal(def.points, 2, 'the live total excludes it');
  assert.equal(live({ position: 'GK', minutes: 30 }).parts.find((p) => p.key === 'cs')?.text, 'CS +4?', 'on course: on the pitch, nothing conceded');
  assert.equal(live({ position: 'MID', minutes: 75 }).parts.find((p) => p.key === 'cs')?.text, 'CS +1?');
  assert.equal(live({ position: 'DEF', minutes: 50, cameOff: 50 }).parts.find((p) => p.key === 'cs'), undefined, 'off before 60: not holding one');
  assert.ok(live({ position: 'DEF', minutes: 65, cameOff: 65 }).parts.find((p) => p.key === 'cs'), 'off after 60 with none conceded: still holding');
  assert.equal(live({ position: 'DEF', minutes: 70, concededOnPitch: 1 }).parts.find((p) => p.key === 'cs'), undefined);
  assert.equal(live({ position: 'FWD', minutes: 70 }).parts.find((p) => p.key === 'cs'), undefined);
  // at full time it becomes the real chip and counts
  const ft = scoreLine({ ...base, position: 'DEF', concededOnPitch: 0 }, { final: true });
  assert.ok(ft.parts.some((p) => p.text === 'Clean sheet 4' && !p.provisional));
  assert.equal(ft.points, 6);
});

test('chips: one per component, as the card draws them', () => {
  const s = scoreLine({ ...base, position: 'FWD', goals: 2, yellow: 1 });
  assert.deepEqual(s.parts.map((p) => p.text), ['60+ min 2', 'Goal 4', 'Goal 4', 'Yellow −1']);
  assert.equal(s.points, 9);
});

test('posOf maps the feed and table vocabularies', () => {
  assert.equal(posOf('ATT'), 'FWD');
  assert.equal(posOf('G'), 'GK');
  assert.equal(posOf('Defender'), 'DEF');
  assert.equal(posOf(null), null);
});

test('pointsPerGame divides by matches played, not matches listed', () => {
  const r = pointsPerGame([{ ...base, goals: 1 }, { ...base, minutes: 0 }, { ...base }]);
  assert.equal(r.games, 2);
  assert.equal(r.ppg, 4.5);
});

// ---------------------------------------------------------------------------
// MW5, recorded
// ---------------------------------------------------------------------------
const MW5 = JSON.parse(readFileSync(new URL('./testdata/mw5-feed.json', import.meta.url), 'utf8'));

function scoreMw5() {
  const by = new Map();
  for (const f of MW5) {
    const facts = playerMatchFacts(f);
    for (const t of f.players) {
      for (const p of t.players) {
        const st = p.statistics[0];
        const row = { ...mapStatLine(st), ...factColumns(facts, p.player.id) };
        const line = lineFromRow(row, { position: p.dbPosition ?? st.games.position });
        by.set(p.player.name, { row, ...scoreLine(line) });
      }
    }
  }
  return by;
}

test('MW5: every fixture carries events, so every on-pitch window is derived', () => {
  assert.equal(MW5.length, 10);
  for (const f of MW5) assert.ok(playerMatchFacts(f), `fixture ${f.fixture} has facts`);
});

test('MW5 substitution: B. Johnson off at 66 (66 min played), T. Dibling on at 66 (24 min)', () => {
  const f = MW5.find((x) => x.fixture === 1557410);
  const facts = playerMatchFacts(f);
  // the event names the pair ("B. Johnson" / "T. Dibling"); the ids are the feed's
  const ev = f.events.find((e) => e.type === 'subst' && e.player.name === 'B. Johnson');
  const id = (name) => (name === 'B. Johnson' ? ev.player.id : ev.assist.id);
  assert.equal(ev.assist.name, 'T. Dibling');
  assert.equal(facts.get(String(id('B. Johnson'))).cameOff, 66);
  assert.equal(facts.get(String(id('B. Johnson'))).cameOn, 0);
  assert.equal(facts.get(String(id('T. Dibling'))).cameOn, 66);
  assert.equal(facts.get(String(id('T. Dibling'))).cameOff, null);
});

test('MW5 clean sheet is per player on the pitch: Manzambi (AVL) off at 72, Spurs scored at 86 and 90', () => {
  const s = scoreMw5().get('Johan Manzambi');
  assert.equal(s.row.came_off_at_minute, 72);
  assert.equal(s.row.conceded_on_pitch, 0);
  assert.deepEqual(s.parts.map((p) => p.text), ['60+ min 2', 'Goal 5', 'Assist 3', 'Clean sheet 1']);
  assert.equal(s.points, 11);
  // and a team-mate who stayed on conceded both
  const buendia = scoreMw5().get('Emiliano Buendía');
  assert.equal(buendia.row.conceded_on_pitch, 2);
});

test('MW5 real lines score as ruled', () => {
  const s = scoreMw5();
  const expect = {
    'Brian Brobbey': [14, ['60+ min 2', 'Goal 4', 'Goal 4', 'Goal 4']],
    'Jay DaSilva': [12, ['60+ min 2', 'Goal 6', 'Clean sheet 4']],
    'Konstantinos Tzolakis': [7, ['60+ min 2', '3 saves 1', 'Pen save 5', 'Yellow −1']],
    'Yoane Wissa': [0, ['60+ min 2', 'Pen miss −2']],
    'Lisandro Martínez': [0, ['60+ min 2', 'Own goal −2']],
    'Jordan Pickford': [7, ['60+ min 2', 'Clean sheet 4', '4 saves 1']],
    'Abdul Fatawu Issahaku': [-1, ['60+ min 2', 'Red −3']],
  };
  for (const [name, [points, chips]] of Object.entries(expect)) {
    const got = s.get(name);
    assert.ok(got, `${name} is in the MW5 slice`);
    assert.equal(got.points, points, name);
    assert.deepEqual(got.parts.map((p) => p.text), chips, name);
  }
});
