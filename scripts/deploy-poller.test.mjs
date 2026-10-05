// scripts/deploy-poller.test.mjs - scripts/deploy-poller.sh end to end, IN A SANDBOX.
//
// Nothing here touches the droplet's services, ~/deploy or the real repo: HOME,
// the main repo, its origin, the deploy root and the unit dir are all in a temp
// directory, and `systemctl`, `journalctl` and `npm` are stubs at the front of
// PATH that log their argv. The journal stub answers with the head of whatever
// `current` points at (or FAKE_HEAD), the way the real poller's starting line does.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readlinkSync, existsSync, statSync, rmSync, chmodSync, readdirSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), 'deploy-poller.sh');
let T; let MAIN; let ROOT; let UNITS; let BIN; let LOG; const C = {};

const env = (extra = {}) => ({
  PATH: `${BIN}:${process.env.PATH}`, HOME: T, XDG_RUNTIME_DIR: path.join(T, 'run'), XDG_CONFIG_HOME: path.join(T, 'cfg'),
  SV_MAIN: MAIN, SV_DEPLOY_ROOT: ROOT, SV_UNIT_DIR: UNITS, SV_NODE: process.execPath, SV_PROOF_SECS: '5',
  GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null',
  GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t',
  ...extra,
});
const git = (...a) => {
  const r = spawnSync('git', a, { cwd: MAIN, env: env(), encoding: 'utf8' });
  assert.equal(r.status, 0, `git ${a.join(' ')}: ${r.stderr}`);
  return r.stdout.trim();
};
const deploy = (args, extra) => spawnSync('bash', [SCRIPT, ...args], { env: env(extra), encoding: 'utf8', timeout: 60_000 });
const out = (r) => `${r.stdout}\n${r.stderr}`;
const current = () => path.basename(readlinkSync(path.join(ROOT, 'current')));
const previous = () => path.basename(readlinkSync(path.join(ROOT, 'previous')));
const log = () => (existsSync(LOG) ? readFileSync(LOG, 'utf8') : '');
const releases = () => readdirSync(path.join(ROOT, 'releases')).sort();

function commit(msg, files) {
  for (const [f, body] of Object.entries(files)) {
    mkdirSync(path.dirname(path.join(MAIN, f)), { recursive: true });
    writeFileSync(path.join(MAIN, f), body);
  }
  git('add', '-A'); git('commit', '-q', '-m', msg);
  return git('rev-parse', 'HEAD');
}

before(() => {
  T = mkdtempSync(path.join(os.tmpdir(), 'sv-deploy-test-'));
  MAIN = path.join(T, 'main'); ROOT = path.join(T, 'deploy'); UNITS = path.join(T, 'units'); BIN = path.join(T, 'bin'); LOG = path.join(T, 'calls.log');
  for (const d of [MAIN, UNITS, BIN, path.join(T, 'run')]) mkdirSync(d, { recursive: true });
  // stubs: never the real systemctl / journalctl / npm
  const stub = (name, body) => { writeFileSync(path.join(BIN, name), `#!/usr/bin/env bash\n${body}\n`); chmodSync(path.join(BIN, name), 0o755); };
  stub('systemctl', `echo "systemctl $*" >>"${LOG}"; exit 0`);
  stub('journalctl', `echo "journalctl $*" >>"${LOG}"
h="\${FAKE_HEAD:-$(git -C "${ROOT}/current" rev-parse --short HEAD)}"
echo "2026-10-04T12:57:31+00:00 host sportsvyn-live[42]: 2026-10-04T12:57:31.521Z live-poller starting: pid=42 head=$h leagues=cfb,nfl"`);
  stub('npm', `echo "npm $* (cwd $PWD)" >>"${LOG}"; mkdir -p node_modules/fresh; exit 0`);

  spawnSync('git', ['init', '-q', '--bare', '-b', 'main', path.join(T, 'origin.git')], { env: env() });
  spawnSync('git', ['init', '-q', '-b', 'main', MAIN], { env: env() });
  git('remote', 'add', 'origin', path.join(T, 'origin.git'));
  writeFileSync(path.join(MAIN, '.gitignore'), '/node_modules\n.env*\n');
  const unit = (dir, name, extra = '') => ({ [`services/${dir}/systemd/${name}`]:
    `[Service]\nWorkingDirectory=%h/deploy/sportsvyn/current\nExecStart=${process.execPath} services/${dir}/index.mjs\n${extra}` });
  const pkg = JSON.stringify({ name: 'sv', dependencies: { next: '16.2.6' } });
  C.a = commit('A', {
    'package.json': pkg,
    'services/_preload/prod-db.mjs': '// preload\n',
    'services/live-poller/index.mjs': 'export const v = "a";\n',
    'services/daily-tick/index.mjs': '\n', 'services/mlb-advance/index.mjs': '\n',
    ...unit('live-poller', 'sportsvyn-live-poller.service'),
    ...unit('daily-tick', 'sportsvyn-daily-tick.service'), ...unit('daily-tick', 'sportsvyn-daily-tick.timer'),
    ...unit('mlb-advance', 'sportsvyn-mlb-advance@.service'), ...unit('mlb-advance', 'sportsvyn-mlb-advance.timer'),
  });
  C.b = commit('B', { 'services/live-poller/index.mjs': 'export const v = "b";\n' });
  C.c = commit('C', { 'services/live-poller/index.mjs': 'export const v = "c";\n' });
  git('push', '-q', 'origin', 'main');
  C.d = commit('D not pushed', { 'services/live-poller/index.mjs': 'export const v = "d";\n' });
  git('reset', '-q', '--hard', C.c);
  // the main tree: its own node_modules and its own .env.local (never in git)
  mkdirSync(path.join(MAIN, 'node_modules', 'next'), { recursive: true });
  writeFileSync(path.join(MAIN, 'node_modules', 'next', 'package.json'), '{"name":"next"}');
  writeFileSync(path.join(MAIN, '.env.local'), 'PROD_DATABASE_URL=postgres://sandbox\n');
});

