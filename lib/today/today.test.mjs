// lib/today/today.test.mjs - the Today page's band order and its store.
//
// The ranker is pure, so it is tested with signals rather than a database -
// the split exists for exactly this. The four cases below are the ruled ones,
// and the offseason case is the pin that stops the tier rule rotting into
// "gridiron always first".

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  LEAGUES, LEAGUE_IDS, DEFAULT_TODAY_LEAGUES, TIER, GAME_WEEK_LEAD_DAYS,
  rankLeagues, inGameWeek, tierPreferenceActive, contextLine, daysBetween, isLeagueId,
} from './leagues.js';
import { SCOPES, vocabularyFor } from '../scopeVocabulary.js';
import { isActive } from './modes.js';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const src = (rel) => readFileSync(path.join(REPO, rel), 'utf8');

const sig = (id, o = {}) => ({
  id, playsToday: false, daysToNext: null, inSeason: true, inWeekSpan: false, ...o,
});

// The real signals gatherSignals returns on these dates, against PROD data.
const AUG26 = [sig('cfb', { daysToNext: 3 }), sig('nfl', { daysToNext: 14 }),
               sig('epl', { daysToNext: 2 }), sig('wc', { daysToNext: null, inSeason: false })];
const AUG29 = [sig('cfb', { playsToday: true, daysToNext: 0, inWeekSpan: true }),
               sig('nfl', { daysToNext: 11 }),
               sig('epl', { playsToday: true, daysToNext: 1, inWeekSpan: true }),
               sig('wc', { inSeason: false })];
const SEP09 = [sig('cfb', { daysToNext: 1 }), sig('nfl', { playsToday: true, daysToNext: 0 }),
               sig('epl', { daysToNext: 3 }), sig('wc', { inSeason: false })];
const OFFSEASON = [sig('cfb', { daysToNext: 120 }), sig('nfl', { daysToNext: 150 }),
                   sig('epl', { daysToNext: 2, inWeekSpan: true }), sig('wc', { inSeason: false })];

test('RANKED CASE: Aug 26 - both tiers in game week, gridiron first', () => {
  // Nobody plays today, so the tier rule applies to everyone. CFB over NFL on
  // proximity: a REG game 3 days out against one 14 days out.
  assert.deepEqual(rankLeagues(AUG26), ['cfb', 'nfl', 'epl', 'wc']);
});

test('RANKED CASE: Aug 29 - playing today outranks the tier', () => {
  // THE CASE THAT FIXES THE STRUCTURE. CFB and EPL are both on; the NFL is
  // eleven days out. If the tier rule sat above playsToday this would come out
  // cfb > nfl > epl and a dormant NFL would have been lifted over a league
  // that is playing right now.
  assert.deepEqual(rankLeagues(AUG29), ['cfb', 'epl', 'nfl', 'wc']);
});

test('RANKED CASE: Sep 9 - NFL first on its opener', () => {
  assert.deepEqual(rankLeagues(SEP09), ['nfl', 'cfb', 'epl', 'wc']);
});

test('OFFSEASON PIN: a dormant gridiron never outranks in-season soccer', () => {
  // Clause 2. Without this the tier rule is just "gridiron always first", and
  // it would be wrong every June.
  assert.equal(tierPreferenceActive(OFFSEASON), false);
  assert.deepEqual(rankLeagues(OFFSEASON), ['epl', 'cfb', 'nfl', 'wc']);
});

test('the archive is pinned last however it is signalled', () => {
  // "The World Cup played today" cannot become true again.
  const loud = [sig('wc', { playsToday: true, daysToNext: 0, inWeekSpan: true }),
                sig('epl', { daysToNext: 40 })];
  assert.deepEqual(rankLeagues(loud), ['epl', 'wc']);
});

