// crew/lib/common.mjs - shared by crew/bin/* (CrewOS watcher + data-keeper scripts).
//
// THE CONTRACT (crew/README.md): no secret ever printed; exit 0 ok / 1 regression / 2 setup
// error; the LAST stdout line is one `SUMMARY <name> k=v ...` (board-state excepted); every
// network call has a timeout; READ ONLY. This file holds the parts every script shares so
// that none of them can drift from the contract on its own.
import { readFileSync, existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

/** The caller asked for something the script does not take, or a secret/API is missing. -> exit 2. */
export class SetupError extends Error {
  constructor(message, reason = 'setup') { super(message); this.name = 'SetupError'; this.reason = reason; }
}

export const DEFAULT_DEADLINE_MS = 9_500; // the 10 s ceiling, with a margin for process start
export const HTTP_TIMEOUT_MS = 6_000;

// ---------------------------------------------------------------------------
// Secrets. ~/crew/secrets by default; CREW_SECRETS_DIR points tests at an empty temp dir.
// ---------------------------------------------------------------------------
export function secretsDir(env = process.env) {
  return env.CREW_SECRETS_DIR || join(homedir(), 'crew', 'secrets');
}

// Every secret value read is remembered so redact() can scrub it from ANY later text.
const KNOWN = new Set();
export function rememberSecret(v) { if (v && String(v).length >= 6) KNOWN.add(String(v)); }

const unquote = (s) => s.trim().replace(/^["']|["']$/g, '');

/** A token file: either the bare token or `KEY=token`. null when the file is absent/empty. */
export function readToken(file, env = process.env) {
  const p = join(secretsDir(env), file);
  if (!existsSync(p)) return null;
  const raw = readFileSync(p, 'utf8').split('\n').map((l) => l.trim()).find((l) => l && !l.startsWith('#'));
  if (!raw) return null;
  const v = unquote(raw.replace(/^(?:export\s+)?[A-Z][A-Z0-9_]*=/, ''));
  if (!v) return null;
  rememberSecret(v);
  return v;
}

/** `KEY=value` out of an env-style file. null when absent. */
export function readEnvKey(file, key, env = process.env) {
  const p = join(secretsDir(env), file);
  if (!existsSync(p)) return null;
  for (const line of readFileSync(p, 'utf8').split('\n')) {
    const m = line.match(/^\s*(?:export\s+)?([A-Z][A-Z0-9_]*)=(.*)$/);
    if (m && m[1] === key) { const v = unquote(m[2]); if (v) { rememberSecret(v); return v; } }
  }
  return null;
}

/** The read-only DB URL, or a SetupError that names the file but never a value. */
export function requireReaderUrl(env = process.env) {
  const url = readEnvKey('crew-reader.env', 'CREW_READER_URL', env);
  if (!url) throw new SetupError('CREW_READER_URL is not set in crew-reader.env (secrets dir)', 'no-secret');
  try {
    const u = new URL(url);
    if (u.password) rememberSecret(decodeURIComponent(u.password));
    rememberSecret(url);
  } catch { throw new SetupError('CREW_READER_URL is not a valid URL', 'bad-secret'); }
  return url;
}

export function requireToken(file, label, env = process.env) {
  const t = readToken(file, env);
  if (!t) throw new SetupError(`${label} is not set (${file} in the secrets dir)`, 'no-secret');
  return t;
}

/** Scrub secrets from text: remembered values, URL passwords, bearer tokens, long opaque tokens in URLs. */
export function redact(text) {
  let s = String(text ?? '');
  for (const k of KNOWN) s = s.split(k).join('[redacted]');
  s = s.replace(/(\b[a-z][a-z0-9+.-]*:\/\/[^\s:/@]*:)[^\s@/]+@/gi, '$1[redacted]@');
  s = s.replace(/\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]{8,}/gi, '$1 [redacted]');
  return s;
}

// ---------------------------------------------------------------------------
// Output.
// ---------------------------------------------------------------------------
/** A summary value: no spaces, '-' when empty. */
export function val(v) {
  if (v === undefined || v === null || v === '') return '-';
  if (typeof v === 'number' && !Number.isFinite(v)) return '-';
  return String(v).replace(/\s+/g, '_');
}

export function summaryLine(name, fields) {
  return `SUMMARY ${name} ${Object.entries(fields).map(([k, v]) => `${k}=${val(v)}`).join(' ')}`;
}

/** USD to two places, or '-' when unknown. Unknown is never 0. */
export const usd = (n) => (n === null || n === undefined || !Number.isFinite(n) ? '-' : n.toFixed(2));

// ---------------------------------------------------------------------------
// Args. A script takes NOTHING but what it lists; anything else is exit 2.
// ---------------------------------------------------------------------------
/** @returns {number[]} parsed integers, one per spec entry (defaults filled). Throws SetupError on extras/bad values. */
export function parseArgs(argv, specs = []) {
  if (argv.length > specs.length) throw new SetupError(`unexpected argument (takes ${specs.length})`, 'usage');
  return specs.map((s, i) => {
    if (argv[i] === undefined) return s.default;
    if (!/^\d{1,6}$/.test(argv[i])) throw new SetupError(`${s.name} must be a whole number`, 'usage');
    const n = Number(argv[i]);
    if (n < (s.min ?? 1) || n > (s.max ?? 10_080)) throw new SetupError(`${s.name} out of range ${s.min ?? 1}-${s.max ?? 10_080}`, 'usage');
    return n;
  });
}

// ---------------------------------------------------------------------------
// HTTP with a timeout on every call. Errors are redacted.
// ---------------------------------------------------------------------------
export async function fetchJson(url, { method = 'GET', headers = {}, body, timeoutMs = HTTP_TIMEOUT_MS, fetchImpl = fetch, label = 'request' } = {}) {
  let res;
  try {
    res = await fetchImpl(url, { method, headers, body, signal: AbortSignal.timeout(timeoutMs) });
  } catch (e) {
    throw new SetupError(redact(`${label} unreachable: ${e?.name === 'TimeoutError' ? 'timeout' : e?.message ?? e}`), 'unreachable');
  }
  const text = await res.text();
  if (!res.ok) throw new SetupError(redact(`${label} HTTP ${res.status}`), res.status === 401 || res.status === 403 ? 'auth' : 'api');
  try { return text ? JSON.parse(text) : null; } catch { throw new SetupError(`${label} returned non-JSON`, 'api'); }
}

/** Like fetchJson but returns the body text (JSON-lines endpoints). */
export async function fetchText(url, { headers = {}, timeoutMs = HTTP_TIMEOUT_MS, fetchImpl = fetch, label = 'request' } = {}) {
  let res;
  try {
    res = await fetchImpl(url, { headers, signal: AbortSignal.timeout(timeoutMs) });
  } catch (e) {
    throw new SetupError(redact(`${label} unreachable: ${e?.name === 'TimeoutError' ? 'timeout' : e?.message ?? e}`), 'unreachable');
  }
  if (!res.ok) throw new SetupError(redact(`${label} HTTP ${res.status}`), res.status === 401 || res.status === 403 ? 'auth' : 'api');
  return res.text();
}

// ---------------------------------------------------------------------------
// The runner. Prints lines, then the SUMMARY (or nothing but the one line for board-state),
// maps outcomes to exit codes, and enforces the deadline.
// ---------------------------------------------------------------------------
/**
 * @param {string} name
 * @param {(ctx:{argv:string[],env:object}) => Promise<{lines?:string[], summary:object, code:0|1}>} fn
 * @param {{argv?:string[], env?:object, out?:(s:string)=>void, exit?:(n:number)=>void, deadlineMs?:number|null, silentOnError?:boolean, summaryFn?:(f:object)=>string}} [opts]
 */
export async function runCli(name, fn, opts = {}) {
  const { argv = process.argv.slice(2), env = process.env, out = (s) => process.stdout.write(`${s}\n`), exit = (n) => process.exit(n),
    deadlineMs = DEFAULT_DEADLINE_MS, silentOnError = false, summaryFn = (f) => summaryLine(name, f) } = opts;
  let timer = null;
  const fail = (e) => {
    const reason = e instanceof SetupError ? e.reason : 'error';
    if (!silentOnError) {
      out(`${name}: error: ${redact(e?.message ?? e)}`);
      out(summaryLine(name, { status: 'error', reason }));
    }
    exit(2);
  };
  if (deadlineMs) {
    timer = setTimeout(() => fail(new SetupError('deadline exceeded', 'timeout')), deadlineMs);
    timer.unref?.();
  }
  try {
    const r = await fn({ argv, env });
    if (timer) clearTimeout(timer);
    for (const l of r.lines ?? []) out(redact(l));
    out(redact(summaryFn(r.summary)));
    exit(r.code);
  } catch (e) {
    if (timer) clearTimeout(timer);
    fail(e);
  }
}

/** Minutes between two instants, whole, never negative. */
export const minutesBetween = (a, b) => Math.max(0, Math.floor((new Date(b).getTime() - new Date(a).getTime()) / 60_000));

/** Where the repo lives on the crew host (data-queue.md, docs). CREW_REPO overrides. */
export function repoRoot(env = process.env, here = import.meta.dirname) {
  const cands = [env.CREW_REPO, join(here, '..', '..'), join(homedir(), 'crew', 'worktrees', 'sportsvyn-main')].filter(Boolean);
  const hit = cands.find((c) => existsSync(join(c, 'docs', 'crew', 'data-queue.md')));
  if (!hit) throw new SetupError('repo checkout with docs/crew/data-queue.md not found (set CREW_REPO)', 'no-repo');
  return hit;
}
