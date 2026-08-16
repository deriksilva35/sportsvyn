// lib/daily/homeModule.test.mjs - the homepage module's view. PURE.
//
// THE LEAK TESTS ARE THE POINT. This module renders on the widest-read page on
// the site, for signed-out strangers, while the board is still live. A season
// or a week in the pre-close markup publishes the answer to everyone who never
// played - so those assertions are written against the SERIALIZED view, the
// same posture publicBoard's wire test takes.

import { test } from 'node:test';
import assert from 'node:assert/strict';

const {
  dailyHomeView, editionNo, editionLabel, ENTRIES_FLOOR, DAILY_EPOCH,
} = await import('./homeModule.js');

const DAY = {
  puzzle_date: '2026-08-16', season_year: 2018, week: 10,
  perfect: { total: 122.9 },
};
const LOCKED = (n) => Array.from({ length: n }, (_, i) => 50 + i);
const ENTRY = {
  id: 1, locked_at: '2026-08-16T20:00:00Z', score: 102.5,
  base_score: 102.5, bonus_pct: 0, guess_season: 2018, guess_week: 10,
};

// ---------------------------------------------------------------------------
// EDITION NUMBER
// ---------------------------------------------------------------------------

test('EDITION: the epoch is No. 001 and it counts up by the day', () => {
  assert.equal(editionNo(DAILY_EPOCH), 1);
  assert.equal(editionNo('2026-08-17'), 2);
  assert.equal(editionNo('2026-09-04'), 20);
  assert.equal(editionLabel(editionNo('2026-08-16')), '001');
  assert.equal(editionLabel(editionNo('2026-09-04')), '020');
});

test('EDITION survives the DST boundary between the epoch and today', () => {
  // Both sides are parsed at UTC midnight on purpose. Parsed as LOCAL dates,
  // the Nov 1 change would make one of these come out a day short.
  assert.equal(editionNo('2026-11-01'), 78);
  assert.equal(editionNo('2026-11-02'), 79, 'the day after the change is one more, not the same');
});

test('EDITION: a date before the epoch, or an unparseable one, is null not a negative', () => {
  assert.equal(editionNo('2026-08-15'), null);
  assert.equal(editionNo('not-a-date'), null);
  assert.equal(editionLabel(null), null);
});

test('EDITION does not wrap past 999', () => {
  assert.equal(editionLabel(1000), '1000');
});

// ---------------------------------------------------------------------------
// STATE SELECTION
// ---------------------------------------------------------------------------

test('STATE: no entry on an open day is the PLAY state', () => {
  const v = dailyHomeView({ date: '2026-08-16', dayState: 'open', day: DAY, entry: null });
  assert.equal(v.state, 'play');
  assert.equal(v.edition, '001');
});

test('STATE: a signed-out visitor gets PLAY, same as a signed-in non-player', () => {
  // Signed out arrives as entry: null - there is no separate branch, and there
  // should not be: the module says the same thing to both.
  const out = dailyHomeView({ date: '2026-08-16', dayState: 'open', day: DAY, entry: null });
  const inn = dailyHomeView({ date: '2026-08-16', dayState: 'open', day: DAY, entry: null });
  assert.deepEqual(out, inn);
  assert.equal(out.state, 'play');
});

test('STATE: an entry on an open day is the RECEIPT', () => {
  const v = dailyHomeView({ date: '2026-08-16', dayState: 'open', day: DAY, entry: ENTRY, scores: LOCKED(40) });
  assert.equal(v.state, 'receipt');
  assert.equal(v.score, 102.5);
  assert.equal(v.guessSeason, 2018);
  assert.equal(v.guessWeek, 10);
  assert.ok(v.band, 'a receipt carries a band');
});

test('STATE: a STARTED but never locked entry is still PLAY, not a receipt', () => {
  // An unlocked row is a round in progress or a DNF; neither has a score, and
  // a receipt with no score would render an empty number.
  const v = dailyHomeView({
    date: '2026-08-16', dayState: 'open', day: DAY,
    entry: { id: 2, locked_at: null, score: null },
  });
  assert.equal(v.state, 'play');
});

test('STATE: a closed day is REVEALED, and carries the answer', () => {
  const v = dailyHomeView({ date: '2026-08-16', dayState: 'closed', day: DAY, entry: ENTRY });
  assert.equal(v.state, 'revealed');
  assert.equal(v.played, true);
  assert.equal(v.season, 2018);
  assert.equal(v.week, 10);
  assert.equal(v.perfect, 122.9);
  assert.equal(v.pct, 83, '102.5 of 122.9 is 83%');
  assert.equal(v.tier, 'PRO BOWLER');
  assert.equal(v.seasonRight, true);
  assert.equal(v.weekRight, true);
});

test('STATE: a closed day REVEALS to someone who never played', () => {
  // The answer is public once the day is over. Hiding it from a non-player
  // would be pretending the board is still live.
  const v = dailyHomeView({ date: '2026-08-16', dayState: 'closed', day: DAY, entry: null });
  assert.equal(v.state, 'revealed');
  assert.equal(v.played, false);
  assert.equal(v.season, 2018);
  assert.equal(v.score, undefined, 'a non-player has no score to show');
});

