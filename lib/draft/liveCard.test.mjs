// lib/draft/liveCard.test.mjs - eight rows, six of them counting, and a header
// total that can be checked against the ticks under it.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { draftLiveRows } from './liveCard.js';

const stripComments = (t) => t.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

// Eight picks over four teams: KC final, SF live, NE not kicked off, DET bye.
const ROSTER = [
  { id: 1, round: 1, pos: 'RB', name: 'One', ffc: 'a' },
  { id: 2, round: 2, pos: 'WR', name: 'Two', ffc: 'b' },
  { id: 3, round: 3, pos: 'QB', name: 'Three', ffc: 'c' },
  { id: 4, round: 4, pos: 'TE', name: 'Four', ffc: 'd' },
  { id: 5, round: 5, pos: 'RB', name: 'Five', ffc: 'e' },
  { id: 6, round: 6, pos: 'WR', name: 'Six', ffc: 'f' },
  { id: 7, round: 7, pos: 'WR', name: 'Seven', ffc: 'g' },
  { id: 8, round: 8, pos: 'TE', name: 'Eight', ffc: 'h' },
];
const SCORED = [
  { id: 1, name: 'One', team: 'KC', points: 22.1 },
  { id: 2, name: 'Two', team: 'SF', points: 15.0 },
  { id: 3, name: 'Three', team: 'KC', points: 12.4 },
  { id: 4, name: 'Four', team: 'SF', points: 9.9 },
  { id: 5, name: 'Five', team: 'NE', points: 0 },
  { id: 6, name: 'Six', team: 'DET', points: 0 },
  { id: 7, name: 'Seven', team: 'KC', points: 2.0 },
  { id: 8, name: 'Eight', team: 'SF', points: 1.0 },
];
const GAMES = new Map([
  ['KC', { status: 'final' }],
  ['SF', { status: 'live', metadata: { live_state: { period: 2, clock: '1:40' } } }],
  ['NE', { status: 'scheduled', kickoffAt: '2026-09-15T00:15:00Z' }],
  // DET absent: a bye.
]);
const PLAYED = new Set([1, 2, 3, 4, 7, 8]);
// bestBall's six, as liveEntryRows would return them - the top six by points.
const LIVE_ROWS = [{ id: 1 }, { id: 2 }, { id: 3 }, { id: 4 }, { id: 7 }, { id: 8 }];

const view = () => draftLiveRows({ roster: ROSTER, scored: SCORED, playedIds: PLAYED, liveRows: LIVE_ROWS, gamesByTeam: GAMES });

test('all eight picks come back, in draft order', () => {
  const v = view();
  assert.equal(v.rows.length, 8);
  assert.deepEqual(v.rows.map((r) => r.round), [1, 2, 3, 4, 5, 6, 7, 8]);
});

test('THE SIX THAT COUNT ARE MARKED and the two that do not are not', () => {
  const v = view();
  assert.equal(v.counting, 6);
  assert.deepEqual(v.rows.filter((r) => r.counting).map((r) => r.id), [1, 2, 3, 4, 7, 8]);
  assert.deepEqual(v.rows.filter((r) => !r.counting).map((r) => r.id), [5, 6]);
});

test('THE HEADER TOTAL EQUALS THE SUM OF THE COUNTING ROWS', () => {
  const v = view();
  const sum = v.rows.filter((r) => r.counting).reduce((a, r) => a + (r.state.points ?? 0), 0);
  assert.equal(v.total, Math.round(sum * 10) / 10);
  assert.equal(v.total, 62.4);
  // And a dropped row contributes nothing, even when it has points.
  const withPoints = draftLiveRows({
    roster: ROSTER, scored: SCORED.map((p) => (p.id === 5 ? { ...p, points: 99 } : p)),
    playedIds: new Set([...PLAYED, 5]), liveRows: LIVE_ROWS, gamesByTeam: GAMES,
  });
  assert.equal(withPoints.total, 62.4, 'a dropped pick is dropped from the total too');
});

test('each row carries the game state its player is in', () => {
  const byId = new Map(view().rows.map((r) => [r.id, r.state]));
  assert.equal(byId.get(1).kind, 'final');
  assert.equal(byId.get(1).points, 22.1);
  assert.equal(byId.get(2).kind, 'live');
  assert.equal(byId.get(2).label, 'Q2 1:40');
  assert.equal(byId.get(5).kind, 'scheduled');
  assert.equal(byId.get(5).points, null, 'no number before kickoff');
  assert.equal(byId.get(5).kickoffAt, '2026-09-15T00:15:00Z');
  assert.equal(byId.get(6).kind, 'bye');
  assert.equal(byId.get(6).kickoffAt, null);
});

test('startedCount counts the counting rows that are under way, not all eight', () => {
  const v = view();
  assert.equal(v.startedCount, 6);
  const early = draftLiveRows({
    roster: ROSTER, scored: SCORED, playedIds: new Set(),
    liveRows: LIVE_ROWS,
    gamesByTeam: new Map([['KC', { status: 'scheduled', kickoffAt: '2026-09-15T00:15:00Z' }]]),
  });
  assert.equal(early.startedCount, 0);
  assert.equal(early.total, 0);
});

