// lib/gridiron/kickoff.test.mjs — when a game is, and what a card may say
// about it. Run: node --test lib/gridiron/kickoff.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { kickoffParts, kickoffLabel, dayKey, dayHeading, groupByDay, spansMultipleDays } from './kickoff.js';
import { safeTz } from './viewerTz.js';
import { soleDayKey, dayOffset } from './kickoff.js';
import { moduleHeading, leagueUnit } from './leagueLanding.js';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const src = (r) => readFileSync(path.join(REPO, r), 'utf8');
const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

const ET = 'America/New_York';
const PT = 'America/Los_Angeles';
// NE at SEA, the real row: 00:20Z on the 10th, which is the EVENING of the 9th
// in every US zone. Chosen because it is the case that breaks naive handling.
const NIGHT = '2026-09-10T00:20:00Z';
const SUNDAY = '2026-09-13T17:00:00Z';

// ---------------------------------------------------------------------------
// 1. THE DAY IS ON THE CARD
// ---------------------------------------------------------------------------

test('a pre-game card says day-of-week, date and time', () => {
  assert.equal(kickoffLabel(SUNDAY, ET), 'Sun Sep 13 · 1:00 PM');
  const p = kickoffParts(SUNDAY, ET);
  assert.deepEqual(p, { day: 'Sun Sep 13', time: '1:00 PM' });
});

test('every pre-game card renders the day, and drops it only inside a day group', () => {
  // The card must not be able to lose its day by accident: withDay defaults to
  // true, so a caller that forgets the prop still gets the full grammar, and
  // only the grouped branch - which has a header carrying the day - opts out.
  const t = strip(src('components/gridiron/Scoreboard.js'));
  assert.match(t, /function Kickoff\(\{ iso, tz, withDay = true \}\)/,
    'the day is on by default');
  assert.match(t, /withDay=\{false\}/, 'and off only under a day header');
  // The ungrouped branch passes no withDay at all, so it takes the default.
  assert.doesNotMatch(t, /withDay=\{false\}[\s\S]{0,400}?days\.length > 1/,
    'the single-day branch must not suppress the day');
});

// ---------------------------------------------------------------------------
// 2. THE DAY IS THE READER'S DAY, NOT THE ISO STRING'S
// ---------------------------------------------------------------------------

test('THE DAY IS NOT iso.slice(0,10)', () => {
  // The whole reason dayKey exists. A Wednesday-night kickoff at 8:20pm
  // Eastern is 00:20 UTC on THURSDAY: slicing the ISO string files it under
  // the wrong day, and a day header built from that string would be wrong for
  // every prime-time game in the season.
  assert.equal(NIGHT.slice(0, 10), '2026-09-10');
  assert.equal(dayKey(NIGHT, ET), '2026-09-09');
  assert.equal(dayKey(NIGHT, PT), '2026-09-09');
  assert.equal(dayHeading(NIGHT, ET), 'Wednesday · Sep 9');
});

test('the same kickoff reads in the zone it is given, and the zone is never a default', () => {
  assert.equal(kickoffParts(NIGHT, ET).time, '8:20 PM');
  assert.equal(kickoffParts(NIGHT, PT).time, '5:20 PM');
  // No tz, no answer - the module never silently picks one.
  assert.equal(kickoffParts(NIGHT, null), null);
  assert.equal(dayKey(NIGHT, null), null);
});

// ---------------------------------------------------------------------------
// 3. GROUPING ORDER
// ---------------------------------------------------------------------------

test('days ascend, and LIVE comes first within a day', () => {
  const games = [
    { id: 3, status: 'final', kickoffAt: SUNDAY },
    { id: 1, status: 'scheduled', kickoffAt: '2026-09-14T00:15:00Z' },
    { id: 2, status: 'live', kickoffAt: '2026-09-13T20:25:00Z' },
    { id: 4, status: 'scheduled', kickoffAt: NIGHT },
  ];
  const days = groupByDay(games, ET);
  // TWO DAYS, NOT THREE. Game 1 is 00:15Z on the 14th, which looks like Monday
  // in the ISO string and is 8:15pm SUNDAY in Eastern - it belongs under the
  // Sunday header, and putting it under a Monday one is exactly the error
  // dayKey exists to prevent.
  assert.deepEqual(days.map((d) => d.key), ['2026-09-09', '2026-09-13']);
  assert.deepEqual(days.map((d) => d.heading), ['Wednesday · Sep 9', 'Sunday · Sep 13']);
  // Within Sunday: LIVE, then UPCOMING, then FINAL - the same band order
  // scoresSlice uses across the whole list, applied inside the day. Game 2 is
  // live and leads though it kicked off after game 3; game 3 is finished and
  // sinks below game 1, which has not started. The reader's priority, not the
  // clock's.
  assert.deepEqual(days[1].games.map((g) => g.id), [2, 1, 3]);
});

