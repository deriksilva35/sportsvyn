// lib/mlb/lineups.test.mjs - the posted batting order, from the feed to the
// card. Pure functions, no DB, no network. Run: node --test lib/mlb/lineups.test.mjs
//
// THE FOUR MOMENTS THIS RELAY EXISTS FOR, each its own test below:
//   pre-post   - the card is not up and nobody is told a lineup exists
//   post       - the nine, in order, and the bats cut down to them
//   fell out   - a pick that was in the lineup this morning and is not now
//   late post  - the card goes up AFTER the lock, when nothing can be swapped

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { lineupsFrom } from './statsapi.js';
import { startersOnly, notStarting, orderIndex, batWithOrder } from '../october/pool.js';
import { clubStarters } from '../run/pool.js';
import { lineupDue } from './detail.js';

// A feed shaped exactly as statsapi's is - measured against gamePk 823543 and
// 824223 on 2026-09-22, including the empty array on an unposted card.
const feed = (awayOrder, homeOrder) => ({
  liveData: {
    boxscore: {
      teams: {
        away: {
          battingOrder: awayOrder.map((p) => p.id),
          players: Object.fromEntries(awayOrder.map((p) => [`ID${p.id}`,
            { person: { id: p.id, fullName: p.name }, position: { abbreviation: p.pos } }])),
        },
        home: {
          battingOrder: homeOrder.map((p) => p.id),
          players: Object.fromEntries(homeOrder.map((p) => [`ID${p.id}`,
            { person: { id: p.id, fullName: p.name }, position: { abbreviation: p.pos } }])),
        },
      },
    },
  },
});

const NINE = [
  { id: 650490, name: 'Yandy Díaz', pos: 'DH' },
  { id: 666018, name: 'Junior Caminero', pos: '3B' },
  { id: 691406, name: 'Carson Williams', pos: 'SS' },
  { id: 689414, name: 'Liam Hicks', pos: 'C' },
  { id: 802415, name: 'Chandler Simpson', pos: 'LF' },
  { id: 676356, name: 'Jonathan Aranda', pos: '1B' },
  { id: 683748, name: 'Josh Lowe', pos: 'RF' },
  { id: 656775, name: 'Taylor Walls', pos: '2B' },
  { id: 680700, name: 'Kameron Misner', pos: 'CF' },
];

// --- PRE-POST ---------------------------------------------------------------

test('pre-post: an empty battingOrder is NOT a lineup', () => {
  // The exact payload a Scheduled game returns: [] on both sides, with the
  // players already listed. A truthy check on the array would call this a
  // posted lineup with nobody in it.
  assert.equal(lineupsFrom(feed([], [])), null);
});

test('pre-post: no boxscore at all is null, which is not the same fact', () => {
  assert.equal(lineupsFrom({ liveData: {} }), null);
  assert.equal(lineupsFrom(null), null);
});

test('pre-post: the bats are the whole roster by PPG and the panel says so', () => {
  const rows = [
    { playerId: '1', name: 'A Bat', kind: 'bat', team: 'TB', ppg: 9, position: 'RF' },
    { playerId: '2', name: 'B Bat', kind: 'bat', team: 'TB', ppg: 4, position: '2B' },
    { playerId: '3', name: 'C Arm', kind: 'arm', team: 'TB', ppg: 20, position: 'SP', probable: true },
  ];
  const cut = startersOnly(rows, { lineup: null, awayAbbr: 'TB', homeAbbr: 'NYY' });
  assert.deepEqual(cut.posted, { away: false, home: false });
  assert.equal(cut.rows.length, 3, 'nobody is cut when there is no card to cut against');
  assert.deepEqual(cut.rows.filter((r) => r.kind === 'bat').map((r) => r.name), ['A Bat', 'B Bat']);
  // starting is NULL, not false: we do not know, and null is how that is said.
  assert.equal(cut.rows.find((r) => r.name === 'A Bat').starting, null);
  assert.equal(cut.rows.find((r) => r.name === 'A Bat').order, null);
});

