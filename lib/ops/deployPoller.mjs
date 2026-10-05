// lib/ops/deployPoller.mjs - the decisions behind scripts/deploy-poller.sh
// (sun-12 item 7), pulled out of bash so they can be tested without a droplet.
//
// The shell script does the side effects (git worktree, cp -al, symlinks,
// systemctl, journalctl). Everything that is a DECISION lives here, pure:
//   parseDeployArgs  what was asked for, refused early if it is ambiguous
//   nodeModulesPlan  hardlink the main tree's node_modules, or npm ci
//   prunePlan        which releases go (keep the newest N, never current/previous)
//   headProof        does the poller's own "starting" line name the deployed sha
//
// CLI (used by the script; every line is KEY=value, values from a safe charset):
//   node lib/ops/deployPoller.mjs args  -- <argv...>
//   node lib/ops/deployPoller.mjs deps  <release package.json> <main package.json>
//   node lib/ops/deployPoller.mjs prune <history file> <current sha> <previous sha> [keep]
//   node lib/ops/deployPoller.mjs proof <sha>            (journal text on stdin)
import { readFileSync, realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export const KEEP_DEFAULT = 3;
const REF_RE = /^[A-Za-z0-9][A-Za-z0-9._\/^~-]{0,199}$/;
const SHA_RE = /^[0-9a-f]{40}$/;

export const USAGE = `usage: scripts/deploy-poller.sh <commit-or-ref> [--force] [--install-units] [--npm-ci] [--dry-run] [--keep N]
       scripts/deploy-poller.sh --rollback [--dry-run]
  <ref>            a commit or ref; must be on origin/main unless --force
  --force          deploy a commit that is not on origin/main
  --install-units  copy the release's unit files into ~/.config/systemd/user and daemon-reload
  --npm-ci         always npm ci --omit=dev, never hardlink the main tree's node_modules
  --dry-run        print the plan, change nothing
  --keep N         releases to keep (default ${KEEP_DEFAULT}; current and previous are always kept)
  --rollback       switch current to the previous release and restart`;

/**
 * @returns {{ok: true, ref: string|null, rollback: boolean, force: boolean, installUnits: boolean,
 *            npmCi: boolean, dryRun: boolean, keep: number} | {ok: false, error: string}}
 */
export function parseDeployArgs(argv = []) {
  const o = { ref: null, rollback: false, force: false, installUnits: false, npmCi: false, dryRun: false, keep: KEEP_DEFAULT };
  const fail = (error) => ({ ok: false, error });
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--rollback') o.rollback = true;
    else if (a === '--force') o.force = true;
    else if (a === '--install-units') o.installUnits = true;
    else if (a === '--npm-ci') o.npmCi = true;
    else if (a === '--dry-run' || a === '-n') o.dryRun = true;
    else if (a === '--keep') {
      const n = Number(argv[++i]);
      if (!Number.isInteger(n) || n < 2 || n > 20) return fail('--keep wants an integer 2..20');
      o.keep = n;
    } else if (a === '-h' || a === '--help') return fail('help');
    else if (a.startsWith('-')) return fail(`unknown flag ${a}`);
    else {
      if (o.ref) return fail(`one ref only (got ${o.ref} and ${a})`);
      if (!REF_RE.test(a) || a.includes('..')) return fail(`not a plausible ref: ${a}`);
      o.ref = a;
    }
  }
  if (o.rollback) {
    if (o.ref) return fail('--rollback takes no ref: it switches to the previous release');
    if (o.force || o.installUnits || o.npmCi) return fail('--rollback takes only --dry-run');
  } else if (!o.ref) return fail('a commit or ref is required (or --rollback)');
  return { ok: true, ...o };
}

const DEP_FIELDS = ['dependencies', 'devDependencies', 'optionalDependencies', 'peerDependencies', 'overrides', 'bundleDependencies'];
const sorted = (v) => (v && typeof v === 'object' && !Array.isArray(v)
  ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, sorted(v[k])]))
  : v);
/** The parts of package.json that decide what is in node_modules, key-order independent. */
export function depsKey(pkg) {
  return JSON.stringify(Object.fromEntries(DEP_FIELDS.map((f) => [f, sorted(pkg?.[f] ?? null)])));
}

/**
 * 'hardlink' when the release asks for exactly what the main tree's node_modules
 * was installed from; otherwise 'npm-ci'. Compares package.json, NOT the
 * lockfile: the droplet's lockfile is regenerated on Linux and never committed,
 * so it would never equal the commit's (Mac) lockfile and the fast path would
 * never be taken.
 */
