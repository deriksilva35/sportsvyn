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
    // sun-16 D, deliberately: "No odds, no problem" was untrue - the board
    // shows the line.
    'Pick the winners, straight up.',
    'One season from NFL history. Twelve teams. Eight slots. Four regrets.',
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
  // sat-5 Y4: the board opens at 00:00 ET; "every morning" was the push.
  assert.ok(PAGE.includes('Daily · a new board at midnight ET'));
  assert.ok(!PAGE.includes('every morning'), 'no surface on this page says morning for the Daily');
  // One constant, used three times - not three copies that can drift apart.
  assert.equal((PAGE.match(/WEEKLY_CADENCE/g) ?? []).length, 4,
    'one declaration and three uses');
});

// THESE TWO TESTS WERE ONE, AND SPLITTING THEM IS THE POINT.
//
// The explainer's Daily steps used to be lifted verbatim from DailyRoom and
// one loop asserted BOTH files against the same three strings - which was
// right while this section linked to /daily, because then the two surfaces
// described the same game and drift between them was the only failure worth
// catching.
//
// They now describe DIFFERENT GAMES. The explainer's Daily section links to
// DAILY_V2_PATH (the twelve-team season board); DailyRoom is v1's room, still
// live under /daily, still six players and a season guess. Held together by
// one assertion, the pair could only be made to pass by dragging one game's
// words onto the other's screen - exactly the drift the original test existed
// to prevent, wearing the test's own clothes.
//
// So: two tests, two sources of truth, no shared literals. Each guards its own
// copy, and neither can be satisfied by editing the other file.

test("the explainer's Daily steps are the season board's, pinned to this page", () => {
  for (const [t, d] of [
    ['Deal', 'Twelve teams from one past season'],
    ['Place', 'Open any team and put a player in a slot. Clear it to get the team back'],
    ['Skip', 'Four teams go unused, and you choose which'],
  ]) {
    assert.ok(PAGE.includes(`t: '${t}', d: '${d}'`),
      `the explainer no longer says "${t}: ${d}"`);
  }
  assert.ok(PAGE.includes("graded: 'Season fantasy points, PPR, against the board. Nothing is dropped.'"),
    'the Daily grading line no longer describes the season board');
  // sat-5 Y3: opening a team commits nothing - a slot can be cleared.
  assert.ok(!/must take somebody/.test(PAGE), 'the commit-on-open rule is back');
  // The uncoupling, asserted rather than trusted: v1's step copy must not
  // reappear here. A well-meaning revert would otherwise pass silently.
  for (const gone of ['Six players, any position mix', 'Name the season for a bonus']) {
    assert.ok(!PAGE.includes(gone), `v1 step copy is back on the explainer: ${gone}`);
  }
});