test('pre-post: notStarting refuses to answer without a card', () => {
  assert.equal(notStarting({ playerId: '1', name: 'A Bat', team: 'TB' }, { lineup: null }), false);
  assert.equal(notStarting({ playerId: '1', name: 'A Bat', team: 'TB' },
    { lineup: { away: [], home: [] }, awayAbbr: 'TB', homeAbbr: 'NYY' }), false);
});

// --- POST -------------------------------------------------------------------

test('post: nine in order, with names and positions', () => {
  const l = lineupsFrom(feed(NINE, NINE));
  assert.equal(l.away.length, 9);
  assert.deepEqual(l.away.map((e) => e.order), [1, 2, 3, 4, 5, 6, 7, 8, 9]);
  assert.equal(l.away[3].name, 'Liam Hicks');
  assert.equal(l.away[3].position, 'C');
  assert.equal(l.away[3].id, '689414', 'the id is a string, as every provider id in this repo is');
});

test('post: one side posted is one side posted', () => {
  const l = lineupsFrom(feed(NINE, []));
  assert.equal(l.away.length, 9);
  assert.equal(l.home, null);
});

test('post: the bats are the card, in batting order, and nobody else', () => {
  const rows = [
    // Deliberately in PPG order, which is NOT batting order, so a test that
    // passed by accident would have to be sorting by something.
    { playerId: '9', name: 'Kameron Misner', kind: 'bat', team: 'TB', ppg: 12, position: 'CF' },
    { playerId: '1', name: 'Yandy Diaz', kind: 'bat', team: 'TB', ppg: 8, position: 'DH' },
    { playerId: '99', name: 'Benched Guy', kind: 'bat', team: 'TB', ppg: 99, position: 'RF' },
    { playerId: '5', name: 'Reliever Guy', kind: 'arm', team: 'TB', ppg: 3, position: 'RP' },
    { playerId: '6', name: 'The Starter', kind: 'arm', team: 'TB', ppg: 18, position: 'SP', probable: true },
  ];
  const cut = startersOnly(rows, {
    lineup: lineupsFrom(feed(NINE, [])), awayAbbr: 'TB', homeAbbr: 'NYY',
  });
  assert.equal(cut.posted.away, true);
  const names = cut.rows.map((r) => r.name);
  // The arm first (it is the probable), then the two bats IN BATTING ORDER.
  assert.deepEqual(names, ['The Starter', 'Yandy Diaz', 'Kameron Misner']);
  // The 99-PPG bat who is not on the card is GONE, not merely sorted last: a
  // picker that still offered him would be selling a zero.
  assert.equal(names.includes('Benched Guy'), false);
  // And the reliever is gone with him - the arm slot is a start.
  assert.equal(names.includes('Reliever Guy'), false);
  assert.equal(cut.rows.find((r) => r.name === 'Yandy Diaz').order, 1);
  assert.equal(cut.rows.find((r) => r.name === 'Kameron Misner').order, 9);
});

test('post: the accent is folded, because one provider carries them and one does not', () => {
  // statsapi says "Yandy Díaz"; BDL says "Yandy Diaz". Nine of the eighteen
  // starters of 2026-09-22's TB @ NYY missed on an exact-string match.
  const idx = orderIndex(lineupsFrom(feed(NINE, [])).away);
  const row = { playerId: '1', name: 'Yandy Diaz', kind: 'bat' };
  assert.equal(batWithOrder(row, idx, true).order, 1);
});

test('post: a club with no announced starter offers its SPs and says so', () => {
  const rows = [
    { playerId: '5', name: 'Reliever Guy', kind: 'arm', team: 'TB', ppg: 3, position: 'RP', probable: false },
    { playerId: '6', name: 'A Starter', kind: 'arm', team: 'TB', ppg: 18, position: 'SP', probable: false },
  ];
  const cut = startersOnly(rows, { lineup: null, awayAbbr: 'TB', homeAbbr: 'NYY' });
  assert.deepEqual(cut.rows.map((r) => r.name), ['A Starter']);
  assert.equal(cut.rows[0].probablePending, true,
    'the card says "starter not announced" off this, rather than looking confirmed');
});

// --- A PICK THAT FALLS OUT OF THE LINEUP ------------------------------------

