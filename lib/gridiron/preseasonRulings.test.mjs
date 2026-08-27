// lib/gridiron/preseasonRulings.test.mjs - preseason is VISIBLE but never
// mistaken for the real thing.
//
// Three surfaces, three different answers, and the differences are the ruling:
//
//   /scores        LISTS preseason, with a badge. Hiding it would be the wrong
//                  kind of honest - the games are on, people will look.
//   /nfl lede      IGNORES preseason. The countdown answers "when does football
//                  start", and football does not start with an exhibition in
//                  which the starters play a quarter.
//   Market Board   IGNORES preseason. A line on a game whose participants are
//                  decided by who is still on the roster on Tuesday is not a
//                  market read worth publishing.
//
// The queries need a database and the component needs a browser, so these are
// asserted on source - with the phase list imported, so a rename cannot leave
// the assertions passing against a string that no longer exists.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { COMPETITIVE_PHASES } from './ingest.js';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const src = (rel) => readFileSync(path.join(REPO, rel), 'utf8');
const stripComments = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

const readers = stripComments(src('lib/gridiron/readers.js'));
const oddsJoin = stripComments(src('lib/gridiron/oddsJoin.js'));
const board = stripComments(src('components/gridiron/Scoreboard.js'));
const css = src('components/gridiron/gridiron.css');

// ---------------------------------------------------------------------------
// The list itself
// ---------------------------------------------------------------------------

test('there is ONE competitive-phase list, and everything imports it', () => {
  // Three copies of a rule are three chances to update two of them.
  assert.deepEqual(COMPETITIVE_PHASES, ['REG', 'POST']);
  for (const [name, code] of [['readers', readers], ['oddsJoin', oddsJoin]]) {
    assert.match(code, /import \{[^}]*COMPETITIVE_PHASES[^}]*\} from '\.\/ingest\.js'/,
      `${name} must import the shared list, not restate it`);
    assert.ok(!/\['REG', ?'POST'\]/.test(code), `${name} must not keep its own copy`);
  }
});

// ---------------------------------------------------------------------------
// RULING 1 - /scores lists preseason, badged
// ---------------------------------------------------------------------------

test('RULING 1: the slate query is NOT phase-filtered - preseason is listed', () => {
  const slate = readers.slice(readers.indexOf('export async function getSlateByDate'), readers.indexOf('export function pickScoresDate'));
  assert.ok(!/season_phase = /.test(slate),
    '/scores must show preseason games; the badge is what distinguishes them');
  assert.match(slate, /m\.season_phase/, 'and must select the phase so the row can be badged');
});

test('RULING 1: the badge renders for PRE and for nothing else', () => {
  assert.match(board, /function PhaseBadge\(\{ phase \}\)/);
  assert.match(board, /if \(phase !== 'PRE'\) return null;/,
    'REG and POST rows are untouched - a badge on every row teaches the reader to stop seeing it');
  assert.match(board, /<PhaseBadge phase=\{g\.seasonPhase\} \/>/, 'and it is actually mounted');
  // Next to the status, not buried in the card foot: the foot already said
  // "PRE W1" and a preseason final still read as a real one.
  assert.match(board, /<Status g=\{g\} \/>\s*\n\s*<PhaseBadge/);
});

test('RULING 1: the badge is a muted outline, not another result chip', () => {
  // RULING 1 IS INTACT ACROSS THE v1.2 RESTYLE, and this test is the proof.
  // What the ruling protects is that PRE reads as a QUALIFIER: muted, outlined,
  // never filled. All three still hold. What moved is only the typeface and
  // where the outline colour comes from - PRE and LIVE now share one state-pill
  // skin, so the selector is a pair, and currentColor lets each state set its
  // own outline by setting its own text colour.
  //
  // The premise the old comment leaned on is gone too: the FINAL chip beside it
  // is no longer solid jade, so "a second solid chip" is no longer the risk.
  // The rule that PRE must not be filled outlives the reason it was written.
  const rule = css.slice(css.indexOf('.gi-phase-pre, .gi-livepill {'), css.indexOf('.gi-up {'));
  assert.ok(rule.length > 0, 'the shared state-pill rule exists');
  assert.match(rule, /font-family: var\(--font-saira-cond\)/, 'the v1.2 pill face');
  assert.match(rule, /color: var\(--muted\)/, 'muted, not paper');
  assert.match(rule, /border: 1px solid currentColor/, 'outlined');
  assert.match(rule, /border-radius: 99px/, 'and a pill, per the v1.2 grammar');
  assert.ok(!/background:/.test(rule), 'NOT filled - it qualifies a result, it is not one');
});

// ---------------------------------------------------------------------------
// RULING 2 - the Today lede holds on Week 1
// ---------------------------------------------------------------------------

