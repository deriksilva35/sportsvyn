// crew/lib/common.mjs - shared by crew/bin/* (CrewOS watcher + data-keeper scripts).
//
// THE CONTRACT (crew/README.md): no secret ever printed; exit 0 ok / 1 regression / 2 setup
// error; the LAST stdout line is one `SUMMARY <name> k=v ...` (board-state excepted); every
// network call has a timeout; READ ONLY. This file holds the parts every script shares so
// that none of them can drift from the contract on its own.
import { readFileSync, existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

export const ERROR_KINDS = Object.freeze(['unreachable', 'auth', 'not_found', 'timeout']);

/** The caller asked for something the script does not take, or a secret/API is missing. -> exit 2.
 *  kind is one of ERROR_KINDS; host names WHAT failed (an API/DB hostname, a secret file name, or a
 *  local label such as `args`). The runner prints `status=error reason=<kind>:<host>`; message is
 *  the human line (redacted) and never reaches the SUMMARY. */
export class SetupError extends Error {
  constructor(message, kind = 'unreachable', host = 'local') {
    super(message); this.name = 'SetupError';
    this.kind = ERROR_KINDS.includes(kind) ? kind : 'unreachable';
    this.host = String(host || 'local').replace(/[^A-Za-z0-9._-]/g, '_');
  }
  get reason() { return `${this.kind}:${this.host}`; }
}

const hostOf = (url) => { try { return new URL(url).host; } catch { return 'unknown'; } };
const isTimeout = (e) => e?.name === 'TimeoutError' || e?.name === 'AbortError';
/** Network-level failure -> SetupError: timeout (incl. while reading a body) or unreachable. */
export function networkError(e, label, host) {
  return new SetupError(redact(`${label} ${isTimeout(e) ? 'timed out' : `unreachable: ${e?.message ?? e}`}`), isTimeout(e) ? 'timeout' : 'unreachable', host);
}
/** HTTP status -> SetupError: 401/403 auth, 404 not_found, anything else (5xx, 429, ...) unreachable. */
export function statusError(status, label, host) {
  const kind = status === 401 || status === 403 ? 'auth' : status === 404 ? 'not_found' : 'unreachable';
  return new SetupError(redact(`${label} HTTP ${status}`), kind, host);
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
  if (!url) throw new SetupError('CREW_READER_URL is not set in crew-reader.env (secrets dir)', 'auth', 'crew-reader.env');
  try {
    const u = new URL(url);
    if (u.password) rememberSecret(decodeURIComponent(u.password));
    rememberSecret(url);
  } catch { throw new SetupError('CREW_READER_URL is not a valid URL', 'auth', 'crew-reader.env'); }
  return url;
}

/** host = the API this token would have called (reason=auth:<host>). */
export function requireToken(file, label, env = process.env, host = file) {
  const t = readToken(file, env);
  if (!t) throw new SetupError(`${label} is not set (${file} in the secrets dir)`, 'auth', host);
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
  if (argv.length > specs.length) throw new SetupError(`unexpected argument (takes ${specs.length})`, 'not_found', 'args');
  return specs.map((s, i) => {
    if (argv[i] === undefined) return s.default;
    if (!/^\d{1,6}$/.test(argv[i])) throw new SetupError(`${s.name} must be a whole number`, 'not_found', 'args');
    const n = Number(argv[i]);
    if (n < (s.min ?? 1) || n > (s.max ?? 10_080)) throw new SetupError(`${s.name} out of range ${s.min ?? 1}-${s.max ?? 10_080}`, 'not_found', 'args');
    return n;
  });
}

// ---------------------------------------------------------------------------
// HTTP with a timeout on every call. Errors are redacted.
// ---------------------------------------------------------------------------
export async function fetchJson(url, { method = 'GET', headers = {}, body, timeoutMs = HTTP_TIMEOUT_MS, fetchImpl = fetch, label = 'request' } = {}) {
  const host = hostOf(url);
  let text;
  try {
    const res = await fetchImpl(url, { method, headers, body, signal: AbortSignal.timeout(timeoutMs) });
    text = await res.text(); // inside the try: the timeout can fire while the body is read
    if (!res.ok) throw statusError(res.status, label, host);
  } catch (e) {
    throw e instanceof SetupError ? e : networkError(e, label, host);
  }
  try { return text ? JSON.parse(text) : null; } catch { throw new SetupError(`${label} returned non-JSON`, 'unreachable', host); }
}

/** Like fetchJson but returns the body text. */
export async function fetchText(url, { headers = {}, timeoutMs = HTTP_TIMEOUT_MS, fetchImpl = fetch, label = 'request' } = {}) {
  const host = hostOf(url);
  try {
    const res = await fetchImpl(url, { headers, signal: AbortSignal.timeout(timeoutMs) });
    if (!res.ok) throw statusError(res.status, label, host);
    return await res.text();
  } catch (e) {
    throw e instanceof SetupError ? e : networkError(e, label, host);
  }
}

/** Stream a (possibly huge) text body line by line into onLine(line); memory stays flat. The one
 *  timeout covers connect, headers AND the whole body read. */
export async function fetchLines(url, onLine, { headers = {}, timeoutMs = HTTP_TIMEOUT_MS, fetchImpl = fetch, label = 'request' } = {}) {
  const host = hostOf(url);
  try {
    const res = await fetchImpl(url, { headers, signal: AbortSignal.timeout(timeoutMs) });
    if (!res.ok) throw statusError(res.status, label, host);
    if (!res.body?.getReader) { for (const l of (await res.text()).split('\n')) onLine(l); return; }
    const reader = res.body.getReader();
    const dec = new TextDecoder();
    let rest = '';
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      rest += dec.decode(value, { stream: true });
      let nl;
      while ((nl = rest.indexOf('\n')) >= 0) { onLine(rest.slice(0, nl)); rest = rest.slice(nl + 1); }
    }
    rest += dec.decode();
    if (rest) onLine(rest);
  } catch (e) {
    throw e instanceof SetupError ? e : networkError(e, label, host);
  }
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
    const reason = e instanceof SetupError ? e.reason : 'unreachable:internal';
    if (!silentOnError) {
      out(`${name}: error: ${redact(e?.message ?? e)}`);
      out(summaryLine(name, { status: 'error', reason }));
    }
    exit(2);
  };
  if (deadlineMs) {
    timer = setTimeout(() => fail(new SetupError('deadline exceeded', 'timeout', 'deadline')), deadlineMs);
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
  if (!hit) throw new SetupError('repo checkout with docs/crew/data-queue.md not found (set CREW_REPO)', 'not_found', 'repo');
  return hit;
}