test('a pick that falls out of a posted lineup is not starting', () => {
  const lineup = lineupsFrom(feed(NINE, []));
  const pick = { playerId: '99', name: 'Benched Guy', team: 'TB', matchId: 1 };
  assert.equal(notStarting(pick, { lineup, awayAbbr: 'TB', homeAbbr: 'NYY', locked: false }), true);
});

test('a pick still IN the posted lineup is starting', () => {
  const lineup = lineupsFrom(feed(NINE, []));
  const pick = { playerId: '1', name: 'Yandy Diaz', team: 'TB', matchId: 1 };
  assert.equal(notStarting(pick, { lineup, awayAbbr: 'TB', homeAbbr: 'NYY', locked: false }), false);
});

test('one side posted and a pick whose club we do not know is NOT called out', () => {
  // He may be on the side that has not posted. An old pick carries no team.
  const lineup = lineupsFrom(feed(NINE, []));
  const pick = { playerId: '99', name: 'Benched Guy', matchId: 1 };
  assert.equal(notStarting(pick, { lineup, awayAbbr: 'TB', homeAbbr: 'NYY' }), false);
  // With BOTH sides posted, absence is an answer.
  const both = lineupsFrom(feed(NINE, NINE.map((p) => ({ ...p, name: `H ${p.name}` }))));
  assert.equal(notStarting(pick, { lineup: both, awayAbbr: 'TB', homeAbbr: 'NYY' }), true);
});

// --- A LATE POST, AFTER THE LOCK -------------------------------------------

test('late post: a lineup that goes up after the lock never says "swap"', () => {
  const lineup = lineupsFrom(feed(NINE, []));
  const pick = { playerId: '99', name: 'Benched Guy', team: 'TB', matchId: 1 };
  assert.equal(notStarting(pick, { lineup, awayAbbr: 'TB', homeAbbr: 'NYY', locked: true }), false,
    'the reader cannot swap a locked slot, so telling them to is cruelty with a button attached');
});

test('late post: the bats are still cut to the card once it lands', () => {
  // The overlay is not conditional on the lock - the picker for a LOCKED game
  // is not rendered, and a posted card is still the right thing to build a
  // panel from for whatever else reads it.
  const rows = [{ playerId: '99', name: 'Benched Guy', kind: 'bat', team: 'TB', ppg: 99 }];
  const cut = startersOnly(rows, { lineup: lineupsFrom(feed(NINE, [])), awayAbbr: 'TB', homeAbbr: 'NYY' });
  assert.deepEqual(cut.rows, []);
});

// --- THE RUN'S PANEL, SAME RULE THROUGH THE SAME FUNCTIONS -----------------

test("The Run's panel: bats are the posted card, arms are untouched", () => {
  const rows = [
    { playerId: '6', name: 'A Starter', kind: 'arm', team: 'TB', ppg: 18, position: 'SP', g1: true },
    { playerId: '5', name: 'Reliever Guy', kind: 'arm', team: 'TB', ppg: 3, position: 'RP', g1: false },
    { playerId: '9', name: 'Kameron Misner', kind: 'bat', team: 'TB', ppg: 12 },
    { playerId: '1', name: 'Yandy Diaz', kind: 'bat', team: 'TB', ppg: 8 },
    { playerId: '99', name: 'Benched Guy', kind: 'bat', team: 'TB', ppg: 99 },
  ];
  const cut = clubStarters(rows, { posted: lineupsFrom(feed(NINE, [])).away });
  assert.equal(cut.posted, true);
  assert.deepEqual(cut.rows.map((r) => r.name),
    ['A Starter', 'Reliever Guy', 'Yandy Diaz', 'Kameron Misner']);
  // THE ARMS SURVIVE, and that is the one deliberate difference from October:
  // a Run arm scores every start his club gives him in a SERIES, so the game-2
  // and game-3 starters are worth as much as game 1's.
  assert.equal(cut.rows.filter((r) => r.kind === 'arm').length, 2);
  assert.equal(cut.rows.find((r) => r.name === 'Yandy Diaz').order, 1);
});

