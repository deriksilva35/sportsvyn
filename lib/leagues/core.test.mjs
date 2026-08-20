// lib/leagues/core.test.mjs - codes, membership writes, and the scoped board.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
(function loadEnv(p) {
  let t; try { t = readFileSync(p, 'utf8'); } catch { return; }
  for (const line of t.split('\n')) {
    const s = line.trim(); if (!s || s.startsWith('#')) continue;
    const eq = s.indexOf('='); if (eq < 0) continue;
    const k = s.slice(0, eq).trim(); let v = s.slice(eq + 1).trim();
    if (v.startsWith('"') && v.endsWith('"')) v = v.slice(1, -1);
    if (!process.env[k]) process.env[k] = v;
  }
})(path.resolve(__dirname, '..', '..', '.env.local'));

const { CODE_ALPHABET, CODE_LENGTH, makeJoinCode, validateLeagueName } = await import('./core.js');

const REPO = path.resolve(__dirname, '..', '..');
const src = (rel) => readFileSync(path.join(REPO, rel), 'utf8');
const stripComments = (s) =>
  s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

// ---------------------------------------------------------------------------
// join codes
// ---------------------------------------------------------------------------

test('the alphabet carries no lookalikes - codes get read aloud off phones', () => {
  for (const bad of ['0', 'O', '1', 'I', 'L']) {
    assert.ok(!CODE_ALPHABET.includes(bad), `${bad} in the alphabet`);
  }
  assert.ok(CODE_ALPHABET.length >= 28, 'enough symbols for the keyspace math');
});

test('codes are six chars, alphabet-only, and rng-driven', () => {
  for (let i = 0; i < 50; i += 1) {
    const c = makeJoinCode();
    assert.equal(c.length, CODE_LENGTH);
    for (const ch of c) assert.ok(CODE_ALPHABET.includes(ch), c);
  }
  // deterministic rng -> deterministic code (the seam the retry loop uses)
  assert.equal(makeJoinCode(() => 0), CODE_ALPHABET[0].repeat(CODE_LENGTH));
});

