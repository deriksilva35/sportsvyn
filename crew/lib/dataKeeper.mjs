// crew/lib/dataKeeper.mjs - data-keeper: DRY RUN ONLY of the top unchecked job in docs/crew/data-queue.md.
//
// It runs the job's EXISTING script with the job's dry-run command, as `node scripts/<x>.mjs <args>`
// from the repo checkout, with DATABASE_URL = CREW_READER_URL (the read-only crew_reader role, so a
// script that tried to write would be refused by the database as well as by this file). It never
// passes an apply flag: a queue entry whose dry-run command carries one is refused (exit 2), and the
// apply command is only PRINTED for Derik to run by hand.
//
// Output: counts before/after, 10 sample rows, the dry-run file path, `APPLY: <command>`, SUMMARY.
// Exit 1 when the data contradicts itself (see contradictions()).
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { parseArgs, requireReaderUrl, readToken, redact, repoRoot, SetupError } from './common.mjs';
import { query, num } from './db.mjs';

export const JOB_TIMEOUT_MS = 20 * 60_000;
export const SAMPLE_ROWS = 10;

// ---------------------------------------------------------------------------
// The queue. PURE.
// ---------------------------------------------------------------------------
/** `- [ ] **title**` + indented `key: value` lines -> [{ checked, title, id, fields }]. */
export function parseQueue(md) {
  const jobs = [];
  let cur = null;
  for (const line of String(md).split('\n')) {
    const head = line.match(/^- \[( |x|X)\]\s+\*\*(.+?)\*\*/);
    if (head) {
      cur = { checked: head[1] !== ' ', title: head[2].trim(), id: head[2].trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''), fields: {} };
      jobs.push(cur);
      continue;
    }
    const f = cur && line.match(/^\s+-\s+([a-z-]+):\s*(.+?)\s*$/);
    if (f) cur.fields[f[1]] = f[2].replace(/^`(.*)`$/, '$1');
  }
  return jobs;
}

export const topUnchecked = (jobs) => jobs.find((j) => !j.checked) ?? null;

/** PURE. `node scripts/x.mjs a b` -> argv for spawn, or throws. Refuses any apply flag and anything but a repo script. */
export function dryRunArgv(cmd) {
  const t = String(cmd ?? '').trim().split(/\s+/);
  if (t[0] !== 'node' || !/^scripts\/[A-Za-z0-9._-]+\.mjs$/.test(t[1] ?? '')) throw new SetupError('dry-run must be `node scripts/<name>.mjs ...`', 'not_found', 'data-queue');
  const rest = t.slice(2);
  if (rest.some((a) => /apply/i.test(a))) throw new SetupError('the dry-run command carries an apply flag: refused', 'not_found', 'data-queue');
  if (rest.some((a) => !/^[A-Za-z0-9=_.:,/-]+$/.test(a))) throw new SetupError('dry-run argument not allowed', 'not_found', 'data-queue');
  return [t[1], ...rest];
}

// ---------------------------------------------------------------------------
// Parsers, one per script (named by the queue's `parser:` field). PURE.
// ---------------------------------------------------------------------------
const PARSERS = {
  // TOTALS 2000-2001: rows=.. exact=.. created=.. ambiguous=.. defenseOnly=.. gamesConflict=..
  // gamesConflict > 0 means two sources disagree on games played for the same player-season.
  'footballdb-import': (out) => {
    const totals = out.match(/^TOTALS .*?gamesConflict=(\d+)/m);
    const written = [...out.matchAll(/^\s+written=(\d+)/gm)].reduce((a, m) => a + Number(m[1]), 0);
    return { wouldChange: written, gamesConflict: totals ? Number(totals[1]) : 0, parsed: !!totals };
  },
  // SUMMARY lines: `  epl  none 20 -> 0   primary-only/half 0 -> 0   fill 20   unfilled 0`
  'team-colours-fill': (out) => {
    let before = 0; let after = 0; let fill = 0; let seen = 0;
    for (const m of out.matchAll(/^\s+(cfb|epl)\s+none (\d+) -> (\d+)\s+primary-only\/half (\d+) -> (\d+)\s+fill (\d+)/gm)) {
      seen++; before += Number(m[2]) + Number(m[4]); after += Number(m[3]) + Number(m[5]); fill += Number(m[6]);
    }
    return { before, after, wouldChange: fill, parsed: seen > 0 };
  },
};

/** PURE. Lines that say the data disagrees with itself. */
export function contradictions(out, parsed) {
  const found = [...String(out).matchAll(/^\s*(CONTRADICTION|CONFLICT)\b.*$/gim)].map((m) => m[0].trim());
  if (parsed?.gamesConflict > 0) found.push(`gamesConflict=${parsed.gamesConflict}`);
  return found;
}

/** PURE. First n lines matching the job's sample regex. */
export function sampleRows(out, pattern, n = SAMPLE_ROWS) {
  let re; try { re = new RegExp(pattern ?? '^\\s+\\S'); } catch { re = /^\s+\S/; }
  return String(out).split('\n').filter((l) => re.test(l)).slice(0, n);
}