test("The Run's panel before the card is up offers the roster", () => {
  const rows = [{ playerId: '99', name: 'Benched Guy', kind: 'bat', team: 'TB', ppg: 99 }];
  const cut = clubStarters(rows, { posted: null });
  assert.equal(cut.posted, false);
  assert.equal(cut.rows.length, 1);
});

// --- THE CADENCE -----------------------------------------------------------

test('lineupDue: not before the window, not twice a minute, and always once', () => {
  const now = new Date('2026-09-22T20:00:00Z');
  const soon = '2026-09-22T22:35:00Z';          // 2h35 away: inside the window
  const far = '2026-09-24T22:35:00Z';           // two days out

  assert.equal(lineupDue({ kickoff_at: far, lineups: null }, { now }), false, 'too early to be posted');
  assert.equal(lineupDue({ kickoff_at: soon, lineups: null }, { now }), true, 'never asked');
  // Asked a minute ago and nothing was up: not again yet.
  assert.equal(lineupDue({ kickoff_at: soon, lineups: { fetchedAt: '2026-09-22T19:59:00Z', away: null, home: null } }, { now }), false);
  // Asked six minutes ago and nothing was up: ask again.
  assert.equal(lineupDue({ kickoff_at: soon, lineups: { fetchedAt: '2026-09-22T19:54:00Z', away: null, home: null } }, { now }), true);
  // Posted ten minutes ago: leave it alone.
  assert.equal(lineupDue({ kickoff_at: soon, lineups: { fetchedAt: '2026-09-22T19:50:00Z', away: [{ id: '1' }], home: null } }, { now }), false);
  // Posted twenty minutes ago: re-read it, because a scratch lands after the
  // card does and it is the one thing a reader most needs to see.
  assert.equal(lineupDue({ kickoff_at: soon, lineups: { fetchedAt: '2026-09-22T19:40:00Z', away: [{ id: '1' }], home: null } }, { now }), true);
  // A row with no kickoff is not due for anything.
  assert.equal(lineupDue({ kickoff_at: null, lineups: null }, { now }), false);
});

test('post: two posted cards are two lists, away first, not one interleaved one', () => {
  const home = NINE.map((p, i) => ({ id: 900 + i, name: `H Bat ${i + 1}`, pos: 'RF' }));
  const rows = [
    ...NINE.slice(0, 3).map((p, i) => ({ playerId: `a${i}`, name: p.name, kind: 'bat', team: 'TB', ppg: 5 })),
    ...home.slice(0, 3).map((p, i) => ({ playerId: `h${i}`, name: p.name, kind: 'bat', team: 'NYY', ppg: 9 })),
  ];
  const cut = startersOnly(rows, { lineup: lineupsFrom(feed(NINE, home)), awayAbbr: 'TB', homeAbbr: 'NYY' });
  // Away's 1-2-3, THEN home's 1-2-3. Sorting on the order alone gave
  // 1st, 1st, 2nd, 2nd - a list nobody batted in.
  assert.deepEqual(cut.rows.map((r) => `${r.team}${r.order}`),
    ['TB1', 'TB2', 'TB3', 'NYY1', 'NYY2', 'NYY3']);
});

// --- AN EMPTY CLUB IS NOT A RESULT ------------------------------------------

test('the pool builders refuse to CACHE a club that came back empty', async () => {
  // Source-level, because the write is a single statement guarded by a count
  // and the thing worth pinning is that the guard is in front of it. Measured
  // failure: a four-round rebuild hit balldontlie's rate limit and cached
  // thirteen empty clubs, which reads as "nobody may be picked from this club"
  // and is never retried - runPool/octoberPool only build when meta.pool is
  // ABSENT.
  const fs = await import('node:fs');
  for (const f of ['../october/pool.js', '../run/pool.js']) {
    const src = fs.readFileSync(new URL(f, import.meta.url), 'utf8');
    const write = src.indexOf('UPDATE contests SET meta');
    assert.ok(write > -1, `${f} still caches a pool`);
    const before = src.slice(0, write);
    assert.match(before, /if \(!failed\)|if \(failed === 0\)/,
      `${f} writes its cache without checking whether a club came back empty`);
    assert.match(src, /incomplete: failed > 0/, `${f} does not say the pool is incomplete`);
  }
});
