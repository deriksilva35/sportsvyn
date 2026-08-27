// lib/today/weekSlate.test.mjs - the week module: window, order, states.
//
// The live row is SYNTHETIC and labelled as such: nothing is live in the
// schedule right now, and a test that waits for a real kickoff is not a test.
// The row state is pure, so a synthetic row exercises exactly the code a real
// one would.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { rowState, orderSlate, SLATE_ROW_CAP, kickoffDay } from './slateRow.js';
import { rankLeagues } from './leagues.js';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const src = (rel) => readFileSync(path.join(REPO, rel), 'utf8');
const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
  .replace(/\{\/\*[\s\S]*?\*\/\}/g, '');

const game = (o = {}) => ({
  id: 1, slug: 'g', status: 'scheduled', kickoffAt: '2026-08-29T16:00:00Z',
  homeScore: null, awayScore: null, seasonPhase: 'REG', week: 1,
  leagueSlug: 'cfb', home: { abbreviation: 'TCU' }, away: { abbreviation: 'UNC' }, ...o,
});

test('A SYNTHETIC LIVE ROW gets the live treatment', () => {
  // Synthetic on purpose - see the header.
  const s = rowState(game({ status: 'live', awayScore: 14, homeScore: 10 }));
  assert.equal(s.live, true);
  assert.equal(s.final, false);
  assert.equal(s.played, true, 'a score is a fact once the game is on');
  assert.equal(s.when, 'LIVE', 'the WHEN column carries one fact at a time');
  assert.equal(s.homeWin, false, 'nobody has won a game that is still being played');
  assert.equal(s.awayWin, false);
});

test('an UNCOVERED game shows scheduled, never a fake live treatment', () => {
  const s = rowState(game());
  assert.equal(s.live, false);
  assert.equal(s.played, false);
  assert.match(s.when, /^\d{1,2}:\d{2}(am|pm)$/, 'a kickoff time, not LIVE');
  // And no score is printed for a game that has not kicked off.
  assert.equal(s.homeWin, false);
});

test('a FINAL carries its score and its winner', () => {
  const s = rowState(game({ status: 'final', awayScore: 27, homeScore: 20 }));
  assert.equal(s.when, 'FINAL', 'a time next to a finished game is noise');
  assert.equal(s.awayWin, true);
  assert.equal(s.homeWin, false);
  assert.equal(s.played, true);
});

test('PRE IS LABELLED, and labelling it is not the same as ranking it', () => {
  assert.equal(rowState(game({ seasonPhase: 'PRE' })).isPreseason, true);
  assert.equal(rowState(game({ seasonPhase: 'REG' })).isPreseason, false);
  // The row renders the badge...
  assert.match(strip(src('components/today/WeekSlate.js')), /isPreseason \? 'PRE · ' : ''/);
  // ...and the RANKER still cannot see preseason at all, so an exhibition
  // never moves the band order. The two rules coexist: visibility here,
  // exclusion there.
  assert.match(src('lib/today/signals.js'), /m\.season_phase IS DISTINCT FROM 'PRE'/);
  const sig = (id, o) => ({ id, playsToday: false, daysToNext: null, inSeason: true, inWeekSpan: false, ...o });
  const before = rankLeagues([sig('cfb', { daysToNext: 2 }), sig('nfl', { daysToNext: 13 }), sig('epl', { daysToNext: 1 })]);
  assert.deepEqual(before, ['cfb', 'nfl', 'epl'], 'NFL stays 13 days out on its REG opener');
});

test('ORDER: live first, then upcoming by kickoff, then finals', () => {
  const rows = [
    game({ id: 1, status: 'final', kickoffAt: '2026-08-29T16:00:00Z' }),
    game({ id: 2, status: 'scheduled', kickoffAt: '2026-08-29T23:00:00Z' }),
    game({ id: 3, status: 'live', kickoffAt: '2026-08-29T20:00:00Z' }),
    game({ id: 4, status: 'scheduled', kickoffAt: '2026-08-29T19:00:00Z' }),
    game({ id: 5, status: 'final', kickoffAt: '2026-08-29T12:00:00Z' }),
  ];
  assert.deepEqual(orderSlate(rows).map((g) => g.id), [3, 4, 2, 1, 5]);
  // Finals read newest-first; sorting everything by kickoff would bury a live
  // game under a morning of completed ones.
});

test('THE CAP is six, and the overflow is counted rather than dropped silently', () => {
  assert.equal(SLATE_ROW_CAP, 6);
  const c = strip(src('components/today/WeekSlate.js'));
  assert.match(c, /ordered\.slice\(0, SLATE_ROW_CAP\)/);
  assert.match(c, /const hidden = ordered\.length - shown\.length;/);
  assert.match(c, /Full scoreboard · \$\{hidden\} more/);
});

