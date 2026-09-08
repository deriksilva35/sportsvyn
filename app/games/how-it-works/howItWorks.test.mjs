// app/games/how-it-works/howItWorks.test.mjs - relay 5.
//
// THE ONE RULE THIS PAGE HAS IS THAT ITS COPY IS NOT INVENTED (item 5), so
// that is what the tests pin: every tagline exactly as ratified, the two
// cadence lines exactly as ratified, and the Daily's three steps still
// word-for-word identical to the DailyRoom block they were lifted from.
// The last one is the only assertion here that can rot on its own - the
// others change only if somebody edits this page.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const src = (rel) => readFileSync(path.join(REPO, rel), 'utf8');
const PAGE = src('app/games/how-it-works/page.js');

test('the four taglines are verbatim', () => {
  for (const t of [
    'Pick your seat, draft your team, compete against the field.',
    'Pick the winners. No odds, no problem.',
    'One season from NFL history. Twelve teams. Nine slots. Three regrets.',
  ]) {
    assert.ok(PAGE.includes(t), `missing or altered: ${t}`);
  }
  // The Weekly's is the one long enough to be wrapped in source, so it is
  // checked after the concatenation is undone rather than as a literal.
  const joined = PAGE.replace(/'\s*\+\s*'/g, '');
  assert.ok(joined.includes(
    'Pick any player at each position. Make your best roster, no draft, '
    + 'no salary, and see where it stacks up against the field that week.'),
  "the Weekly's tagline is missing or altered");
});

test('the two cadence lines are verbatim, and three games share one', () => {
  assert.ok(PAGE.includes('Weekly · opens Tuesday, locks at first kickoff'));
  assert.ok(PAGE.includes('Daily · a new board every morning'));
  // One constant, used three times - not three copies that can drift apart.
  assert.equal((PAGE.match(/WEEKLY_CADENCE/g) ?? []).length, 4,
    'one declaration and three uses');
});

test("the Daily's steps still match DailyRoom's, word for word", () => {
  // THE ONLY BORROWED COPY ON THE PAGE. If somebody rewords the Daily's own
  // step cards, this page silently starts telling a different story - so
  // the two are compared directly rather than both trusted.
  const room = src('components/daily/DailyRoom.js');
  for (const [t, d] of [
    ['Draft', 'Six players, any position mix'],
    ['Reveal', 'Sim replays the week at midnight ET'],
    ['Guess', 'Name the season for a bonus'],
  ]) {
    assert.ok(room.includes(`>${t}</div><div className="d">${d}</div>`),
      `DailyRoom no longer says "${t}: ${d}" - update the explainer to match`);
    assert.ok(PAGE.includes(`t: '${t}', d: '${d}'`),
      `the explainer no longer says "${t}: ${d}"`);
  }
});

test('the sections are in the order the item fixes', () => {
  const order = [...PAGE.matchAll(/key: '(draft|weekly|pickem|daily)'/g)].map((m) => m[1]);
  assert.deepEqual(order, ['draft', 'weekly', 'pickem', 'daily']);
});

test('the page reads NO session and NO database', () => {
  // Static by construction, not by luck: a stranger is the whole audience.
  assert.doesNotMatch(PAGE, /\bauth\(\)/, 'no session read');
  assert.doesNotMatch(PAGE, /from '@\/lib\/db'|sql`/, 'no database read');
  assert.match(PAGE, /export const dynamic = 'force-static'/);
});

test('the game names come from the one place that owns them', () => {
  // "The Draft" etc. are never typed here - GAME_NAMES is the source, the
  // same rule every other surface follows.
  assert.match(PAGE, /import \{ GAME_NAMES \} from '@\/lib\/games\/lobby'/);
  for (const k of ['draft', 'weekly', 'pickem', 'daily']) {
    assert.ok(PAGE.includes(`GAME_NAMES.${k}`), `${k} should take its name from GAME_NAMES`);
  }
});

test('/games links to it, outside the boards guard so it always renders', () => {
  const games = src('app/games/page.js');
  assert.ok(games.includes('href="/games/how-it-works">How the games work'),
    '/games carries the ghost link');
  // It must NOT sit inside `{v.boardRows?.length > 0 && (` - an empty slate
  // is exactly when a reader needs the explainer most.
  const guard = games.indexOf('{v.boardRows?.length > 0 && (');
  const close = games.indexOf('How the games work');
  const endOfGuard = games.indexOf('      )}', guard);
  assert.ok(close > endOfGuard, 'the link must be outside the boardRows guard');
});

test('ALL TWELVE STEPS ARE PRESENT - no section is missing its copy', () => {
  // Relay 5 shipped with three of twelve and `steps: null` on the rest,
  // rather than invent nine. 5b supplied them, so the null count is the
  // thing that must now be zero - it is the same assertion, inverted, and
  // it still catches a section quietly losing its steps.
  assert.equal((PAGE.match(/steps: null/g) ?? []).length, 0,
    'every section has step copy now');
  assert.equal((PAGE.match(/\{ n: [123], t: '/g) ?? []).length, 12,
    'four sections x three steps');
});

test('the nine relay-5b steps are verbatim', () => {
  // Transcribed copy, so it is checked character for character. Anything
  // reworded here is a change to ratified copy and should fail loudly.
  const STEPS = [
    ['Seat', 'Take one of twelve. It is yours all season.'],
    ['Draft', 'Eight rounds against the room, thirty seconds a pick, no bench.'],
    ['Score', 'Best six of your eight count, against every other drafter that week.'],
    ['Pick', 'Six slots: QB, RB, WR, TE and two flex. Any player, nobody is taken.'],
    ['Edit', 'No clock. Change it until first kickoff; whatever is saved is your entry.'],
    ['Grade', 'Tuesday you are graded against the best six that pool could have made.'],
    ['Call', 'Every game on the board, straight up. The spread is shown, never required.'],
    ['Lock', 'Each game locks at its own kickoff. Change a pick until then.'],
    ['Tally', 'One season table across both sports, ranked on correct percentage.'],
  ];
  for (const [t, d] of STEPS) {
    assert.ok(PAGE.includes(`t: '${t}', d: '${d}' }`),
      `missing or altered: ${t} - ${d}`);
  }
});