test('a pick the board has lost keeps its own name and scores nothing', () => {
  const v = draftLiveRows({
    roster: [{ id: 99, round: 1, pos: 'RB', name: 'Gone' }],
    scored: SCORED, playedIds: PLAYED, liveRows: [], gamesByTeam: GAMES,
  });
  assert.equal(v.rows[0].name, 'Gone');
  assert.equal(v.rows[0].counting, false);
  assert.equal(v.rows[0].state.kind, 'bye');
});

test('an empty roster is an empty card, not a crash', () => {
  const v = draftLiveRows({});
  assert.deepEqual(v.rows, []);
  assert.equal(v.total, 0);
  assert.equal(v.counting, 0);
});

test('THIS MODULE RE-DECIDES NOTHING - bestBall chose, and it scores nothing', () => {
  const t = stripComments(readFileSync(new URL('./liveCard.js', import.meta.url), 'utf8'));
  assert.equal(/bestBall/.test(t), false, 'the best six arrive as liveRows; choosing again would be a second implementation');
  assert.equal(/fantasyPoints|SCORING|recYds|rushTd/.test(t), false, 'and it computes no points of its own');
});

test('the Draft card renders the eight through this module, and marks the six', () => {
  const page = stripComments(readFileSync(new URL('../../app/draft/page.js', import.meta.url), 'utf8'));
  assert.match(page, /draftLiveRows\(\{ roster, scored, playedIds, liveRows: mine\.rows, gamesByTeam \}\)/);
  assert.match(page, /<DraftLiveCard card=\{card\} roster=\{roster\} seatLine=\{seatLine\} \/>/);
  const card = stripComments(readFileSync(new URL('../../components/draft/DraftLiveCard.js', import.meta.url), 'utf8'));
  // v2 CLASS NAMES, SAME TWO RULES: the two that drop are distinguished on
  // the row itself, and the six that count are MARKED rather than left to be
  // inferred from the absence of dimming.
  // THE TWO MARKS ARE BOTH GATED ON anyPlayed (startedCount > 0): bestBall
  // chooses six the moment a roster exists, so before the first kickoff it is
  // ranking eight zeros and neither a strike nor a tick is a verdict anyone
  // has reached. The rule this test protects is unchanged - the two that drop
  // are distinguished and the six that count are MARKED - only the condition
  // moved, and it moved onto the same one the hero uses.
  assert.match(card, /anyPlayed && !r\.counting \? ' drop' : ''/);
  assert.match(card, /className="dvg-count"/);
  assert.match(card, /anyPlayed && r\.counting \?/, 'the tick waits for a game too');
  assert.match(card, /const anyPlayed = started > 0;/);
});

// ---------------------------------------------------------------------------
// THE TWO TYPOS (relay item 3)
// ---------------------------------------------------------------------------
test('the count caption keeps its space around every word', () => {
  // THE CAPTION MOVED INTO THE CARD (v2) - it was the page's score-row meta,
  // and the card's header now carries the same two facts beside the pips they
  // describe. The typo rule follows it: no expression may abut a word.
  const card = readFileSync(new URL('../../components/draft/DraftLiveCard.js', import.meta.url), 'utf8');
  const lines = card.split('\n').filter((l) => l.includes('started') || l.includes('count &middot; worst two dropped'));
  assert.ok(lines.length >= 2, 'the started count and the drop-worst caption both exist');
  for (const line of lines) {
    assert.equal(/\}[A-Za-z]/.test(line), false, `no space before a word in: ${line.trim()}`);
    assert.equal(/[A-Za-z]\{/.test(line), false, `no space after a word in: ${line.trim()}`);
  }
  assert.match(card, /\{started\} of \{rows\.length\} started/);
  assert.match(card, /\{anyPlayed \? `\$\{counting\} of \$\{rows\.length\} count` : `\$\{rows\.length\} picks in`\} &middot; worst two dropped/,
    'the caption states the rule, and claims the six only once something has played');
});

test('THE RESULTS LINE WRAPS. It is a sentence in a nowrap column', () => {
  // .row .r is white-space:nowrap so a score never breaks across two lines.
  // The Results line shares that column and is prose, so it opts out - without
  // r--wrap it ran off the right edge of every phone.
  const css = readFileSync(new URL('../../app/daily/daily.css', import.meta.url), 'utf8');
  assert.match(css, /\.row \.r \{[^}]*white-space: nowrap/);
  assert.match(css, /\.row \.r--wrap \{[^}]*white-space: normal/);
  // THE DRAFT CARD NO LONGER PUTS PROSE IN THAT COLUMN (v2): its "graded
  // Tuesday" rides the header's own sub row and the drop-worst rule rides the
  // strip's note, neither of which is the nowrap score column. The Weekly's
  // page still has the line, and the rule still binds it.
  const dcard = readFileSync(new URL('../../components/draft/DraftLiveCard.js', import.meta.url), 'utf8');
  assert.equal(/drop-worst applies at settle/.test(dcard), false,
    'the Draft card states the rule in the strip, not in the score column');
  assert.match(dcard, /graded Tuesday/);
  assert.match(dcard, /the worst\s+two drop/);
  for (const f of ['../../app/weekly/page.js']) {
    const page = readFileSync(new URL(f, import.meta.url), 'utf8');
    const line = page.split('\n').find((l) => l.includes('drop-worst applies at settle'));
    assert.ok(line, `${f} still has a Results line`);
    assert.match(line, /r--wrap/, `${f}: the Results line must be allowed to wrap`);
  }
});