export function nodeModulesPlan(releasePkg, mainPkg, { npmCi = false } = {}) {
  if (npmCi) return { plan: 'npm-ci', reason: 'forced by --npm-ci' };
  if (!mainPkg) return { plan: 'npm-ci', reason: 'main tree package.json unreadable' };
  return depsKey(releasePkg) === depsKey(mainPkg)
    ? { plan: 'hardlink', reason: 'package.json dependencies identical to the main tree' }
    : { plan: 'npm-ci', reason: 'package.json dependencies differ from the main tree' };
}

/**
 * @param history shas in deploy order, oldest first (repeats allowed: a redeploy)
 * @param present shas that actually have a release directory
 * @returns shas to delete: everything present except the newest `keep` distinct
 *          deploys, and never current or previous (a rollback target must exist).
 */
export function prunePlan(history = [], { current = null, previous = null, keep = KEEP_DEFAULT, present = null } = {}) {
  const newestFirst = [];
  for (let i = history.length - 1; i >= 0; i--) if (!newestFirst.includes(history[i])) newestFirst.push(history[i]);
  const keepSet = new Set(newestFirst.slice(0, keep));
  if (current) keepSet.add(current);
  if (previous) keepSet.add(previous);
  const all = present ?? newestFirst;
  return all.filter((s) => SHA_RE.test(s) && !keepSet.has(s));
}

const START_RE = /live-poller starting: pid=(\d+) head=([0-9a-f]+|\S+)/g;
/** The LAST "live-poller starting" line in the journal text, checked against sha. */
export function headProof(journalText = '', sha = '') {
  const m = [...String(journalText).matchAll(START_RE)].pop();
  if (!m) return { ok: false, head: null, pid: null, line: null, reason: 'no "live-poller starting" line yet' };
  const head = m[2];
  const line = String(journalText).split('\n').find((l) => l.includes(m[0])) ?? m[0];
  const ok = /^[0-9a-f]{7,40}$/.test(head) && SHA_RE.test(sha) && sha.startsWith(head);
  return { ok, head, pid: Number(m[1]), line: line.trim(), reason: ok ? 'head matches' : `head=${head} is not ${sha.slice(0, 12)}` };
}

// --- CLI -------------------------------------------------------------------
const emit = (k, v) => {
  const s = String(v ?? '');
  if (!/^[A-Za-z0-9._\/^~:=, -]*$/.test(s)) throw new Error(`unsafe value for ${k}`);
  process.stdout.write(`${k}=${s}\n`);
};
const readJson = (p) => { try { return JSON.parse(readFileSync(p, 'utf8')); } catch { return null; } };

function main(argv) {
  const [cmd, ...rest] = argv;
  if (cmd === 'args') {
    const r = parseDeployArgs(rest[0] === '--' ? rest.slice(1) : rest);
    if (!r.ok) { process.stderr.write(`${r.error === 'help' ? '' : `deploy-poller: ${r.error}\n`}${USAGE}\n`); return r.error === 'help' ? 0 : 2; }
    emit('REF', r.ref ?? ''); emit('ROLLBACK', r.rollback ? 1 : 0); emit('FORCE', r.force ? 1 : 0);
    emit('INSTALL_UNITS', r.installUnits ? 1 : 0); emit('NPM_CI', r.npmCi ? 1 : 0);
    emit('DRY_RUN', r.dryRun ? 1 : 0); emit('KEEP', r.keep);
    return 0;
  }
  if (cmd === 'deps') {
    const r = nodeModulesPlan(readJson(rest[0]), readJson(rest[1]), { npmCi: rest[2] === '1' });
    emit('NM_PLAN', r.plan); emit('NM_REASON', r.reason);
    return 0;
  }
  if (cmd === 'prune') {
    const [file, current, previous, keep, ...present] = rest;
    let hist = [];
    try { hist = readFileSync(file, 'utf8').split('\n').map((l) => l.trim()).filter((l) => SHA_RE.test(l)); } catch { /* none yet */ }
    const list = prunePlan(hist, { current, previous, keep: Number(keep) || KEEP_DEFAULT, present: present.length ? present : null });
    for (const s of list) process.stdout.write(`${s}\n`);
    return 0;
  }
  if (cmd === 'proof') {
    const r = headProof(readFileSync(0, 'utf8'), rest[0]);
    process.stdout.write(`${r.line ?? r.reason}\n`);
    return r.ok ? 0 : (r.head ? 1 : 3);
  }
  process.stderr.write('deployPoller.mjs: args | deps | prune | proof\n');
  return 2;
}

const isMain = () => { try { return realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url)); } catch { return false; } };
if (process.argv[1] && isMain()) process.exitCode = main(process.argv.slice(2));