after(() => {
  // worktrees live inside T, so removing T removes them; nothing outside T was made
  if (T && T.startsWith(os.tmpdir())) rmSync(T, { recursive: true, force: true });
});

test('a bad argument is refused before anything happens', () => {
  const r = deploy(['--rollback', C.a]);
  assert.equal(r.status, 2); assert.match(r.stderr, /takes no ref/);
  assert.equal(existsSync(ROOT), false);
});

test('first deploy without --install-units is refused: the installed units still run from the checkout', () => {
  const r = deploy([C.a]);
  assert.equal(r.status, 1, out(r));
  assert.match(r.stderr, /first deploy needs --install-units/);
  assert.equal(existsSync(path.join(ROOT, 'current')), false, 'nothing switched');
  assert.deepEqual(releases(), [], 'refused before building a release');
  assert.doesNotMatch(log(), /restart/, 'nothing restarted');
});

test('--dry-run changes nothing', () => {
  const r = deploy([C.a, '--install-units', '--dry-run']);
  assert.equal(r.status, 0, out(r));
  assert.match(r.stdout, /would: .*worktree add --detach/);
  assert.match(r.stdout, /would: systemctl --user restart sportsvyn-live-poller.service/);
  assert.equal(existsSync(path.join(ROOT, 'current')), false);
  assert.equal(readdirSync(UNITS).length, 0);
});