/** PURE. Everything the report needs from one finished dry run. */
export function assess(job, out, rowsBeforeDb = null) {
  const parser = PARSERS[job.fields.parser];
  if (!parser) throw new SetupError(`unknown parser "${job.fields.parser ?? ''}" for job ${job.id}`, 'not_found', 'data-queue');
  const p = parser(out);
  if (!p.parsed) throw new SetupError('the dry-run output has no totals line this parser knows', 'not_found', 'dry-run-totals');
  const rowsBefore = p.before ?? rowsBeforeDb;
  const rowsAfter = p.after ?? (rowsBefore === null ? null : Math.max(rowsBefore, p.wouldChange));
  const bad = contradictions(out, p);
  return { rowsBefore, rowsAfter, wouldChange: p.wouldChange, contradictions: bad, samples: sampleRows(out, job.fields.sample) };
}

// ---------------------------------------------------------------------------
// Running it.
// ---------------------------------------------------------------------------
function runScript(root, argv, env, timeoutMs) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, argv, { cwd: root, env, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    const kill = setTimeout(() => child.kill('SIGKILL'), timeoutMs);
    child.stdout.on('data', (d) => { out += d; });
    child.stderr.on('data', (d) => { out += d; });
    child.on('close', (code) => { clearTimeout(kill); resolve({ code, out }); });
    child.on('error', (e) => { clearTimeout(kill); resolve({ code: 127, out: String(e.message) }); });
  });
}

/** Rows already in the table the footballdb job writes, for the seasons in its command. */
async function footballdbRowsBefore(url, cmdArgs) {
  const m = cmdArgs.find((a) => /^\d{4}(-\d{4})?$/.test(a));
  if (!m) return null;
  const [lo, hi] = m.includes('-') ? m.split('-').map(Number) : [Number(m), Number(m)];
  const [r] = await query(url, 'SELECT count(*)::int AS n FROM nfl_player_season_totals WHERE season_year BETWEEN $1 AND $2', [lo, hi]);
  return num(r?.n);
}

export async function main({ argv, env }) {
  parseArgs(argv, []);
  const url = requireReaderUrl(env);
  const root = repoRoot(env);
  const jobs = parseQueue(readFileSync(join(root, 'docs', 'crew', 'data-queue.md'), 'utf8'));
  const job = topUnchecked(jobs);
  if (!job) return { lines: ['data queue is empty: nothing to do'], summary: { status: 'ok', job: '-', rows_before: '-', rows_after: '-', would_change: '-', dry_run: '-' }, code: 0 };

  const argvJob = dryRunArgv(job.fields['dry-run']);
  if (!job.fields.apply) throw new SetupError(`job ${job.id} has no apply command to hand to Derik`, 'not_found', 'data-queue');
  if (!existsSync(join(root, argvJob[0]))) throw new SetupError(`script ${argvJob[0]} not found in the checkout`, 'not_found', 'data-queue');

  const childEnv = { PATH: env.PATH ?? '/usr/bin:/bin', HOME: env.HOME ?? homedir(), DATABASE_URL: url };
  const cfbd = readToken('cfbd.token', env);
  if (cfbd) childEnv.CFBD_API_KEY = cfbd;

  const { code, out } = await runScript(root, argvJob, childEnv, env.CREW_JOB_TIMEOUT_MS ? Number(env.CREW_JOB_TIMEOUT_MS) : JOB_TIMEOUT_MS);
  const clean = redact(out);
  const dir = env.CREW_DATA_DIR || join(homedir(), 'crew', 'data');
  mkdirSync(dir, { recursive: true });
  const file = join(dir, `${new Date().toISOString().slice(0, 10)}-${job.id}.txt`);
  writeFileSync(file, `# ${job.title}\n# dry run: ${job.fields['dry-run']}\n# exit: ${code}\n\n${clean}`);
  if (code !== 0) throw new SetupError(`job script exited ${code}; full output in ${file}`, 'unreachable', 'dry-run');

  let before = null;
  if (job.fields.parser === 'footballdb-import') before = await footballdbRowsBefore(url, argvJob.slice(1));
  const a = assess(job, clean, before);
  const bad = a.contradictions.length > 0;
  const lines = [
    `job: ${job.title}`,
    `counts: before=${a.rowsBefore ?? '-'} after=${a.rowsAfter ?? '-'} would_change=${a.wouldChange}`,
    `sample rows (${a.samples.length} of ${SAMPLE_ROWS}):`,
    ...a.samples.map((s) => `  ${s.trim()}`),
    ...(bad ? ['CONTRADICTIONS:', ...a.contradictions.map((c) => `  ${c}`)] : []),
    `dry run output: ${file}`,
    `APPLY: ${job.fields.apply}`,
  ];
  return {
    lines,
    summary: { status: bad ? 'regression' : 'ok', job: job.id, rows_before: a.rowsBefore ?? '-', rows_after: a.rowsAfter ?? '-', would_change: a.wouldChange, dry_run: file },
    code: bad ? 1 : 0,
  };
}