test('inGameWeek: the span AND the approach both count', () => {
  assert.equal(inGameWeek(sig('cfb', { playsToday: true })), true);
  // The span clause - CFB week 1 runs Aug 29 to Sep 7, so mid-week with the
  // next game days off is still the game week.
  assert.equal(inGameWeek(sig('cfb', { inWeekSpan: true, daysToNext: 5 })), true);
  // The approach clause - the mock says "Game week" on a Wednesday for a
  // Saturday kickoff.
  assert.equal(inGameWeek(sig('cfb', { daysToNext: GAME_WEEK_LEAD_DAYS })), true);
  assert.equal(inGameWeek(sig('cfb', { daysToNext: GAME_WEEK_LEAD_DAYS + 1 })), false);
  assert.equal(inGameWeek(sig('nfl', { daysToNext: null })), false);
});

test('tier membership is declared, and the archive is excluded from the test', () => {
  assert.equal(LEAGUES.find((l) => l.id === 'cfb').tier, TIER.GRIDIRON);
  assert.equal(LEAGUES.find((l) => l.id === 'nfl').tier, TIER.GRIDIRON);
  assert.equal(LEAGUES.find((l) => l.id === 'epl').tier, TIER.SOCCER);
  // A loud archive must not switch the tier rule on by itself.
  assert.equal(tierPreferenceActive([sig('cfb', { daysToNext: 1 }),
                                     sig('wc', { playsToday: true })]), false);
});

test('the order is STABLE when every signal ties', () => {
  const tie = LEAGUE_IDS.map((id) => sig(id, { daysToNext: 5 }));
  assert.deepEqual(rankLeagues(tie), rankLeagues([...tie].reverse()));
});

test('CONTEXT LINES are derived, never copy', () => {
  assert.equal(contextLine({ playsToday: true }), 'Game week · playing today');
  assert.equal(contextLine({ daysToNext: 1 }), 'Tomorrow');
  assert.equal(contextLine({ daysToNext: 3 }), '3 days out · game week');
  assert.equal(contextLine({ daysToNext: 14 }), '14 days out');
  assert.equal(contextLine({ daysToNext: null }), 'No scheduled games');
  // And the band head takes its week from the schedule, not from the mock's
  // "Week 0" - which the data says is week 1.
  assert.match(src('app/page.js'), /week=\{\(isCfb \? cfbNext : nflNext\)\?\.week \?\? null\}/);
  // COMMENTS STRIPPED: Band.js quotes the mock's "Week 0" in order to say it is
  // wrong, and a raw scan reads that explanation as the offence. Third time
  // this trap has fired in this codebase; it is always the same shape.
  const band = src('components/today/Band.js')
    .replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  assert.doesNotMatch(band, /Week 0/);
});

test('PRESEASON does not order the page', () => {
  const s = src('lib/today/signals.js');
  assert.match(s, /m\.season_phase IS DISTINCT FROM 'PRE'/);
  // IS DISTINCT FROM, not <>: EPL rows carry NULL and `<> 'PRE'` is NULL for
  // them, which would drop every soccer fixture.
  assert.doesNotMatch(s, /season_phase <> 'PRE'/);
});

// ------------------------------------------------------ the store

test("'my' SCOPE RESOLUTION IS UNCHANGED - the pin", () => {
  const my = vocabularyFor('my');
  // Exactly the two checks the code performed before scopes had vocabularies.
  assert.equal(my.isValidRead('today'), true);
  assert.equal(my.isValidRead('cfb'), false, 'a league id is not a panel');
  assert.equal(my.isValidWrite('today', { bindings: { today: 1 } }), true);
  assert.equal(my.isValidWrite('form', { bindings: {} }), false, 'unbound panels stay rejected');
  assert.deepEqual(my.defaults().map((e) => e.id),
    ['today', 'schedule', 'groups', 'mentioned', 'live']);
});

test("'today' scope speaks leagues, and drops ids that stop meaning anything", () => {
  const t = vocabularyFor('today');
  for (const id of LEAGUE_IDS) assert.equal(t.isValidRead(id), true, id);
  for (const junk of ['mlb', 'today', '', null, 42]) assert.equal(t.isValidRead(junk), false, String(junk));
  assert.deepEqual(t.defaults().map((e) => e.id), ['cfb', 'nfl', 'epl']);
  // The archive is a VALID id even though it is off by default - a reader who
  // turns it on has that stored.
  assert.equal(t.isValidRead('wc'), true);
  assert.ok(!DEFAULT_TODAY_LEAGUES.includes('wc'));
});

