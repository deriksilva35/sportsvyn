// lib/admin/gate.test.mjs - THE ACCESS GATE AND THE READ-ONLY LAW.
//
// This is the file that has to be right. The console shows every user's email
// and every game they have played; the gate is the only thing between that and
// any signed-in stranger. So the gate is pinned by VALUE (who passes) and the
// route is pinned by SHAPE (404, never 403, and never a SELECT that isn't).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { isAdminUser, ADMIN_USER_IDS } from './gate.js';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const src = (rel) => readFileSync(path.join(REPO, rel), 'utf8');

const PAGE = src('app/admin/console/page.js');
const READS = src('lib/admin/reads.js');

// Comments in these files discuss 403s, writes, and tracking in order to
// forbid them. A grep over the raw text would match the prose that bans the
// thing and call it the thing - the prose-grep trap. Strip comments first.
function code(text) {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
    .replace(/^\s*\/\/.*$/gm, '');
}
const PAGE_CODE = code(PAGE);
const READS_CODE = code(READS);

// ---------------------------------------------------------------- the gate

test('exactly one account passes the gate, and it is user 1', () => {
  assert.deepEqual([...ADMIN_USER_IDS], [1]);
  assert.equal(isAdminUser(1), true);
  assert.equal(isAdminUser('1'), true, 'the session carries the id as a string');
});

test('every other signed-in user is refused', () => {
  for (const id of [2, 3, 74, 133, 1000, '2', '74']) {
    assert.equal(isAdminUser(id), false, `user ${id} must not pass`);
  }
});

test('signed-out is refused, and no falsy value coerces its way in', () => {
  // Number(null) === 0 and Number('') === 0 and Number([]) === 0. If the gate
  // ever coerced first and compared second, an id of 0 in ADMIN_USER_IDS would
  // admit every signed-out visitor. Pin the whole family.
  for (const v of [null, undefined, '', 0, '0', NaN, false, [], {}, '1abc', '1.5', 1.5, Infinity]) {
    assert.equal(isAdminUser(v), false, `${JSON.stringify(String(v))} must not pass`);
  }
  assert.equal(isAdminUser([1]), false, 'an array must not coerce to its single element');
});

test('the gate is a literal, not an environment variable', () => {
  // An env-var gate can be widened from a dashboard with no review, and an
  // unset one fails open in the worst case. Widening this must cost a commit.
  const gate = code(src('lib/admin/gate.js'));
  assert.match(gate, /ADMIN_USER_IDS\s*=\s*Object\.freeze\(\[\s*1\s*\]\)/);
  assert.doesNotMatch(gate, /process\.env/, 'the admin id must not come from the environment');
});

// ---------------------------------------------------------------- the route

