// lib/ops/deployPoller.test.mjs - the decisions of scripts/deploy-poller.sh, pure.
// The script itself is exercised end to end, in a sandbox, by
// scripts/deploy-poller.test.mjs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseDeployArgs, nodeModulesPlan, depsKey, prunePlan, headProof, KEEP_DEFAULT } from './deployPoller.mjs';

const sha = (c) => c.repeat(40);

test('args: a ref, with the defaults', () => {
  const r = parseDeployArgs(['660fcb1']);
  assert.deepEqual(r, { ok: true, ref: '660fcb1', rollback: false, force: false, installUnits: false, npmCi: false, dryRun: false, keep: 3 });
  assert.equal(KEEP_DEFAULT, 3, 'the ruling: keep the last 3 releases');
});

test('args: every flag, in any order', () => {
  const r = parseDeployArgs(['--force', 'origin/main', '--install-units', '--npm-ci', '--dry-run', '--keep', '5']);
  assert.equal(r.ok, true);
  assert.equal(r.ref, 'origin/main');
  assert.deepEqual([r.force, r.installUnits, r.npmCi, r.dryRun, r.keep], [true, true, true, true, 5]);
});

test('args: --rollback stands alone (no ref, no build flags), --dry-run allowed', () => {
  assert.deepEqual(parseDeployArgs(['--rollback']).rollback, true);
  assert.equal(parseDeployArgs(['--rollback', '--dry-run']).dryRun, true);
  assert.match(parseDeployArgs(['--rollback', 'abc1234']).error, /takes no ref/);
  assert.match(parseDeployArgs(['--rollback', '--force']).error, /only --dry-run/);
});

test('args: refusals', () => {
  assert.match(parseDeployArgs([]).error, /required/);
  assert.match(parseDeployArgs(['a1', 'b2']).error, /one ref only/);
  assert.match(parseDeployArgs(['--frce', 'a1']).error, /unknown flag --frce/);
  assert.match(parseDeployArgs(['a1', '--keep', '1']).error, /--keep/, 'keep 1 would leave no rollback target');
  assert.match(parseDeployArgs(['a1', '--keep']).error, /--keep/);
  assert.match(parseDeployArgs(['$(reboot)']).error, /plausible ref/, 'nothing shell-shaped reaches git');
  assert.match(parseDeployArgs(['main..other']).error, /plausible ref/, 'a range is not a commit');
  assert.equal(parseDeployArgs(['--help']).error, 'help');
});

test('node_modules: identical dependencies -> hardlink, key order does not matter', () => {
  const a = { name: 'x', version: '1', dependencies: { next: '16.2.6', react: '19' }, devDependencies: { eslint: '^9' } };
  const b = { name: 'x', version: '2', scripts: { dev: 'y' }, devDependencies: { eslint: '^9' }, dependencies: { react: '19', next: '16.2.6' } };
  assert.equal(depsKey(a), depsKey(b), 'name/version/scripts do not decide node_modules');
  assert.equal(nodeModulesPlan(a, b).plan, 'hardlink');
});

test('node_modules: any dependency change -> npm ci; --npm-ci forces it; unreadable main -> npm ci', () => {
  const a = { dependencies: { next: '16.2.6' } };
  assert.equal(nodeModulesPlan(a, { dependencies: { next: '16.2.7' } }).plan, 'npm-ci');
  assert.equal(nodeModulesPlan(a, { dependencies: { next: '16.2.6' }, devDependencies: { jsdom: '1' } }).plan, 'npm-ci', 'a dev dep counts: the main tree has it installed');
  assert.equal(nodeModulesPlan(a, { dependencies: { next: '16.2.6' }, overrides: { foo: '1' } }).plan, 'npm-ci');
  assert.equal(nodeModulesPlan(a, a, { npmCi: true }).plan, 'npm-ci');
  assert.equal(nodeModulesPlan(a, null).plan, 'npm-ci');
});

test('prune: keeps the newest 3 deploys, deletes the rest', () => {
  const h = [sha('a'), sha('b'), sha('c'), sha('d'), sha('e')];
  assert.deepEqual(prunePlan(h, { current: sha('e'), previous: sha('d') }), [sha('b'), sha('a')]);
});

test('prune: never current or previous, even when they are old (after a rollback)', () => {
  // deployed a,b,c,d then rolled back to a: history a,b,c,d,a; current=a previous=d
  const h = [sha('a'), sha('b'), sha('c'), sha('d'), sha('a')];
  assert.deepEqual(prunePlan(h, { current: sha('a'), previous: sha('d') }), [sha('b')]);
  // previous outside the newest-3 window is still kept
  assert.deepEqual(prunePlan([sha('1'), sha('2'), sha('3'), sha('4')], { current: sha('4'), previous: sha('1'), keep: 2 }), [sha('2')]);
});

test('prune: a release directory with no history line is pruned; a non-sha name never is', () => {
  const present = [sha('a'), sha('f'), 'not-a-release', sha('b')];
  assert.deepEqual(prunePlan([sha('a'), sha('b')], { current: sha('b'), previous: sha('a'), present }), [sha('f')]);
});

const J = (head, pid = 4242) => `2026-10-04T12:57:31+00:00 considered-cc sportsvyn-live[${pid}]: 2026-10-04T12:57:31.521Z live-poller starting: pid=${pid} head=${head} leagues=cfb,nfl,mlb,nba`;
const FULL = '660fcb1679cb6ba49a8d8b25b8b0867b25357082';

test('proof: the poller names the deployed sha', () => {
  const r = headProof(`[prod-db] DATABASE_URL -> x\n${J('660fcb1')}\n[nfl] poll ok`, FULL);
  assert.equal(r.ok, true);
  assert.equal(r.head, '660fcb1');
  assert.equal(r.pid, 4242);
  assert.match(r.line, /head=660fcb1 leagues=/, 'the whole journal line is what gets printed');
});

test('proof: the LAST starting line decides (a crash-restart after the deploy)', () => {
  assert.equal(headProof(`${J('660fcb1', 1)}\n${J('7a131a6', 2)}`, FULL).ok, false);
  assert.equal(headProof(`${J('7a131a6', 1)}\n${J('660fcb1', 2)}`, FULL).ok, true);
});

test('proof: a wrong head, an unknown head, or no line at all is not proof', () => {
  const wrong = headProof(J('7a131a6'), FULL);
  assert.equal(wrong.ok, false); assert.match(wrong.reason, /head=7a131a6 is not 660fcb1679cb/);
  assert.equal(headProof(J('unknown'), FULL).ok, false, 'git rev-parse failed inside the release');
  assert.equal(headProof(J('660'), FULL).ok, false, 'too short to mean anything');
  const none = headProof('[prod-db] DATABASE_URL -> x', FULL);
  assert.equal(none.ok, false); assert.equal(none.head, null);
  assert.equal(headProof(J('660fcb1'), 'origin/main').ok, false, 'proof is against a resolved sha only');
});