test('THE WINDOW IS A WEEK GROUP, never a calendar week', () => {
  const w = strip(src('lib/today/weekSlate.js'));
  // In progress, else next to start, else last played.
  assert.match(w, /WHEN lo <= \$\{iso\} AND hi >= \$\{iso\} THEN 0/);
  assert.match(w, /WHEN lo > \$\{iso\}\s+THEN 1/);
  assert.match(w, /GROUP BY m\.season_year, m\.season_phase, m\.week/);
  // IS NOT DISTINCT FROM: EPL carries a NULL phase throughout, and `=` on NULL
  // matches nothing - the whole league would return no games.
  assert.match(w, /m\.season_phase IS NOT DISTINCT FROM c\.season_phase/);
  assert.doesNotMatch(w, /interval '7 days'/, 'a week is not seven days from today');
});

test('ONE LIVE DECISION-MAKER, not two renderers', () => {
  // TodaysGames and WeekSlate present differently but must agree about what
  // "live" is. Both read rowState().
  assert.match(src('components/home/TodaysGames.js'), /import \{ rowState \} from '@\/lib\/today\/slateRow'/);
  assert.match(src('components/today/WeekSlate.js'), /import \{ rowState, orderSlate, SLATE_ROW_CAP \}/);
  // NEITHER MAY RE-DERIVE THE ROW STATE. Scoped to the render path on purpose:
  // TodaysGames still has its own `status === 'live'` in a SORT, and that stays.
  // Its ordering rule is deliberately different from the band's - "live first,
  // then the SQL order within each league" - and consolidating the two sorts
  // would change a shipped component's behaviour two days before the first live
  // weekend. The duplication that actually bites is two answers to "is this game
  // live and what does the row say", and there is now one.
  for (const f of ['components/home/TodaysGames.js', 'components/today/WeekSlate.js']) {
    const body = strip(src(f));
    const render = body.slice(0, body.indexOf('export default'));
    assert.doesNotMatch(render, /status === 'live'/, `${f}: the ROW must not re-decide live`);
  }
});

test('THE WEEK SLATE IS FIRST IN EVERY LEAGUE BAND', () => {
  const b = strip(src('components/today/LeagueBands.js'));
  const grid = b.slice(b.indexOf('export function GridironBand'), b.indexOf('export function EplBand'));
  const epl = b.slice(b.indexOf('export function EplBand'));
  for (const [name, seg] of [['gridiron', grid], ['epl', epl]]) {
    const slate = seg.indexOf('<WeekSlate');
    const firstMod = seg.indexOf('<Mod ');
    assert.ok(slate > -1, `${name} must render the week slate`);
    assert.ok(firstMod === -1 || slate < firstMod, `${name}: the slate must lead the band`);
  }
});

test('EPL has ONE module, not Results-plus-fixtures siblings', () => {
  const b = strip(src('components/today/LeagueBands.js'));
  const epl = b.slice(b.indexOf('export function EplBand'), b.indexOf('export function ArchiveBand'));
  assert.doesNotMatch(epl, /Results \+ fixtures/, 'that module became the week slate');
  assert.equal((epl.match(/<WeekSlate/g) ?? []).length, 1);
});

test('THE BOARD KEYS ON match_id - the badge that never rendered', () => {
  // currentPickemBoard().board entries carry match_id, not id. Mapping g.id
  // built a Set of one undefined, so the CFB module claimed "Board 1 marked"
  // over six unbadged rows. Invisible until the slate had games in it.
  const page = src('app/page.js');
  assert.match(page, /\.map\(\(g\) => g\.match_id \?\? g\.id\)/);
  assert.match(page, /\.filter\(\(v\) => v != null\)/);
});

test('the live dot rides the signal query, and only fires when a game is on', () => {
  const s = src('lib/today/signals.js');
  assert.match(s, /bool_or\(m\.status = 'live'\) AS is_live/);
  assert.match(s, /isLive: !!r\?\.is_live/);
  // Rendered only on a live league, never inferred from a kickoff time.
  assert.match(strip(src('components/today/LeagueChips.js')), /l\.live \? <span className="chipdot"/);
});

test('a game with NO kickoff renders TBD instead of throwing', () => {
  // matches.kickoff_at is nullable, and Intl throws on an invalid date - which
  // came out of rowState as "Invalid time value" and would have taken down the
  // whole band rather than one row of it.
  const s = rowState({ status: 'scheduled', kickoffAt: null });
  assert.equal(s.when, 'TBD');
  assert.equal(s.day, null);
  assert.doesNotThrow(() => rowState({ status: 'final', awayScore: 21, homeScore: 3 }));
});

test('the day column is ET, like every sports day in this codebase', () => {
  assert.equal(kickoffDay('2026-08-29T16:00:00Z'), 'Sat');
  // 00:30 UTC Sunday is still Saturday night in ET - the boundary that puts a
  // late kickoff under the wrong heading if measured in UTC or PT.
  assert.equal(kickoffDay('2026-08-30T00:30:00Z'), 'Sat');
});