test('deploy A with --install-units: release, units, switch, restart, proof', () => {
  const r = deploy([C.a, '--install-units']);
  assert.equal(r.status, 0, out(r));
  assert.equal(current(), C.a);
  const rel = path.join(ROOT, 'releases', C.a);
  assert.equal(spawnSync('git', ['-C', rel, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).stdout.trim(), C.a, 'a detached worktree at A');
  assert.equal(readlinkSync(path.join(rel, '.env.local')), path.join(MAIN, '.env.local'), '.env.local is a symlink to the main tree');
  assert.equal(statSync(path.join(rel, 'node_modules/next/package.json')).ino, statSync(path.join(MAIN, 'node_modules/next/package.json')).ino,
    'node_modules hardlinked, same deps');
  assert.equal(readdirSync(UNITS).length, 5, 'every unit installed');
  assert.match(r.stdout, /previous unit files saved in /);
  // a second install backs up the first: the files it replaces are kept
  const again = deploy([C.a, '--install-units']);
  assert.equal(again.status, 0, out(again));
  const baks = readdirSync(path.join(ROOT, 'unit-backup'));
  assert.ok(baks.some((b) => readdirSync(path.join(ROOT, 'unit-backup', b)).length === 5), 'the replaced units were saved');
  assert.match(log(), /systemctl --user daemon-reload\nsystemctl --user restart sportsvyn-live-poller.service/);
  assert.match(r.stdout, new RegExp(`PROOF .*live-poller starting: pid=42 head=${C.a.slice(0, 7)}`));
  assert.match(spawnSync('git', ['-C', MAIN, 'worktree', 'list', '--porcelain'], { encoding: 'utf8' }).stdout, /locked/, 'the release worktree is locked');
});

test('deploy B: previous is A; a ref name resolves', () => {
  const r = deploy(['origin/main~1']);
  assert.equal(r.status, 0, out(r));
  assert.equal(current(), C.b); assert.equal(previous(), C.a);
});

test('a commit not on origin/main is refused, and --force deploys it', () => {
  let r = deploy([C.d]);
  assert.equal(r.status, 1); assert.match(r.stderr, /not on origin\/main/);
  assert.equal(current(), C.b, 'still B');
  r = deploy([C.c]);
  assert.equal(r.status, 0, out(r));
  r = deploy([C.d, '--force']);
  assert.equal(r.status, 0, out(r));
  assert.match(r.stdout, /NOT on origin\/main/);
  assert.equal(current(), C.d); assert.equal(previous(), C.c);
});

test('keeps the last 3 releases: A is pruned, and its worktree is gone from git', () => {
  assert.deepEqual(releases(), [C.b, C.c, C.d].sort());
  assert.doesNotMatch(spawnSync('git', ['-C', MAIN, 'worktree', 'list'], { encoding: 'utf8' }).stdout, new RegExp(C.a));
});

test('--rollback switches to the previous release and proves it; a second rollback undoes the first', () => {
  let r = deploy(['--rollback']);
  assert.equal(r.status, 0, out(r));
  assert.equal(current(), C.c); assert.equal(previous(), C.d);
  assert.match(r.stdout, new RegExp(`PROOF .*head=${C.c.slice(0, 7)}`));
  r = deploy(['--rollback']);
  assert.equal(r.status, 0, out(r));
  assert.equal(current(), C.d);
});

test('a poller that comes up on the wrong head fails the deploy', () => {
  const r = deploy([C.c], { FAKE_HEAD: 'deadbee' });
  assert.equal(r.status, 1, out(r));
  assert.match(r.stdout, /WRONG HEAD: .*head=deadbee/);
  assert.match(r.stdout, /--rollback/);
});

test('changed dependencies -> npm ci --omit=dev in the release, not a hardlink', () => {
  git('checkout', '-q', 'main');
  const e = commit('E deps', { 'package.json': JSON.stringify({ name: 'sv', dependencies: { next: '16.2.7' } }) });
  git('push', '-q', 'origin', 'main');
  // the main tree has not been reinstalled: its package.json is E's but pretend
  // its node_modules is stale by comparing against the old package.json
  writeFileSync(path.join(MAIN, 'package.json'), JSON.stringify({ name: 'sv', dependencies: { next: '16.2.6' } }));
  const r = deploy([e]);
  assert.equal(r.status, 0, out(r));
  assert.match(r.stdout, /node_modules: npm-ci \(package.json dependencies differ/);
  assert.match(log(), new RegExp(`npm ci --omit=dev .*\\(cwd ${path.join(ROOT, 'releases', e).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\)`));
  assert.equal(existsSync(path.join(ROOT, 'releases', e, 'node_modules', 'fresh')), true);
  git('checkout', '--', 'package.json');
});

// THE BOOT CHECK (mon-3 item 2, lib/ops/bootCheck.mjs). F carries the real checker
// and the real preload with entries that gate; G is F with the 5 Oct TDZ in the
// poller (a const read above its declaration). G parses - `node --check` passes -
// and must still be refused before `current` moves or anything restarts.
test('boot check: a release whose entry dies at import is refused; current and the poller are untouched', () => {
  const REAL = path.resolve(path.dirname(SCRIPT), '..');
  const gated = (name, extra = '') => `import { bootCheckGate } from '../../lib/ops/bootCheck.mjs';\n${extra}await bootCheckGate('${name}');\nexport const v = 1;\n`;
  const f = commit('F boot-checked', {
    'lib/ops/bootCheck.mjs': readFileSync(path.join(REAL, 'lib/ops/bootCheck.mjs'), 'utf8'),
    'services/_preload/prod-db.mjs': readFileSync(path.join(REAL, 'services/_preload/prod-db.mjs'), 'utf8'),
    'services/live-poller/index.mjs': gated('live-poller'),
    'services/daily-tick/index.mjs': gated('daily-tick'),
    'services/mlb-advance/index.mjs': gated('mlb-advance'),
  });
  const g = commit('G the 5 Oct TDZ', {
    'services/live-poller/index.mjs': gated('live-poller', 'const kick = { log };\nconst log = () => {};\n'),
  });
  git('push', '-q', 'origin', 'main');

  let r = deploy([f]);
  assert.equal(r.status, 0, out(r));
  assert.match(r.stdout, /\[boot-check\] live-poller: ok\n\[boot-check\] daily-tick: ok\n\[boot-check\] mlb-advance: ok/);
  assert.match(r.stdout, /boot check passed/);
  assert.equal(current(), f);

  const restarts = (log().match(/restart sportsvyn-live-poller/g) ?? []).length;
  r = deploy([g]);
  assert.equal(r.status, 1, out(r));
  assert.match(r.stderr, /\[boot-check\] live-poller: FAILED - exit 1/);
  assert.match(r.stderr, /ReferenceError: Cannot access 'log' before initialization/);
  assert.match(r.stderr, new RegExp(`BOOT CHECK FAILED for ${g.slice(0, 12)} .*current is unchanged \\(still ${f}\\); nothing was restarted`));
  assert.equal(current(), f, 'current still F');
  assert.equal((log().match(/restart sportsvyn-live-poller/g) ?? []).length, restarts, 'the poller was not restarted');
  assert.doesNotMatch(readFileSync(path.join(ROOT, 'history'), 'utf8'), new RegExp(g), 'G never entered history');
});
