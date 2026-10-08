// lib/gridiron/cfbKickoffTbd.test.mjs - CFB "Time TBD" (wed-6): the flag, the
// board's bounds, the confidence pre-fill, and the wiring that stores it. No database.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { execFileSync, spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { cfbKickoffTbd } from './cfbKickoffTbd.js';
import { slateBounds } from '../pickem/create.js';
import { defaultRanks, effectiveRanks } from '../pickem/confidence.js';
import { isGameLocked } from '../mlb/kickoffTbd.js';
import { kickoffTimeLabel, TIME_TBD } from '../time/display.js';
import { NBA_THIN_NIGHT } from '../nba/dayPickem.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const src = (p) => readFileSync(join(ROOT, p), 'utf8');

// Sat 17 Oct 2026: midnight EDT = 04:00Z
const PLACEHOLDER = '2026-10-17T04:00:00.000Z';

test('CFBD startTimeTBD OR the midnight-ET placeholder is TBD; a real time is not', () => {
  assert.equal(cfbKickoffTbd({ startTimeTBD: true, kickoffAt: '2026-10-17T19:30:00Z' }), true);
  assert.equal(cfbKickoffTbd({ startTimeTBD: false, kickoffAt: PLACEHOLDER }), true);
  assert.equal(cfbKickoffTbd({ startTimeTBD: null, kickoffAt: new Date(PLACEHOLDER) }), true);
  assert.equal(cfbKickoffTbd({ startTimeTBD: false, kickoffAt: '2026-10-17T19:30:00Z' }), false);
  // EST side: midnight EST in December is 05:00Z
  assert.equal(cfbKickoffTbd({ kickoffAt: '2026-12-05T05:00:00Z' }), true);
  assert.equal(cfbKickoffTbd({}), false);
});

test('a flagged CFB game never locks at its placeholder and prints Time TBD', () => {
  const now = '2026-10-17T12:00:00Z'; // eight hours past the placeholder
  const row = { status: 'scheduled', kickoff_at: PLACEHOLDER, league_slug: 'cfb' };
  assert.equal(isGameLocked(row, now), true, 'unflagged: the placeholder locks (the 8 Oct bug)');
  assert.equal(isGameLocked({ ...row, metadata: { kickoff_tbd: true } }, now), false);
  assert.equal(isGameLocked({ ...row, metadata: { kickoff_tbd: true }, status: 'live' }, now), true);
  assert.equal(kickoffTimeLabel(PLACEHOLDER, { tbd: true }), TIME_TBD);
});

test('confidence pre-fill: a TBD game sorts as the LATEST kickoff (rank 1), not the top', () => {
  const board = [
    { match_id: 1, kickoff_at: PLACEHOLDER, kickoff_tbd: true },        // earliest instant, TBD
    { match_id: 2, kickoff_at: '2026-10-17T16:00:00Z' },
    { match_id: 3, kickoff_at: '2026-10-17T19:30:00Z' },
    { match_id: 4, kickoff_at: '2026-10-18T00:00:00Z' },
  ];
  assert.deepEqual(defaultRanks(board), { 2: 4, 3: 3, 4: 2, 1: 1 });
  // a sheet missing the TBD game hands it the number nobody holds, in the same order
  assert.deepEqual(effectiveRanks(board, { 2: 4, 3: 3, 4: 2 }), { 2: 4, 3: 3, 4: 2, 1: 1 });
  // two TBD games: kickoff, then id, among themselves
  const two = [...board, { match_id: 0, kickoff_at: PLACEHOLDER, kickoff_tbd: true }];
  assert.deepEqual(defaultRanks(two), { 2: 5, 3: 4, 4: 3, 0: 2, 1: 1 });
  // no TBD games: unchanged
  assert.deepEqual(defaultRanks(board.map(({ kickoff_tbd, ...g }) => g)), { 1: 4, 2: 3, 3: 2, 4: 1 });
});

test('board bounds: a TBD placeholder neither keys the first kickoff nor closes the window early', () => {
  const slate = [
    { kickoff_at: PLACEHOLDER, kickoff_tbd: true },
    { kickoff_at: '2026-10-17T16:00:00Z', kickoff_tbd: false },
    { kickoff_at: '2026-10-17T23:30:00Z', kickoff_tbd: false },
  ];
  const b = slateBounds(slate);
  assert.equal(b.firstKickoff.toISOString(), '2026-10-17T16:00:00.000Z');
  // the TBD game is on the 17th's ET day: its end (placeholder + 24h) is the last instant
  assert.equal(b.locksAt.toISOString(), '2026-10-18T04:00:00.000Z');
  assert.equal(b.lastKo.toISOString(), b.locksAt.toISOString());
  // no TBD: exactly the old first/last
  const plain = slateBounds(slate.slice(1));
  assert.equal(plain.firstKickoff.toISOString(), '2026-10-17T16:00:00.000Z');
  assert.equal(plain.locksAt.toISOString(), '2026-10-17T23:30:00.000Z');
  // all TBD: the placeholders as they are
  const all = slateBounds([{ kickoff_at: PLACEHOLDER, kickoff_tbd: true }]);
  assert.equal(all.firstKickoff.toISOString(), PLACEHOLDER);
  assert.equal(all.locksAt.toISOString(), PLACEHOLDER);
});