test('a game with no usable kickoff is grouped last, never dropped', () => {
  // Vanishing is the one behaviour a scoreboard must never have.
  const days = groupByDay([
    { id: 1, status: 'scheduled', kickoffAt: SUNDAY },
    { id: 2, status: 'scheduled', kickoffAt: null },
  ], ET);
  assert.equal(days.length, 2);
  assert.equal(days[1].key, null);
  assert.equal(days[1].heading, null, 'no date, no heading - never a fabricated one');
  assert.equal(days[1].games[0].id, 2);
});

test('the grouped branch only fires on a multi-day list', () => {
  // On /scores, which is one day by construction, a lone day header labels
  // what the date rail above it already says.
  const t = strip(src('components/gridiron/Scoreboard.js'));
  assert.match(t, /days\.length > 1 \?/, 'grouping is conditional on the list, not the surface');
});

// ---------------------------------------------------------------------------
// 4. NO ZONE IS HARDCODED IN THE CARD
// ---------------------------------------------------------------------------

test('THE CARD CARRIES NO "ET" LITERAL AND NO HARDCODED ZONE', () => {
  // It used to append ' ET' to a time formatted in America/New_York, which was
  // wrong for most readers and, being labelled, confidently wrong. Comments
  // stripped: this file explains the change and would otherwise trip on its
  // own prose.
  const t = strip(src('components/gridiron/Scoreboard.js'));
  assert.doesNotMatch(t, /America\/New_York/, 'no hardcoded zone in the card');
  assert.doesNotMatch(t, /['"` ]ET['"`]|\bET\b/, 'no ET literal in the card');
  assert.doesNotMatch(t, /new Intl\.DateTimeFormat/,
    'the card formats through lib/gridiron/kickoff, not inline');
});

test('THE ZONE RIDES A COOKIE, and the cold visit falls back to UTC unlabelled', () => {
  // THE SMALLER MECHANISM WAS TRIED AND MEASURED FAILING. Rendering UTC on the
  // server and correcting at hydration is fine for a time and NOT fine for a
  // day header: on a real /nfl render it wrote "Thursday · Sep 10" where the
  // reader's own screen says "Wednesday · Sep 9", because NE at SEA is 00:20Z.
  // A sticky header naming the wrong weekday, above the game it names, is not
  // something to fix after paint.
  const hook = strip(src('components/gridiron/useViewerTz.js'));
  assert.match(hook, /useSyncExternalStore\(subscribe, getSnapshot, \(\) => initial\)/,
    'the server snapshot is the cookie the page read');
  const pure = strip(src('lib/gridiron/viewerTz.js'));
  assert.match(pure, /tzOrUtc = \(tz\) => tz \?\? 'UTC'/, 'and UTC only when we know nothing');
  // Both surfaces read the cookie server-side and thread it in.
  for (const f of ['app/scores/page.js', 'components/gridiron/TodayPage.js']) {
    assert.match(strip(src(f)), /readViewerTz\(\)/, `${f} must read the cookie`);
    assert.match(strip(src(f)), /initialTz=\{viewerTz\}/, `${f} must thread it in`);
  }
  // And nothing anywhere appends a zone name to the rendered time - a label is
  // a claim the cold-visit fallback cannot support.
  assert.doesNotMatch(strip(src('lib/gridiron/kickoff.js')), /timeZoneName/);
});

test('THE COOKIE IS READER-CONTROLLED INPUT AND IS VALIDATED', () => {
  // The value goes straight to Intl.DateTimeFormat's timeZone option, which
  // THROWS on anything it does not recognise - so an edited cookie would take
  // out every card on the board rather than degrade one of them.
  assert.equal(safeTz('America/Denver'), 'America/Denver');
  assert.equal(safeTz('UTC'), 'UTC');
  assert.equal(safeTz('Not/AZone'), null);
  assert.equal(safeTz(''), null);
  assert.equal(safeTz(null), null);
  assert.equal(safeTz('a'.repeat(200)), null);
  assert.equal(safeTz('America/New_York; evil=1'), null);
  assert.match(strip(src('lib/gridiron/serverTz.js')), /safeTz\(/,
    'the server read must go through the validator');
});

// ---------------------------------------------------------------------------
// 5. THE EYEBROW IS TRUE IN BOTH STATES
// ---------------------------------------------------------------------------

test('a day-unit league says "Today" only when the screen IS one day', () => {
  assert.equal(leagueUnit('cfb'), 'day');
  // The clock is the 13th here, so the Sunday slate genuinely is today.
  const oneDay = [{ kickoffAt: SUNDAY }, { kickoffAt: '2026-09-13T20:25:00Z' }];
  assert.equal(moduleHeading('day', oneDay, ET, new Date('2026-09-13T15:00:00Z')), 'Today');
});

// The clock every heading test reads from, so none of them depend on the day
// they happen to be run. 6:00 PM in Los Angeles, 9:00 PM in New York, Sep 1.
const NOW = new Date('2026-09-02T01:00:00Z');
const at = (iso) => [{ kickoffAt: iso }];

test('THE FOUR HEADING STATES', () => {
  // ONE DAY ON SCREEN IS NOT THE SAME CLAIM AS "TODAY". The first fix made the
  // heading ask the games instead of the league, which stopped it calling four
  // days "Today" and left it free to call a single WRONG day "Today" - measured
  // on PROD, /cfb read "Today" over six cards dated Thu Sep 3, on Sep 1.
  assert.equal(moduleHeading('day', at('2026-09-01T23:00:00Z'), ET, NOW), 'Today');
  assert.equal(moduleHeading('day', at('2026-09-02T23:00:00Z'), ET, NOW), 'Tomorrow');
  assert.equal(moduleHeading('day', at('2026-09-03T23:00:00Z'), ET, NOW), 'Thursday · Sep 3');
  assert.equal(moduleHeading('day', [
    { kickoffAt: '2026-09-01T23:00:00Z' }, { kickoffAt: '2026-09-03T23:00:00Z' },
  ], ET, NOW), 'This week');
});

test('NEVER "Today" FOR A DAY THAT IS NOT TODAY', () => {
  // The claim stated as an absence, over a fortnight in both directions, so it
  // cannot be satisfied by an off-by-one that happens to look right nearby.
  for (let d = -14; d <= 14; d += 1) {
    const kick = new Date(NOW.getTime() + d * 86400000).toISOString();
    const h = moduleHeading('day', at(kick), ET, NOW);
    const isToday = dayOffset(dayKey(kick, ET), NOW, ET) === 0;
    assert.equal(h === 'Today', isToday, `offset ${d} gave ${h}`);
  }
});

test('THE LABEL FOLLOWS sv_tz, SAME AS THE DAY HEADERS', () => {
  // The boundary case, and it is not hypothetical: a late West-coast kickoff is
  // routinely tomorrow on the East coast. 11:30 PM Tuesday in Los Angeles is
  // 2:30 AM WEDNESDAY in New York, and at NOW (6pm PT / 9pm ET, still Tuesday
  // in both) the same instant is Today for one reader and Tomorrow for the
  // other. Counted in CALENDAR days in the reader's zone, never in elapsed
  // hours - the two disagree constantly and the reader always means the first.
  const kick = '2026-09-02T06:30:00Z';
  assert.equal(moduleHeading('day', at(kick), PT, NOW), 'Today');
  assert.equal(moduleHeading('day', at(kick), ET, NOW), 'Tomorrow');
  // And the day headers agree with the title, from the same function.
  assert.equal(dayHeading(kick, PT), 'Tuesday · Sep 1');
  assert.equal(dayHeading(kick, ET), 'Wednesday · Sep 2');
});

test('the heading takes the clock rather than reaching for one', () => {
  // leagueLanding has no clock of its own by the rule at the top of that file,
  // and a heading that read the machine's time could not be tested at any date
  // but the one it was written on.
  const t = strip(src('lib/gridiron/leagueLanding.js'));
  assert.match(t, /export function moduleHeading\(unit, games, tz = '[^']+', now = new Date\(\)\)/);
  assert.doesNotMatch(t.slice(t.indexOf('export function moduleHeading')), /Date\.now\(\)/);
  // And the module is handed the reader's zone and the page's clock.
  const ls = strip(src('components/league/LeagueScores.js'));
  assert.match(ls, /moduleHeading\(unit, shown, initialTz \?\? undefined, now\)/);
  assert.match(strip(src('components/gridiron/TodayPage.js')), /now=\{now\}/);
});

test('soleDayKey: one day, or nothing to name', () => {
  assert.equal(soleDayKey(at('2026-09-03T23:00:00Z'), ET), '2026-09-03');
  assert.equal(soleDayKey([
    { kickoffAt: '2026-09-01T23:00:00Z' }, { kickoffAt: '2026-09-03T23:00:00Z' },
  ], ET), null);
  // An undated game does not veto a day the rest agree on...
  assert.equal(soleDayKey([
    { kickoffAt: '2026-09-03T23:00:00Z' }, { kickoffAt: null },
  ], ET), '2026-09-03');
  // ...but a list with nothing dated has no day to name.
  assert.equal(soleDayKey([{ kickoffAt: null }], ET), null);
  assert.equal(soleDayKey([], ET), null);
});

test('AND DEGRADES TO "This week" THE MOMENT IT IS NOT', () => {
  // The shipped bug: CFB's unit is the day, the landing hands it the whole
  // week, so four days of football were titled "Today" every week.
  const week = [{ kickoffAt: NIGHT }, { kickoffAt: SUNDAY }];
  assert.equal(spansMultipleDays(week, ET), true);
  assert.equal(moduleHeading('day', week, ET, NOW), 'This week');
  // A week-unit league never says Today at all, whatever it is handed.
  assert.equal(moduleHeading('week', [{ kickoffAt: SUNDAY }], ET, NOW), 'This week');
  assert.equal(moduleHeading('week', [{ kickoffAt: '2026-09-01T23:00:00Z' }], ET, NOW), 'This week');
});

test('the module asks moduleHeading rather than the unit', () => {
  const t = strip(src('components/league/LeagueScores.js'));
  // The call gained the zone and the clock in the second pass; the claim here
  // is that the LEAGUE alone no longer decides it.
  assert.match(t, /moduleHeading\(unit, shown,/);
  assert.doesNotMatch(t, /unit === 'day' \? 'Today'/,
    'the heading must not be decided by the league alone again');
});

// ---------------------------------------------------------------------------
// 6. TBD IS GONE FROM THE BROADCAST SLOT
// ---------------------------------------------------------------------------

test('AN UNKNOWN NETWORK OMITS THE SEGMENT - it never prints TBD', () => {
  // DIAGNOSED FIRST: the string was never the provider's. 248 of 272 upcoming
  // NFL games carry a primary US broadcaster and NE at SEA has carried NBC the
  // whole time; the status line simply never read g.network while the card
  // foot always did. Dash law - absence is silence.
  const t = strip(src('components/gridiron/Scoreboard.js'));
  assert.doesNotMatch(t, /·\s*TBD/, 'no TBD in the broadcast slot');
  assert.doesNotMatch(t, /className="net">\s*·\s*TBD/, 'not in any form');
  assert.match(t, /\{g\.network \? <span className="net"> · \{g\.network\}<\/span> : null\}/,
    'the slot renders the network or nothing');
});

test('AND NO TEAM IS CALLED "TBD" EITHER - a failed join is an absence', () => {
  // RULED after the broadcast fix: the card carried two more TBDs, both
  // `t.name || 'TBD'`. That reads as "the opponent is undetermined" and fired
  // on something else entirely - a team row we did not manage to join. The
  // abbreviation is still an identity, so it is the fallback; with neither, the
  // slot is empty. A card that cannot name a side says so by saying nothing.
  //
  // A genuinely undetermined playoff opponent is a future problem with a
  // provider flag behind it, and will earn its own honest label rather than
  // inherit this one.
  const t = strip(src('components/gridiron/Scoreboard.js'));
  assert.doesNotMatch(t, /'TBD'/, 'no TBD literal anywhere in the card');
  assert.doesNotMatch(t, /TBD/, 'in any form');
  assert.match(t, /t\.name \|\| t\.label \|\| t\.abbreviation \|\| ''/,
    'the gridiron row falls back to the abbreviation, then to nothing');
  assert.match(t, /\{t\?\.name \?\? t\?\.abbreviation \?\? ''\}/,
    'and so does the soccer row');
});