test('the page refuses with notFound(), and 403 appears nowhere in its code', () => {
  assert.match(PAGE_CODE, /import \{ notFound \} from 'next\/navigation'/);
  assert.match(
    PAGE_CODE,
    /if \(!isAdminUser\(session\?\.user\?\.id\)\) notFound\(\);/,
    'the gate must be the first thing after auth(), and must 404',
  );
  assert.doesNotMatch(PAGE_CODE, /403|forbidden|Access denied/i);
  // Not a redirect to sign-in either: "sign in to see this" confirms the page.
  assert.doesNotMatch(PAGE_CODE, /redirect\(/);
});

test('the gate runs before any read - a refused visitor costs zero queries', () => {
  const gateAt = PAGE_CODE.indexOf('notFound()');
  const firstRead = PAGE_CODE.indexOf('overviewStats()');
  assert.ok(gateAt > 0 && firstRead > 0);
  assert.ok(gateAt < firstRead, 'notFound() must precede the first reader call');
});

test('the game filter is whitelisted, so ?game= cannot reach SQL as free text', () => {
  assert.match(PAGE_CODE, /GAME_FILTERS\.includes\(rawGame\) \? rawGame : 'all'/);
  assert.match(READS_CODE, /GAME_FILTERS\.includes\(game\) \? game : 'all'/);
});

// ------------------------------------------------------- no writes, no tracking

test('every query in the readers is a SELECT - nothing writes', () => {
  const forbidden = /\b(INSERT\s+INTO|UPDATE\s+\w+\s+SET|DELETE\s+FROM|CREATE\s+TABLE|ALTER\s+TABLE|DROP\s+|TRUNCATE|UPSERT|ON\s+CONFLICT)\b/i;
  assert.doesNotMatch(READS_CODE, forbidden, 'lib/admin/reads.js must be read-only');
  assert.doesNotMatch(PAGE_CODE, forbidden, 'the page must not carry SQL of its own');
});

test('the console adds no tracking table', () => {
  // The relay's hard line: phase 1 observes, it does not record. Loading the
  // page must leave the database exactly as it found it.
  //
  // NOT a text grep over the page - the coming-soon panel says the words
  // "identified-pageview log" in order to say it DOESN'T exist, and a grep
  // would read that promise-of-absence as the thing itself. Assert on the
  // readers, which are the only place a table name can actually be used.
  assert.doesNotMatch(READS_CODE, /page_views|admin_audit|pageview|track\(/i);
  assert.doesNotMatch(PAGE_CODE, /sql`/, 'the page must hold no SQL of its own');
});

test('every table the console reads already existed - none were added for it', () => {
  // The real proof that "no new tables" holds: name each table the readers
  // touch, and find it created in a migration that predates this build.
  const tables = new Set(
    [...READS_CODE.matchAll(/\b(?:FROM|JOIN)\s+([a-z_][a-z0-9_]*)/gi)]
      .map((m) => m[1].toLowerCase())
      // Subquery aliases and inline set-returning functions, not tables.
      .filter((t) => !['jsonb_each_text', 'jsonb_object_keys', 'x', 'a', 'f'].includes(t)),
  );
  assert.ok(tables.size >= 7, `expected the cross-game read to touch several tables, saw ${tables.size}`);

  const dir = path.join(REPO, 'migrations');
  const all = readdirSync(dir)
    .filter((f) => f.endsWith('.sql'))
    .map((f) => readFileSync(path.join(dir, f), 'utf8'))
    .join('\n');
  for (const t of tables) {
    assert.match(
      all,
      new RegExp(`CREATE TABLE (?:IF NOT EXISTS )?(?:public\\.)?${t}\\b`, 'i'),
      `${t} must be created by an existing migration, not invented here`,
    );
  }
});


test('the page issues no mutations - no server action, no form POST', () => {
  assert.doesNotMatch(PAGE_CODE, /'use server'|"use server"/);
  assert.doesNotMatch(PAGE_CODE, /method="post"/i);
  assert.match(PAGE_CODE, /method="get"/, 'the lookup form must be a GET');
});

// ------------------------------------------------------------- revealed-only

test('an unrevealed daily score never reaches the panel', () => {
  // The same law the public boards obey. An admin reading tomorrow's answers
  // out of the console would be the leak the revealed-only rule exists to stop.
  const feed = READS_CODE.slice(
    READS_CODE.indexOf('export async function recentActivity'),
    READS_CODE.indexOf('export const GAME_FILTERS'),
  );
  assert.match(feed, /CASE WHEN p\.revealed THEN e\.score::text ELSE NULL END/);

  const activity = READS_CODE.slice(
    READS_CODE.indexOf('export async function gamesActivity'),
    READS_CODE.indexOf('export async function handleFor'),
  );
  assert.match(activity, /CASE WHEN p\.revealed THEN to_char\(e\.score/);
});

test('the search needs two characters, so an empty box lists nobody', () => {
  assert.match(READS_CODE, /if \(term\.length < 2\) return \[\]/);
});

// ------------------------------------------------------- honest empty states

test('empty panels render an empty STATE, not a hidden panel', () => {
  // GATED = ABSENT, EMPTY = HONEST EMPTY STATE. Pick'em has no entries until
  // board 1 opens; the table must say so rather than disappear and imply the
  // filter is broken.
  assert.match(PAGE_CODE, /No activity recorded yet\./);
  assert.match(PAGE_CODE, /activity yet\./);
  assert.match(PAGE_CODE, /No user matches/);
});

test('page views is drawn as coming-soon, and claims no data it does not have', () => {
  assert.match(PAGE_CODE, /Not built yet/);
  assert.match(PAGE_CODE, /Retention policy: undecided/);
});

test('the unbuilt rail items are dead, not links that would 404', () => {
  assert.match(PAGE_CODE, /const NAV_OFF = \['Leagues', 'Push & Email'\]/);
  assert.match(PAGE_CODE, /className="navoff" aria-disabled="true"/);
});

// ---------------------------------------------------------------- one source

test('rounds come from the config roster slots, not a column that does not exist', () => {
  // drafts has no `rounds`; the room derives it from draft_configs.roster_slots.
  // A second derivation here would let the panel disagree with the room.
  assert.match(READS_CODE, /jsonb_each_text\(cf\.roster_slots\)/);
  assert.doesNotMatch(READS_CODE, /d\.rounds/);
});

test('active-today and last-active read the same three tables', () => {
  const three = ['puzzle_entries', 'drafts', 'contest_entries'];
  const active = READS_CODE.slice(
    READS_CODE.indexOf('export async function activeToday'),
    READS_CODE.indexOf('export async function overviewStats'),
  );
  for (const t of three) assert.match(active, new RegExp(`FROM ${t}`));

  const detail = READS_CODE.slice(READS_CODE.indexOf('export async function userDetail'));
  const lastSeen = detail.slice(detail.indexOf('SELECT max(at) AS at FROM ('));
  for (const t of three) {
    assert.match(lastSeen, new RegExp(t), `last-active must read ${t} too`);
  }
});