test('RULING 2: the lede reader is REG-only', () => {
  const fn = readers.slice(
    readers.indexOf('export async function getNearestUpcomingWeek'),
    readers.indexOf('export async function getSeasonState'),
  );
  assert.match(fn, /AND m\.season_phase = 'REG'/,
    'the countdown must not repoint to a preseason opener');
  assert.match(fn, /m\.status = 'scheduled' AND m\.kickoff_at >= now\(\)/, 'otherwise unchanged');
});

test("RULING 2: the comment that PREDICTED the repoint is gone", () => {
  // The old comment treated the repoint as a feature - "a PRE-phase game
  // naturally sorts ahead of REG by date, no phase-priority logic needed". It
  // came true and it was wrong. A stale comment that argues FOR the behaviour
  // the code now prevents is worse than no comment.
  const raw = src('lib/gridiron/readers.js');
  assert.ok(!/naturally sorts ahead of REG by date/.test(raw), 'the prediction must not survive');
  assert.ok(!/no phase-priority logic needed/.test(raw));
  assert.match(raw, /REGULAR SEASON ONLY/, 'and the reason for the new behaviour is stated');
});

// ---------------------------------------------------------------------------
// RULING 3 - the market ignores preseason
// ---------------------------------------------------------------------------

test('RULING 3: all three odds paths are phase-gated', () => {
  for (const [name, code, anchor] of [
    ['getMarketMovers', readers, 'export async function getMarketMovers'],
    ['getUpsetWatch', readers, 'export async function getUpsetWatch'],
  ]) {
    const i = code.indexOf(anchor);
    assert.ok(i > -1, `${name} must exist`);
    const fn = code.slice(i, i + 1400);
    assert.match(fn, /season_phase = ANY\(\$\{COMPETITIVE_PHASES\}::text\[\]\)/, `${name} is gated`);
  }
  // oddsJoin gates at the point it decides which matches can receive an event
  // id - so a preseason game never acquires one in the first place.
  assert.match(oddsJoin, /AND season_phase = ANY\(\$\{COMPETITIVE_PHASES\}::text\[\]\)/,
    'oddsJoin candidate query is gated');
});

test('RULING 3: gating oddsJoin means preseason never even acquires an event id', () => {
  // Gating only the readers would leave odds rows accumulating against
  // preseason matches, invisible but real, and any future reader would surface
  // them. Cutting it at the join is what makes the absence structural.
  const fn = oddsJoin.slice(oddsJoin.indexOf('const matchRows = await sql`'), oddsJoin.indexOf('const byEventId'));
  assert.match(fn, /season_phase = ANY/);
  assert.match(fn, /status = 'scheduled'/, 'the freeze-at-kickoff rule is unchanged');
});

// ---------------------------------------------------------------------------
// The three answers really are different
// ---------------------------------------------------------------------------

test('preseason is VISIBLE on the scoreboard and INVISIBLE to the lede and the market', () => {
  // Stated as one assertion because the three rulings only make sense together:
  // the games are shown, and nothing that implies competitive meaning counts
  // them. If a future change makes all three agree, one of them is wrong.
  const slate = readers.slice(readers.indexOf('export async function getSlateByDate'), readers.indexOf('export function pickScoresDate'));
  const lede = readers.slice(readers.indexOf('export async function getNearestUpcomingWeek'), readers.indexOf('export async function getSeasonState'));
  const movers = readers.slice(readers.indexOf('export async function getMarketMovers'), readers.indexOf('export async function getUpsetWatch'));

  assert.ok(!/season_phase = /.test(slate), 'scoreboard: shows everything');
  assert.match(lede, /season_phase = 'REG'/, 'lede: REG only');
  assert.match(movers, /season_phase = ANY/, 'market: competitive only');
});

// ---------------------------------------------------------------------------
// THE SPORTS-DAY LAW at the poller (the 23 Aug mid-game freeze)
// ---------------------------------------------------------------------------

const { pollSlateDatesEt, hourEt } = await import('../pollers/preseasonWindow.js');

test('before 06:00 ET the poller carries the prior date; after, it drops', () => {
  // 00:13 ET Sun (04:13Z EDT) - the DAL@ARI freeze minute
  assert.deepEqual(pollSlateDatesEt(new Date('2026-08-23T04:13:00Z')), ['2026-08-22', '2026-08-23']);
  // 5:59 AM ET still carries both
  assert.deepEqual(pollSlateDatesEt(new Date('2026-08-23T09:59:00Z')), ['2026-08-22', '2026-08-23']);
  // 6:00 AM ET drops the prior day - a 6h-old 'live' is a stuck feed and
  // isGameHot's bound owns that refusal
  assert.deepEqual(pollSlateDatesEt(new Date('2026-08-23T10:00:00Z')), ['2026-08-23']);
});

test('hourEt is DST-aware', () => {
  assert.equal(hourEt(new Date('2026-08-23T04:13:00Z')), 0);   // EDT
  assert.equal(hourEt(new Date('2026-12-23T05:13:00Z')), 0);   // EST
});
