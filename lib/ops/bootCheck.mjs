// lib/ops/bootCheck.mjs - THE BOOT CHECK for every droplet service entry (mon-3 item 2).
//
// WHY. On 5 Oct a merge put `const cfbKick = createKickThrottle({ ... log ... })`
// above `const log = ...` in services/live-poller/index.mjs: a TDZ ReferenceError
// the moment the module evaluated. The full suite was green - no test imports an
// entry file, because importing one STARTS it - and `node --check` was green,
// because a TDZ is not a syntax error. The poller restart-looped after deploy
// (fixed in ee6ccd2). The only thing that catches that class is evaluating the
// entry for real.
//
// HOW. Each entry calls `await bootCheckGate(name, lazy)` at the last point before
// its first connection, loop, lock or write. Without `--boot-check` on argv the
// gate returns and the service runs as always. With it, the gate also imports the
// modules the entry only loads lazily (the alert paths), prints ONE loud line and
// exits 0 - so every top-level statement above it ran, and nothing below it did.
//
// WHY AN ARGV FLAG AND NOT AN ENV VAR. Every unit reads ~/projects/sportsvyn/
// .env.local through EnvironmentFile; a stray SV_BOOT_CHECK=1 in that file would
// turn the production poller into a process that exits 0 on every start. argv
// comes only from ExecStart, which is tracked and pinned by
// services/deployUnits.test.mjs (no unit may pass --boot-check).
//
// AND IT REFUSES A REAL DATABASE. In boot-check mode the gate exits 1 unless
// DATABASE_URL is the stub below (an RFC 6761 `.invalid` host, which can never
// resolve). Nothing above a gate opens a connection - neon() is lazy, Client is
// only constructed in acquire() - but the check is meant to be hermetic, and a
// run that carried PROD's URL is a run somebody set up wrong.
//
// runBootCheck() is the runner both the suite (services/bootCheck.test.mjs) and
// scripts/deploy-poller.sh use: it spawns each entry EXACTLY as its unit does
// (`node --import ./services/_preload/prod-db.mjs <entry>`) plus --boot-check,
// with a scrubbed environment of stubs, and fails on a non-zero exit, a timeout,
// an Error name in the output, or a missing "ok" line (an entry that exited 0
// without ever reaching its gate proves nothing).
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

export const BOOT_CHECK_FLAG = '--boot-check';
export const BOOT_CHECK_DB = 'postgres://boot-check:boot-check@boot-check.invalid:5432/boot-check';

// The ONLY environment a checked entry sees. Stubs for every key a module checks
// for at import (lib/resend.js throws without RESEND_API_KEY); no real secret is
// ever passed through, because the parent's environment is not inherited.
export const BOOT_CHECK_ENV = Object.freeze({
  PROD_DATABASE_URL: BOOT_CHECK_DB,
  RESEND_API_KEY: 'boot-check',
  NODE_ENV: 'production',
});

/** The entries a unit starts, with the argv their unit adds. */
export const ENTRIES = Object.freeze([
  { name: 'live-poller', entry: 'services/live-poller/index.mjs', args: [] },
  { name: 'daily-tick', entry: 'services/daily-tick/index.mjs', args: [] },
  { name: 'mlb-advance', entry: 'services/mlb-advance/index.mjs', args: ['--trigger', 'boot-check'] },
]);
export const PRELOAD = './services/_preload/prod-db.mjs';

export const isBootCheck = (argv = process.argv) => argv.slice(2).includes(BOOT_CHECK_FLAG);
export const okLine = (name) => `[boot-check] ${name} ok`;

/**
 * The gate an entry calls before its first connection / loop / lock / write.
 * Returns immediately unless --boot-check was passed.
 *
 * @param name  the entry's name, as in ENTRIES
 * @param lazy  thunks for the modules the entry only imports later, e.g.
 *              [() => import('../../lib/pollers/alerts.js')]
 */
export async function bootCheckGate(name, lazy = []) {
  if (!isBootCheck()) return;
  console.log(`[boot-check] ======== BOOT CHECK MODE (${BOOT_CHECK_FLAG}): ${name} exits here, before any connection, loop or write ========`);
  if (process.env.DATABASE_URL !== BOOT_CHECK_DB) {
    console.error(`[boot-check] ${name} REFUSED: --boot-check runs only against the stub DATABASE_URL (${new URL(BOOT_CHECK_DB).host}), never a real one`);
    process.exit(1);
  }
  for (const load of lazy) await load();
  console.log(`${okLine(name)} (imported, top level built, ${lazy.length} lazy module(s) loaded)`);
  process.exit(0);
}

const ERROR_RE = /\b(ReferenceError|SyntaxError|TypeError|RangeError|ERR_MODULE_NOT_FOUND|Cannot find module|Error \[ERR_)/;

/** Spawn one entry in boot-check mode. Resolves { name, ok, why, output }. */
export function checkEntry({ name, entry, args = [] }, { cwd, node = process.execPath, timeoutMs = 15_000, preload = PRELOAD } = {}) {
  return new Promise((resolve) => {
    const env = { ...BOOT_CHECK_ENV, PATH: process.env.PATH ?? '/usr/bin:/bin', HOME: process.env.HOME ?? '/tmp' };
    const child = spawn(node, ['--import', preload, entry, ...args, BOOT_CHECK_FLAG], { cwd, env, stdio: ['ignore', 'pipe', 'pipe'] });
    let output = '';
    child.stdout.on('data', (d) => { output += d; });
    child.stderr.on('data', (d) => { output += d; });
    let timedOut = false;
    const timer = setTimeout(() => { timedOut = true; child.kill('SIGKILL'); }, timeoutMs);
    child.on('close', (code, signal) => {
      clearTimeout(timer);
      let why = null;
      if (timedOut) why = `did not exit within ${timeoutMs} ms (a gate that was never reached: the service started for real)`;
      else if (code !== 0) why = `exit ${code ?? signal}`;
      else if (ERROR_RE.test(output)) why = `error in output: ${output.match(ERROR_RE)[0]}`;
      else if (!output.includes(okLine(name))) why = `exit 0 without "${okLine(name)}" - the gate was never reached`;
      resolve({ name, ok: why === null, why, output });
    });
  });
}

/** Every entry, in parallel. Resolves { ok, results }. */
export async function runBootCheck({ cwd, node, timeoutMs, entries = ENTRIES } = {}) {
  const results = await Promise.all(entries.map((e) => checkEntry(e, { cwd, node, timeoutMs })));
  return { ok: results.every((r) => r.ok), results };
}

// CLI: node lib/ops/bootCheck.mjs [--node <path>] [--timeout-ms N]
// Checks the release this file lives in. Used by scripts/deploy-poller.sh before
// it switches `current`; exit 1 (with each failure's output) if any entry fails.
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const argv = process.argv.slice(2);
  const opt = (k) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : undefined; };
  const cwd = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
  const { ok, results } = await runBootCheck({ cwd, node: opt('--node') ?? process.execPath, timeoutMs: Number(opt('--timeout-ms') ?? 20_000) });
  for (const r of results) {
    console.log(`[boot-check] ${r.name}: ${r.ok ? 'ok' : `FAILED - ${r.why}`}`);
    if (!r.ok) console.log(r.output.trim().split('\n').slice(-25).map((l) => `    ${l}`).join('\n'));
  }
  process.exit(ok ? 0 : 1);
}