test('wiring: the CFB sync writes kickoff_tbd on every game, from cfbKickoffTbd', () => {
  const s = src('lib/gridiron/sync.js');
  assert.match(s, /import \{ cfbKickoffTbd \} from '\.\/cfbKickoffTbd\.js'/);
  assert.match(s, /kickoff_tbd: cfbKickoffTbd\(\{ startTimeTBD: g\.startTimeTBD, kickoffAt \}\)/);
  // the merge that carries it is top-level, so a later false replaces an earlier true
  assert.match(s, /\|\| \$\{JSON\.stringify\(g\.metadata \?\? \{\}\)\}::jsonb/);
});

test('wiring: both football slates read the flag and freeze it into the board rows', () => {
  const s = src('lib/pickem/create.js');
  assert.equal(s.match(/COALESCE\(\(m\.metadata->>'kickoff_tbd'\)::boolean, false\) AS kickoff_tbd/g)?.length, 2);
  assert.equal(s.match(/kickoff_tbd: g\.kickoff_tbd === true,/g)?.length, 2);
  assert.equal(s.match(/const \{ firstKickoff, locksAt, lastKo \} = slateBounds\(slate\);/g)?.length, 2);
});

test('NBA thin night: the page says it in words', () => {
  assert.equal(NBA_THIN_NIGHT, "No NBA Pick'em tonight. Fewer than 3 games.");
  const page = src('app/pickem/[sport]/page.js');
  assert.match(page, /reason === 'thin-slate'/);
  assert.match(page, /\{NBA_THIN_NIGHT\}/);
});

test('vercel ignored build step: docs-only skips, anything else or any doubt builds', () => {
  const vj = JSON.parse(src('vercel.json'));
  assert.equal(vj.ignoreCommand, 'bash scripts/vercel-ignore-build.sh');
  const script = join(ROOT, 'scripts', 'vercel-ignore-build.sh');
  const dir = mkdtempSync(join(tmpdir(), 'sv-ignore-'));
  try {
    const git = (...a) => execFileSync('git', a, { cwd: dir, stdio: 'pipe' }).toString().trim();
    git('init', '-q'); git('config', 'user.email', 't@t.invalid'); git('config', 'user.name', 't');
    const commit = (file, body) => { writeFileSync(join(dir, file.replace(/\//g, '_')), body); git('add', '-A'); git('commit', '-qm', file); return git('rev-parse', 'HEAD'); };
    const run = (prev) => spawnSync('bash', [script], { cwd: dir, env: { ...process.env, VERCEL_GIT_PREVIOUS_SHA: prev ?? '', VERCEL_GIT_COMMIT_SHA: 'HEAD' } }).status;
    execFileSync('mkdir', ['-p', join(dir, 'docs')]);
    const base = commit('app.js', 'a');
    writeFileSync(join(dir, 'docs', 'handoff.md'), 'h'); writeFileSync(join(dir, 'README.md'), 'r');
    git('add', '-A'); git('commit', '-qm', 'docs');
    assert.equal(run(base), 0, 'docs/ and *.md only: skip');
    const docsHead = git('rev-parse', 'HEAD');
    commit('app.js', 'b');
    assert.equal(run(docsHead), 1, 'code changed: build');
    assert.equal(run(''), 1, 'no previous sha: build');
    assert.equal(run('0123456789abcdef0123456789abcdef01234567'), 1, 'unknown sha: build');
    assert.equal(run(git('rev-parse', 'HEAD')), 1, 'empty diff: build');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('the CFB game page prints Time TBD for a flagged game, never 12:00 AM', () => {
  const page = src('app/cfb/game/[slug]/page.js');
  assert.ok(page.includes('const kickLabel = (game) => (game.kickoffTbd ? `${fmtDay(game.kickoffAt)} · ${TIME_TBD}` : `${fmtKick(game.kickoffAt)} ET`);'));
  assert.equal(page.match(/\{kickLabel\(game\)\}/g)?.length, 2);
  assert.doesNotMatch(page, />\{fmtKick\(game\.kickoffAt\)\} ET</);
  assert.match(src('lib/gridiron/gameDetail.js'), /kickoffTbd: meta\.kickoff_tbd === true,/);
});