test('STATE: a day that has not opened, or does not exist, renders NOTHING', () => {
  assert.equal(dailyHomeView({ date: '2026-08-16', dayState: 'pending', day: DAY }), null);
  assert.equal(dailyHomeView({ date: '2026-08-16', dayState: 'missing' }), null);
  assert.equal(dailyHomeView({}), null);
  assert.equal(dailyHomeView(), null);
});

// ---------------------------------------------------------------------------
// THE ENTRIES FLOOR
// ---------------------------------------------------------------------------

test('ENTRIES FLOOR: below 25 the count is ABSENT, not zero', () => {
  const v = dailyHomeView({ date: '2026-08-16', dayState: 'open', day: DAY, entry: ENTRY, scores: LOCKED(24) });
  assert.equal(v.entrants, null, '24 entries is an empty room, and saying so advertises it');
});

test('ENTRIES FLOOR: 25 exactly is the first count that prints', () => {
  const v = dailyHomeView({ date: '2026-08-16', dayState: 'open', day: DAY, entry: ENTRY, scores: LOCKED(25) });
  assert.equal(v.entrants, 25, 'the floor is inclusive');
  assert.equal(ENTRIES_FLOOR, 25, 'the ruling, not a feel');
});

test('ENTRIES FLOOR: well above it, the real count prints', () => {
  const v = dailyHomeView({ date: '2026-08-16', dayState: 'open', day: DAY, entry: ENTRY, scores: LOCKED(1204) });
  assert.equal(v.entrants, 1204);
});

// ---------------------------------------------------------------------------
// WIRE DISCIPLINE - asserted on the SERIALIZED view
// ---------------------------------------------------------------------------

test('LEAK: the PLAY view contains no season, no week, no board content', () => {
  const v = dailyHomeView({ date: '2026-08-16', dayState: 'open', day: DAY, entry: null });
  const wire = JSON.stringify(v);
  assert.equal(/2018/.test(wire), false, 'the season is the answer');
  assert.equal(/"week"/.test(wire), false);
  assert.equal(/"season"/.test(wire), false);
  assert.equal(/"board"/.test(wire), false);
  assert.equal(/"points"/.test(wire), false);
  assert.deepEqual(Object.keys(v).sort(), ['date', 'edition', 'state']);
});

test('LEAK: the RECEIPT view of a PLAYED user still contains no season-week', () => {
  // The player typed their own guess, so echoing it back reveals nothing - but
  // the DAY's season and week must not be in the payload at all.
  const v = dailyHomeView({ date: '2026-08-16', dayState: 'open', day: DAY, entry: ENTRY, scores: LOCKED(40) });
  const wire = JSON.stringify(v);
  assert.equal(/"season"\s*:/.test(wire), false, 'the day season must be absent');
  assert.equal(/"week"\s*:/.test(wire), false, 'the day week must be absent');
  assert.equal(/"perfect"/.test(wire), false, 'the perfect total is a pre-close answer too');
  assert.equal(/"tier"/.test(wire), false);
  // What it MAY carry: the reader's own inputs and their own score.
  assert.deepEqual(Object.keys(v).sort(),
    ['band', 'date', 'edition', 'entrants', 'guessSeason', 'guessWeek', 'score', 'state']);
});

test('LEAK: a WRONG guess in the receipt does not reveal the right one by omission', () => {
  // guessSeason echoes what the player typed, right or wrong. Nothing in the
  // shape differs between a correct and an incorrect guess pre-close - if it
  // did, the presence of a field would be the answer.
  const right = dailyHomeView({ date: '2026-08-16', dayState: 'open', day: DAY, entry: ENTRY, scores: LOCKED(40) });
  const wrong = dailyHomeView({
    date: '2026-08-16', dayState: 'open', day: DAY, scores: LOCKED(40),
    entry: { ...ENTRY, guess_season: 2016, guess_week: 3 },
  });
  assert.deepEqual(Object.keys(right).sort(), Object.keys(wrong).sort());
  assert.equal(wrong.guessSeason, 2016);
  assert.equal(/"seasonRight"/.test(JSON.stringify(wrong)), false, 'correctness is a reveal-time fact');
});

test('LEAK: only the REVEALED view is allowed to carry the answer', () => {
  // The fixture guesses 2016, NOT the answer. With ENTRY's correct 2018 guess
  // the string "2018" appears legitimately - it is the player's own input read
  // back - and the assertion would pass or fail for the wrong reason. A wrong
  // guess makes any occurrence of 2018 a real leak.
  const wrongGuess = { ...ENTRY, guess_season: 2016, guess_week: 3 };
  const open = JSON.stringify(dailyHomeView({ date: '2026-08-16', dayState: 'open', day: DAY, entry: wrongGuess, scores: LOCKED(40) }));
  const closed = JSON.stringify(dailyHomeView({ date: '2026-08-16', dayState: 'closed', day: DAY, entry: wrongGuess }));
  assert.equal(/2018/.test(open), false, 'the answer must not appear pre-close by any route');
  assert.equal(/\b10\b/.test(open.replace(/102\.5/g, '')), false, 'nor the week');
  assert.equal(/2018/.test(closed), true, 'and after close it must, or the module says nothing');
});
