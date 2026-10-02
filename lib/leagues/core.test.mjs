// lib/leagues/core.test.mjs - codes, membership writes, and the scoped board.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
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

test('October and The Run scope the same way - explicit null, never a falsy shortcut', () => {
  // THE SAME RULE THE WEEKLY FOLLOWS, on the two MLB boards. An empty league is
  // an empty board; only a NULL memberIds means everyone.
  const oct = stripComments(src('lib/october/board.js'));
  assert.match(oct, /memberIds != null/, 'October: null means global');
  assert.match(oct, /e\.user_id = ANY\(\$\{memberIds\}\)/, 'and the scope is an explicit ANY');
  const run = stripComments(src('lib/run/board.js'));
  assert.match(run, /e\.user_id = ANY\(\$\{memberIds\}\)/, 'The Run: the same ANY');
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
  // Leagues V1: the preview is lib/leagues/invite.js invitePreview() - the
  // member COUNT, the owner's handle, never the member list, code or token
  // (lib/leagues/invite.test.mjs proves the last two on DEV).
  const t = stripComments(src('lib/leagues/invite.js'));
  const fn = t.slice(t.indexOf('async function leagueByKey'), t.indexOf('async function isMember'));
  assert.match(fn, /count\(\*\)::int FROM league_members/, 'member COUNT only');
  assert.ok(!/JOIN league_members/.test(fn), 'the preview must not carry member identities');
  for (const page of ['app/leagues/page.js', 'app/j/[code]/page.js']) {
    const p = stripComments(src(page));
    assert.match(p, /REFUSALS\[/, `${page}: a dud key gets a sentence, not a 404`);
    assert.match(p, /Sign in to join/, `${page}: signed-out gets the law first, join after`);
  }
});

test('the lobby card lists leagues or pitches, and routes /leagues', () => {
  // GAMES v3: the module is the second PRACTICE TILE, which names the
  // reader's own league (the mock's 'Your league · The Longest Yard') and
  // becomes the pitch when there is none. The read moved from the page to
  // lib/games/lobbyV3.js with it, and is still caught like every lobby read.
  const t = stripComments(src('components/games/LobbyV3.js')) + stripComments(src('lib/games/lobbyV3.js'));
  assert.match(t, /Start a league/);
  assert.match(t, /leagues\[0\]\.name/, 'a league the reader is in is named, not counted at them');
  assert.match(t, /href: '\/leagues'/);
  assert.match(t, /myLeagues\(uid\)\.catch\(\(\) => \[\]\)/, 'caught like every lobby read');
});

test('the Daily scope narrows but never widens the reveal law', () => {
  const t = stripComments(src('lib/daily/boards.js'));
  // Both scoped branches keep the revealed JOIN - count them.
  const revealedJoins = (t.match(/JOIN puzzle_days d{1,2} ON d{1,2}\.puzzle_date = e\.puzzle_date AND d{1,2}\.revealed/g) ?? []).length;
  assert.ok(revealedJoins >= 4, `every branch carries the revealed filter (found ${revealedJoins})`);
  assert.match(t, /e\.user_id = ANY\(\$\{memberIds\}\)/, 'explicit ANY, same as the Weekly');
  assert.match(t, /memberIds == null/, 'null means global');
});

test('the index reads no boards and writes no SQL of its own (Leagues V1 Main)', () => {
  // Re-pinned for Leagues V1 (fri-1): the card carries the league's games,
  // span and format; the reader's place arrives with P2's standings reader.
  // The legacy v1 Daily headline (puzzle_entries, the dead Daily) is gone.
  const t = stripComments(src('app/leagues/page.js'));
  assert.ok(!/dayBoard\(|overall\(/.test(t), 'boards belong to /leagues/[id]');
  assert.ok(!/\bsql`|FROM puzzle_entries/.test(t), 'no ad-hoc SQL on the page');
  assert.match(t, /myLeagues\(uid\)/);
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
  assert.equal(leagueHref(7, 'standings'), '/leagues/7', 'default tab is omitted');
  assert.equal(parseLeagueTab({ tab: 'junk' }), 'standings');
  assert.equal(parseLeagueTab({ tab: 'daily' }), 'standings', 'a pre-V1 tab link lands on the table');
  assert.equal(parseLeagueTab({}), 'standings');
});

test('the rail is STANDINGS | THIS WEEK | MEMBERS (Leagues V1, canvas board League)', () => {
  assert.deepEqual(LEAGUE_TABS.map((t) => t.key), ['standings', 'week', 'members']);
  assert.equal(leagueShareLink('ABC123'), 'https://sportsvyn.com/leagues?join=ABC123');
});

test('the card is a DOOR - a Link wearing its settings chips, no boards', () => {
  const t = stripComments(src('app/leagues/page.js'));
  assert.match(t, /<Link className=\{`lv-card/);
  assert.match(t, /leagueChips\(lg\)/, 'games, span and format from lib/leagues/settings');
  assert.ok(!/tierClass|season\.top|table\.top/.test(t), 'boards belong to /leagues/[id]');
});

test('the preview pin extends to /leagues/[id] - name + count, nothing else', () => {
  const core = stripComments(src('lib/leagues/core.js'));
  const fn = core.slice(core.indexOf('export async function leaguePreview'));
  assert.match(fn, /count\(\*\)::int/);
  const end = fn.indexOf('\nexport ', 1);
  assert.ok(!/JOIN users/.test(fn.slice(0, end < 0 ? undefined : end)),
    'no identities in the preview');
  const page = stripComments(src('app/leagues/[id]/page.js'));
  // slice to a CODE marker - comments are stripped, so a comment marker
  // silently slices to end-of-file and the assertion tests the whole page
  const nonMember = page.slice(page.indexOf('if (!league)'), page.indexOf('const table = await leagueTable'));
  assert.ok(nonMember.length > 100, 'the slice found both markers');
  assert.ok(!/members\.map|leagueMemberIds|leagueTable|dayBoard|overall/.test(nonMember),
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
  assert.match(t, /leagueTable\(league\)/, 'one derived table - lib/leagues/table.js');
});

test('THE LEAGUE DAILY IS v2: standings read daily_board_runs, never the dead v1 puzzle_entries (recon bug)', () => {
  const r = stripComments(src('lib/leagues/results.js'));
  assert.match(r, /FROM daily_board_runs r JOIN daily_boards b/);
  assert.ok(!/puzzle_entries/.test(r));
  for (const f of ['app/leagues/[id]/page.js', 'components/leagues/LeagueBoard.js', 'lib/leagues/table.js']) {
    assert.ok(!/dayBoard\(|overall\(|puzzle_entries/.test(stripComments(src(f))), `${f}: no v1 Daily reader`);
  }
});

test('post-join lands on the league page, not the index', () => {
  for (const f of ['components/leagues/LeaguesHome.js', 'components/leagues/InviteJoin.js']) {
    assert.match(stripComments(src(f)), /router\.replace\(`\/leagues\/\$\{res\.leagueId\}`\)/, f);
  }
});

test('NO QUICK-CREATE (Derik, fri-2): the board chips are gone, the action refuses a name-only league, the boards link /leagues/new', () => {
  assert.ok(!existsSync(path.join(REPO, 'components/leagues/LeagueChipActions.js')));
  const action = stripComments(src('app/actions/leagues.js'));
  assert.match(action, /if \(!formData\.has\('span'\)\) return \{ ok: false/);
  for (const f of ['app/run/board/page.js', 'app/october/board/page.js']) {
    const t = stripComments(src(f));
    assert.ok(!/LeagueChipActions/.test(t), f);
    assert.match(t, /href="\/leagues\/new"/, `${f} links the create sheet`);
  }
});

test('the standings column is LAST WK (Derik, fri-2), never "WK N"', () => {
  const t = stripComments(src('components/leagues/LeagueBoard.js'));
  assert.match(t, /unit === 'week' \? 'Last wk' : 'Last day'/);
  assert.ok(!/'Wk '/.test(t));
});