test('creation retries the code on UNIQUE collision, and only on that', () => {
  const t = stripComments(src('lib/leagues/core.js'));
  assert.match(t, /for \(let attempt = 0; attempt < 5/);
  assert.match(t, /player_leagues_join_code_key/, 'the retry keys on the constraint name');
  assert.match(t, /throw e/, 'every other failure surfaces');
});

// ---------------------------------------------------------------------------
// names
// ---------------------------------------------------------------------------

test('league names: trimmed, squashed, bounded', () => {
  assert.equal(validateLeagueName('  The   Boys  ').name, 'The Boys');
  assert.equal(validateLeagueName('ab').ok, false);
  assert.equal(validateLeagueName('x'.repeat(41)).ok, false);
  assert.equal(validateLeagueName('The Danville 12').ok, true);
});

// ---------------------------------------------------------------------------
// the naming landmine + the scoped board
// ---------------------------------------------------------------------------

test('nothing in lib/leagues touches the SPORTS `leagues` table', () => {
  const t = stripComments(src('lib/leagues/core.js'));
  assert.ok(!/FROM leagues\b/.test(t) && !/JOIN leagues\b/.test(t),
    'bare `leagues` is the NFL/CFB table - the migration 073 landmine');
});

test('the member scope is explicit ANY, never a falsy shortcut', () => {
  const t = stripComments(src('lib/weekly/live.js'));
  assert.match(t, /memberIds == null/, 'null means global');
  assert.match(t, /ANY\(\$\{memberIds\}\)/, 'an EMPTY league gets an empty board, not the world');
});

test('the league board inherits sealed-until-lock - scope cannot bypass the null', () => {
  const t = stripComments(src('lib/weekly/live.js'));
  const fn = t.slice(t.indexOf('export async function weeklyBoardTable'));
  const gate = fn.indexOf('if (!locked) return null');
  const scoped = fn.indexOf('ANY(');
  assert.ok(gate > -1 && gate < scoped, 'the pre-lock null precedes every scoped read');
});

test('membership gates visibility - leagueDetail returns null for non-members', () => {
  const t = stripComments(src('lib/leagues/core.js'));
  const fn = t.slice(t.indexOf('export async function leagueDetail'));
  assert.match(fn, /JOIN league_members m ON m\.league_id = l\.id AND m\.user_id = /);
  assert.match(fn, /if \(!lg\) return null/);
});

// ---------------------------------------------------------------------------
// the door and the share target
// ---------------------------------------------------------------------------

test('the share target carries the code through the sign-in law', () => {
  const t = stripComments(src('app/leagues/page.js'));
  assert.match(t, /joinDest = joinRaw \? `\/leagues\?join=/, 'the dest must remember why they came');
  assert.match(t, /requireSignInInShell\(\{ isShell, userId, dest: joinDest \}\)/);
  assert.match(t, /shellSigninHref\(joinDest, isShell\)/, 'web sign-in links carry it too');
});

test('a code-holder sees name + members, never a null - and never the roster', () => {
  const t = stripComments(src('lib/leagues/core.js'));
  const fn = t.slice(t.indexOf('export async function leagueByCode'));
  assert.match(fn, /count\(\*\)::int/, 'member COUNT only');
  assert.ok(!/JOIN users/.test(fn), 'the preview must not carry member identities');
  const prompt = stripComments(src('components/leagues/JoinPrompt.js'));
  assert.match(prompt, /doesn&rsquo;t match anything/, 'a dud code gets a sentence, not a 404');
  assert.match(prompt, /Sign in to join/, 'signed-out gets the law first, join after');
});

test('the lobby card lists leagues or pitches, and routes /leagues', () => {
  const t = stripComments(src('app/games/page.js'));
  assert.match(t, /Your leagues/);
  assert.match(t, /Start a league|Open your leagues/);
  assert.match(t, /href="\/leagues"/);
  assert.match(t, /myLeagues\(Number\(userId\)\)\.catch\(\(\) => \[\]\)/, 'caught like every lobby read');
});

test('the Daily scope narrows but never widens the reveal law', () => {
  const t = stripComments(src('lib/daily/boards.js'));
  // Both scoped branches keep the revealed JOIN - count them.
  const revealedJoins = (t.match(/JOIN puzzle_days d{1,2} ON d{1,2}\.puzzle_date = e\.puzzle_date AND d{1,2}\.revealed/g) ?? []).length;
  assert.ok(revealedJoins >= 4, `every branch carries the revealed filter (found ${revealedJoins})`);
  assert.match(t, /e\.user_id = ANY\(\$\{memberIds\}\)/, 'explicit ANY, same as the Weekly');
  assert.match(t, /memberIds == null/, 'null means global');
});

test('the index reads the Daily through the scoped reader only (headline top-1)', () => {
  // Re-pinned for the v0_1 door: the index reads ONE row for the headline;
  // overall and the full boards moved to /leagues/[id].
  const t = stripComments(src('app/leagues/page.js'));
  assert.match(t, /dayBoard\(revealedDate, uid, 1, \{ memberIds: members \}\)/);
  assert.ok(!/overall\(/.test(t), 'season standings belong to the league page now');
  assert.ok(!/FROM puzzle_entries/.test(t), 'no ad-hoc entry SQL on the page');
});

// ---------------------------------------------------------------------------
// the restructure: door, tabs, preview-by-id
// ---------------------------------------------------------------------------

const { LEAGUE_TABS, parseLeagueTab, leagueHref, leagueShareLink } = await import('./nav.js');

test('league tab URLs round-trip - the scoresNav law', () => {
  for (const t of LEAGUE_TABS) {
    const href = leagueHref(7, t.key);
    const sp = Object.fromEntries(new URL(href, 'https://x').searchParams);
    assert.equal(parseLeagueTab(sp), t.key, t.key);
  }
  assert.equal(leagueHref(7, 'daily'), '/leagues/7', 'default tab is omitted');
  assert.equal(parseLeagueTab({ tab: 'junk' }), 'daily');
  assert.equal(parseLeagueTab({}), 'daily');
});

test('calendar order is ratified and the ghost dates ride the definition', () => {
  assert.deepEqual(LEAGUE_TABS.map((t) => t.key), ['daily', 'pickem', 'weekly', 'draft', 'season']);
  // RE-RATIFIED for the first-kickoff ruling (Pick'em relay 1): the mock's
  // Thursday assumed a game that does not exist; the static date is the
  // pre-board fallback and the live page overrides it from locks_at.
  assert.equal(LEAGUE_TABS.find((t) => t.key === 'pickem').date, 'Aug 29');
  assert.equal(LEAGUE_TABS.find((t) => t.key === 'weekly').date, 'Sep 10');
  assert.equal(LEAGUE_TABS.find((t) => t.key === 'draft').date, 'Sep 10');
  assert.equal(LEAGUE_TABS.find((t) => t.key === 'season').date, null, 'Season is dateless per mock');
  assert.equal(leagueShareLink('ABC123'), 'https://sportsvyn.com/leagues?join=ABC123');
});

test('the card is a DOOR - a Link, no boards, one headline', () => {
  const t = stripComments(src('app/leagues/page.js'));
  assert.match(t, /<Link className="lg-door"/);
  assert.match(t, /dayBoard\(revealedDate, uid, 1, \{ memberIds: members \}\)/, 'top row only');
  assert.ok(!/tierClass|season\.top|table\.top/.test(t), 'boards belong to /leagues/[id] now');
});

test('the preview pin extends to /leagues/[id] - name + count, nothing else', () => {
  const core = stripComments(src('lib/leagues/core.js'));
  const fn = core.slice(core.indexOf('export async function leaguePreview'));
  assert.match(fn, /count\(\*\)::int/);
  assert.ok(!/JOIN users/.test(fn.slice(0, fn.indexOf('export async function joinLeagueById'))),
    'no identities in the preview');
  const page = stripComments(src('app/leagues/[id]/page.js'));
  // slice to a CODE marker - comments are stripped, so a comment marker
  // silently slices to end-of-file and the assertion tests the whole page
  const nonMember = page.slice(page.indexOf('if (!league)'), page.indexOf('const memberIds = await leagueMemberIds'));
  assert.ok(!/members\.map|leagueMemberIds|dayBoard|overall/.test(nonMember),
    'the non-member branch renders preview facts only');
  assert.match(nonMember, /Boards are members-only/);
});

test('the [id] page carries the sign-in law with the tab destination', () => {
  const t = stripComments(src('app/leagues/[id]/page.js'));
  assert.match(t, /const dest = leagueHref\(leagueId, tab\)/);
  assert.match(t, /requireSignInInShell\(\{ isShell, userId, dest \}\)/);
  assert.match(t, /shellSigninHref\(dest, isShell\)/);
});

test('the [id] page reads through the scoped readers only - no ad-hoc SQL', () => {
  const t = stripComments(src('app/leagues/[id]/page.js'));
  assert.ok(!/FROM puzzle_entries|FROM contest_entries|sql`/.test(t),
    'ad-hoc entry SQL on the page is forbidden');
  assert.match(t, /dayBoard\(revealedDate, uid, 10, \{ memberIds \}\)/);
  assert.match(t, /overall\(uid, 10, null, \{ memberIds \}\)/);
});

test('post-join lands on the league page, not the index', () => {
  const t = stripComments(src('components/leagues/JoinPrompt.js'));
  assert.match(t, /router\.replace\(`\/leagues\/\$\{res\.leagueId\}`\)/);
});

test('the ghost panels carry the mock v0_1 copy verbatim', () => {
  // MINUS Pick'em's when-line, re-ratified out (Pick'em relay 1): the mock
  // hardcoded a lock weekday and the first-kickoff law forbids that; the
  // panel now derives from the contest via firstLockLabel(), pinned in
  // lib/pickem/pickem.test.mjs.
  const t = src('app/leagues/[id]/page.js');
  for (const line of [
    "Pick'em lights up with the board",
    'The Weekly board lights up at first kickoff',
    'The Draft settles here after first kickoff',
    'draft opens Sep 8 · locks Wed Sep 9, 8:20 PM ET',
    'Cross-game standings arrive with the season',
    'every game, one ladder',
  ]) assert.ok(t.includes(line), `missing mock copy: ${line}`);
});

test('the season chip is the BEST tier, jade for the top tiers', () => {
  const st = stripComments(src('lib/daily/standings.js'));
  assert.match(st, /pointsForTier\(r\.tier\) > pointsForTier\(e\.best\)/, 'best is compared by tier points');
  const page = stripComments(src('app/leagues/[id]/page.js'));
  assert.match(page, /r\.best === 'MVP' \|\| r\.best === 'HALL OF FAME'/);
});