test("DailyRoom keeps v1's own three steps, word for word", () => {
  // v1 is RETIRED (sat-5 Y1: /daily 308s to the board) but DailyRoom stays as
  // history with the v1 data, and this is still the only guard on its step
  // cards. Pinned here, to DailyRoom alone, so the room's words cannot be
  // quietly rewritten to match an explainer that no longer describes it.
  const room = src('components/daily/DailyRoom.js');
  for (const [t, d] of [
    ['Draft', 'Six players, any position mix'],
    ['Reveal', 'Sim replays the week at midnight ET'],
    ['Guess', 'Name the season for a bonus'],
  ]) {
    assert.ok(room.includes(`>${t}</div><div className="d">${d}</div>`),
      `DailyRoom no longer says "${t}: ${d}"`);
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

test('/games links to it, outside any boards guard so it always renders', () => {
  // GAMES v3: the pane is components/games/LobbyV3.js. Same law, same
  // shape - the ghost sits in the This week foot, outside every signed-in
  // branch, so a stranger and a member both meet it.
  const games = src('components/games/LobbyV3.js');
  assert.ok(games.includes('href="/games/how-it-works">How the games work'),
    '/games carries the ghost link');
  assert.ok(!games.includes('boardRows'), 'no boards guard exists to hide it behind');
  const foot = games.slice(games.indexOf('className="gv-more"'));
  assert.ok(foot.includes('How the games work'), 'in the always-rendered foot');
  // and it is NOT inside the !signedIn block - that is the second entrance.
  const stranger = games.indexOf('lob-stranger');
  assert.ok(games.indexOf('className="gv-more"') > stranger, 'the ghost sits after, not within');
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
    ['Seat', 'Take one of twelve. You choose again every week.'],
    ['Draft', 'Eight rounds against the room, thirty seconds a pick, no bench.'],
    ['Score', 'Best six of your eight count, against every other drafter that week.'],
    ['Pick', 'Six slots: QB, RB, WR, TE and two flex. Any player, nobody is taken.'],
    ['Edit', 'No clock. Change it until first kickoff; whatever is saved is your entry.'],
    ['Grade', 'Tuesday you are graded against the best six that pool could have made.'],
    ['Call', 'Every game on the board, straight up. The spread is shown, never required.'],
    ['Lock', 'Each game locks at its own kickoff. Change a pick until then.'],
    // sun-16 D, deliberately: "across both sports" - Pick'em runs in four.
    ['Tally', 'One season table, ranked on correct percentage.'],
  ];
  for (const [t, d] of STEPS) {
    assert.ok(PAGE.includes(`t: '${t}', d: '${d}' }`),
      `missing or altered: ${t} - ${d}`);
  }
});

// sat-5 Y2-Y8: THE DAILY'S HOUSE RULES, each one what the code does today.
// Copy pins, plus the facts behind them read from the code that owns them, so
// a rule change that forgets this page fails here.
test("the Daily's house rules are stated, and match the code", async () => {
  const rules = [
    'Each team card holds 4 to 6 players.',
    'A new board opens every day at midnight ET. One attempt per board.',
    'The clock is 3 minutes from Start, kept on the server.',
    'Your picks stay on your device until you lock in. Close the tab and they are lost; a run that never locks in is a DNF.',
    'Kickers score 3 per field goal and 1 per extra point. There is no fumble penalty.',
    'Ties: the same score shares a place, so every perfect board is 1st. Within a tie, the earliest lock-in lists first.',
  ];
  for (const r of rules) assert.ok(PAGE.includes(`'${r}'`), `missing or altered: ${r}`);
  const daily = PAGE.slice(PAGE.indexOf("key: 'daily'"), PAGE.indexOf('export default'));
  assert.doesNotMatch(daily, /drop(ped)? worst|worst pick/i, 'no drop-worst on the Daily');

  const gen = await import('../../../lib/daily/boardGenerator.js');
  assert.equal(gen.CARD_MIN, 4); assert.equal(gen.CARD_MAX, 6);
  const shape = await import('../../../lib/daily/boardShape.js');
  assert.equal(shape.DAILY_ROUND_SECONDS, 180);
  const { SCORING } = await import('../../../lib/fantasy/scoring.js');
  assert.equal(SCORING.fieldGoal, 3); assert.equal(SCORING.extraPoint, 1);
  assert.match(src('lib/daily/seasonStatLine.js'), /fumbles_lost is NULL across the WHOLE/);
  const editions = src('lib/daily/seasonBoardEditions.js');
  assert.match(editions, /const opensAt = await easternLocalToUtc\(`\$\{editionDate\} 00:00:00`\)/);
  const lb = src('lib/daily/seasonBoardLeaderboards.js');
  const today = lb.slice(lb.indexOf('export async function todayLeaderboard'));
  // THE TIE RULE (sun-16 C, lib/games/rank.js): rank() not dense_rank(), and
  // matched no longer orders a tie, and the page's Daily ties line says so
  // ("the earliest lock-in lists first", ruling sun-18).
  assert.match(today, /rank\(\) OVER \(ORDER BY r\.score DESC\) AS rank/);
  assert.doesNotMatch(today, /dense_rank/);
  assert.match(today, /ORDER BY r\.score DESC, r\.completed_at ASC/);
});

// ---------------------------------------------------------------------------
// THE GAME LIST IS THE REGISTRY'S (sun-16 D). The page said "three weekly
// games and one every day" for a month in which five more shipped. Now the
// list, the intro count and the description are generated, and these tests
// hold the page to the registry rather than to a list typed twice.
// ---------------------------------------------------------------------------

test('EVERY LISTED REGISTRY GAME APPEARS, and the flagged ones (Survivor, Game Drafts) do not while off', async () => {
  const { PLAY_REGISTRY, listedGames } = await import('../../../lib/games/playRegistry.js');
  const { gameGroups, introLine } = await import('../../../lib/games/howItWorks.js');
  const off = listedGames(PLAY_REGISTRY, { SURVIVOR: '', DRAFT_GAME_BOARDS: '' });
  const keys = gameGroups(off, new Date('2026-10-04T16:00:00Z')).flatMap((g) => g.games.map((x) => x.key));
  const FLAGGED = ['nfl-survivor', 'nfl-draft-game'];
  const want = PLAY_REGISTRY.filter((e) => !FLAGGED.includes(e.key)).map((e) => e.key);
  assert.deepEqual([...keys].sort(), [...want].sort(), 'every registry game but the flagged ones');
  assert.ok(!keys.includes('nfl-survivor'), 'Survivor is pulled, so it is not listed');
  for (const k of ['mlb-october', 'mlb-run', 'mlb-series', 'nba-six', 'epl-weekly-5', 'daily']) {
    assert.ok(keys.includes(k), `${k} is on the explainer`);
  }
  // The flag is the only thing hiding it: switched on, it is listed.
  assert.ok(listedGames(PLAY_REGISTRY, { SURVIVOR: 'on' }).some((e) => e.key === 'nfl-survivor'));
  // Game Drafts (fri-1) the same way, behind DRAFT_GAME_BOARDS.
  assert.ok(listedGames(PLAY_REGISTRY, { DRAFT_GAME_BOARDS: 'on' }).some((e) => e.key === 'nfl-draft-game'));
  assert.ok(!keys.includes('nfl-draft-game'), 'Game Drafts is off, so it is not listed');
  // Each row carries the registry's own words, never a blank.
  for (const g of gameGroups(off).flatMap((x) => x.games)) {
    const e = PLAY_REGISTRY.find((r) => r.key === g.key);
    assert.equal(g.name, e.name); assert.equal(g.mark, e.mark); assert.equal(g.href, e.href);
    assert.ok(typeof g.about === 'string' && g.about.length > 10, `${g.key} has its one line`);
  }
  // The intro is counted, not typed: 11 games, five sports (the Daily is every day, not a sport).
  assert.equal(introLine(off), 'Eleven games across five sports. All free, an email and a handle.');
});

test('the page renders the registry list and says nothing stale', () => {
  assert.match(PAGE, /import \{ listedGames \} from '@\/lib\/games\/playRegistry'/);
  assert.match(PAGE, /const games = listedGames\(\);/);
  assert.match(PAGE, /description: introLine\(listedGames\(\)\)/, 'the description is counted too');
  assert.match(PAGE, /<p className="lob-sub">\{introLine\(games\)\}<\/p>/);
  for (const stale of ['Three weekly games', 'No odds', 'across both sports', 'one every day.']) {
    assert.ok(!PAGE.includes(`'${stale}`) && !PAGE.includes(`${stale}'`) && !new RegExp(`>[^<]*${stale}`).test(PAGE),
      `stale copy on the page: ${stale}`);
  }
  assert.match(PAGE, /data-seasonal=\{g\.seasonal \? '1' : '0'\}/);
});

test('a game out of season is LISTED, marked seasonal; in season it is not marked', async () => {
  const { PLAY_REGISTRY, listedGames } = await import('../../../lib/games/playRegistry.js');
  const { gameGroups, inSeason } = await import('../../../lib/games/howItWorks.js');
  const games = listedGames(PLAY_REGISTRY, {});
  const row = (now, key) => gameGroups(games, now).flatMap((g) => g.games).find((x) => x.key === key);
  const MAY = new Date('2027-05-15T16:00:00Z');
  const OCT = new Date('2026-10-04T16:00:00Z');
  assert.equal(row(MAY, 'mlb-october').seasonal, true, 'October in May is still on the page');
  assert.match(row(MAY, 'mlb-october').seasonWords, /postseason/);
  assert.equal(row(OCT, 'mlb-october').seasonal, false);
  assert.equal(row(MAY, 'nfl-weekly').seasonal, true);
  assert.equal(row(new Date('2027-01-20T16:00:00Z'), 'nfl-weekly').seasonal, false, 'the NFL window wraps the new year');
  assert.equal(row(MAY, 'daily').seasonal, false, 'the Daily is every day');
  assert.equal(inSeason({ season: null }, MAY), true);
  // ET, not UTC: 03:00Z on 1 Sep is still 31 Aug in New York.
  assert.equal(inSeason({ season: { from: '09-01', to: '02-15' } }, new Date('2026-09-01T03:00:00Z')), false);
});