test('BOTH the resolver and the sanitizer use the vocabulary', () => {
  // Teaching only the read half is a bug that reads as "chips do not persist":
  // saveUserLayout would sanitize {id:'cfb'} against PANELS, keep nothing, and
  // return empty_layout.
  assert.match(src('lib/dashboardLayout.js'), /vocab\.isValidRead\(p\.id\)/);
  const act = src('app/actions/dashboard.js');
  assert.match(act, /vocab\.isValidWrite\(id, \{ bindings: PANEL_BINDINGS \}\)/);
  // And the scope is resolved BEFORE the loop - it used to be checked after,
  // which would sanitize against the wrong dictionary first.
  assert.ok(act.indexOf('const vocab = vocabularyFor(scope)') < act.indexOf('for (const entry of layout)'));
});

test('an unknown scope resolves to nothing rather than guessing', () => {
  assert.equal(vocabularyFor('nonsense'), null);
  assert.ok(!('nonsense' in SCOPES));
});

// ------------------------------------------------------ chrome

test('the switcher is two ROUTES, and lights the one you are on', () => {
  assert.equal(isActive('/', '/'), true);
  assert.equal(isActive('/', '/my'), false, '/my must not light Today');
  assert.equal(isActive('/my', '/my'), true);
  assert.equal(isActive('/my', '/my/anything'), true);
  const sw = src('components/today/ModeSwitch.js');
  // Anchors, not buttons: both modes stay shareable and bookmarkable, and /my
  // keeps its own auth redirect and noindex.
  assert.match(sw, /<a key=\{m\.href\} href=\{m\.href\}/);
  assert.doesNotMatch(sw, /router\.(push|replace)/);
  // It sits on BOTH surfaces.
  assert.match(src('app/page.js'), /<ModeSwitch \/>/);
  assert.match(src('app/my/page.js'), /<ModeSwitch \/>/);
});

test('the nav no longer carries a second way into My Sportsvyn', () => {
  const nav = src('lib/nav.js').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  assert.doesNotMatch(nav, /label: 'My Sportsvyn'/);
  assert.match(nav, /label: 'Account'/, 'the rest of the account menu is untouched');
});

test('the games band and the readband never filter', () => {
  const page = src('app/page.js');
  const chips = page.indexOf('<LeagueChips');
  const games = page.indexOf('<GamesBand');
  const readband = page.indexOf('className="readband"');
  assert.ok(readband > chips && games > chips, 'both sit below the tuner');
  // Neither is wrapped in a data-band, which is what the chips toggle.
  assert.doesNotMatch(page, /data-band="games"/);
  assert.match(page, /\{order\.map\(\(id\) => bandFor\(id\)\)\}/, 'only league bands are ordered');
});

test('the Pick\'em card shows real state, and a DERIVED lock label', () => {
  const gb = src('components/today/GamesBand.js');
  assert.match(gb, /\$\{pickem\.picked\}\/\$\{pickem\.total\} picked/);
  assert.match(gb, /lockLabel\(pickem\.nextKickoff\)/);
  // A typed weekday here would be the Week 0 defect again.
  assert.doesNotMatch(gb.replace(/\/\/.*$/gm, ''), /Saturday|Sat,|noon ET'/);
});

test('the archive band is OFF by default and the chips carry the default set', () => {
  assert.deepEqual([...DEFAULT_TODAY_LEAGUES], ['cfb', 'nfl', 'epl']);
  assert.equal(isLeagueId('wc'), true);
  assert.equal(LEAGUES.find((l) => l.id === 'wc').defaultOn, false);
});

test('daysBetween floors at zero and refuses junk', () => {
  assert.equal(daysBetween('2026-08-26', '2026-08-29T16:00:00Z'), 3);
  assert.equal(daysBetween('2026-08-26', '2026-08-20T16:00:00Z'), 0, 'never negative');
  assert.equal(daysBetween(null, '2026-08-29T16:00:00Z'), null);
  assert.equal(daysBetween('2026-08-26', null), null);
});
