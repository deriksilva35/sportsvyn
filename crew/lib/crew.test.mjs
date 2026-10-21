// crew/lib/crew.test.mjs - the crew/bin contract (crew-bin). No network, no ~/crew, no live API:
// pure formatters on fixtures, the CLI exit-2 path against an EMPTY secrets dir, and the
// data-keeper against a throwaway repo fixture in a temp dir.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, mkdirSync, readFileSync, existsSync, statSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { summaryLine, redact, parseArgs, runCli, SetupError, rememberSecret, readToken, readEnvKey, val, usd } from './common.mjs';
import { buildRequest, READ_ONLY_PREAMBLE } from './db.mjs';
import * as appErrors from './appErrors.mjs';
import * as retention from './retentionStatus.mjs';
import * as providers from './providerHealth.mjs';
import * as board from './boardState.mjs';
import * as deploy from './latestDeploy.mjs';
import * as vercelErrors from './vercelErrors.mjs';
import * as cf from './cfTop.mjs';
import * as cost from './costWatch.mjs';
import * as keeper from './dataKeeper.mjs';
import { SCRIPTS } from './cli.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..');
const BIN = path.join(ROOT, 'crew', 'bin');
const tmp = (p) => mkdtempSync(path.join(tmpdir(), `crew-${p}-`));

// ---- the SUMMARY formats, exactly -------------------------------------------------------------
const FORMATS = {
  'app-errors': /^SUMMARY app-errors status=(ok|regression) window_min=\d+ errors=\d+ new_hashes=\d+ top_source=\S+$/,
  'vercel-errors': /^SUMMARY vercel-errors status=(ok|regression) window_min=\d+ errors_5xx=\d+ routes=\d+ top_route=\S+$/,
  'cf-top': /^SUMMARY cf-top status=ok window_min=\d+ requests=\d+ blocked=\d+ challenged=\d+ top_asn=\S+ top_path=\S+$/,
  'retention-status': /^SUMMARY retention-status status=(ok|regression) tables=\d+ overdue=\d+ largest=[a-z_]+:\d+$/,
  'provider-health': /^SUMMARY provider-health status=(ok|regression) providers=\d+ stale=\d+ stalest=(-|[a-z]+:(\d+|never))$/,
  'cost-watch': /^SUMMARY cost-watch status=(ok|regression) vercel_usd_mtd=(-|\d+\.\d\d) neon_usd_mtd=(-|\d+\.\d\d) resend_sent_mtd=(-|\d+) pace=(ok|over)$/,
  'latest-deploy': /^SUMMARY latest-deploy status=(ok|regression) deploy_id=\S+ state=(READY|ERROR|BUILDING|CANCELED|-) commit=\S+ created=\S+$/,
  'data-keeper': /^SUMMARY data-keeper status=(ok|regression) job=\S+ rows_before=\S+ rows_after=\S+ would_change=\S+ dry_run=\S+$/,
};

test('summaryLine: key=value, no spaces in values, empty is "-"', () => {
  assert.equal(summaryLine('x', { a: 1, b: '', c: null, d: 'two words', e: undefined, f: NaN }), 'SUMMARY x a=1 b=- c=- d=two_words e=- f=-');
  assert.equal(val(0), '0');
  assert.equal(usd(null), '-');
  assert.equal(usd(0), '0.00', 'a KNOWN zero is 0.00; only unknown is "-"');
});

test('app-errors: new_hashes>0 is a regression (exit 1); top_source is the busiest service', () => {
  const ok = appErrors.summarize(60, []);
  assert.equal(ok.code, 0);
  assert.match(summaryLine('app-errors', ok.summary), FORMATS['app-errors']);
  assert.equal(ok.summary.top_source, '-');
  const bad = appErrors.summarize(60, [{ service: 'live-poller', errors: '3', new_hashes: '1' }, { service: 'daily-tick', errors: '1', new_hashes: '0' }]);
  assert.equal(bad.code, 1);
  assert.deepEqual([bad.summary.errors, bad.summary.new_hashes, bad.summary.top_source], [4, 1, 'live-poller']);
  assert.match(summaryLine('app-errors', bad.summary), FORMATS['app-errors']);
  // errors alone (a known old signature repeating) is NOT a regression.
  assert.equal(appErrors.summarize(60, [{ service: 'a', errors: 5, new_hashes: 0 }]).code, 0);
});

test('vercel-errors: any 5xx is a regression; routes and top_route; 4xx and queries ignored', () => {
  const none = vercelErrors.summarize(60, [{ statusCode: 404, requestPath: '/x' }, { statusCode: 200, requestPath: '/y' }]);
  assert.equal(none.code, 0);
  assert.equal(none.summary.top_route, '-');
  const bad = vercelErrors.summarize(60, [
    { statusCode: 500, requestPath: '/api/a?x=1' }, { statusCode: 502, requestPath: '/api/a' }, { statusCode: 503, requestPath: '/b' }, { statusCode: 404, requestPath: '/c' },
  ]);
  assert.equal(bad.code, 1);
  assert.deepEqual([bad.summary.errors_5xx, bad.summary.routes, bad.summary.top_route], [3, 2, '/api/a']);
  assert.match(summaryLine('vercel-errors', bad.summary), FORMATS['vercel-errors']);
  assert.match(summaryLine('vercel-errors', none.summary), FORMATS['vercel-errors']);
  assert.ok(vercelErrors.requestLogsUrl(30, 0, 1_000_000).includes('projectId=prj_'), 'pinned to the one project');
});

test('cf-top: always exit 0; blocked/challenged/top ASN and path from the graphql shape', () => {
  const zone = {
    total: [{ count: 1200 }],
    asn: [{ count: 400, dimensions: { clientAsn: '16509' } }],
    path: [{ count: 90, dimensions: { clientRequestPath: '/games?x=1' } }],
    fw: [{ count: 5, dimensions: { action: 'block' } }, { count: 3, dimensions: { action: 'managed_challenge' } }, { count: 2, dimensions: { action: 'js_challenge' } }, { count: 9, dimensions: { action: 'log' } }],
  };
  const r = cf.summarize(60, zone);
  assert.equal(r.code, 0);
  assert.deepEqual([r.summary.requests, r.summary.blocked, r.summary.challenged, r.summary.top_asn, r.summary.top_path], [1200, 5, 5, '16509', '/games']);
  assert.match(summaryLine('cf-top', r.summary), FORMATS['cf-top']);
  const empty = cf.summarize(60, undefined);
  assert.equal(empty.code, 0);
  assert.match(summaryLine('cf-top', empty.summary), FORMATS['cf-top']);
});

test('retention-status: overdue past keep+1 day; sessions age from expiry', () => {
  const clean = retention.summarize([
    { table_name: 'app_errors', age_days: 3, row_count: '10' }, { table_name: 'sessions', age_days: -5, row_count: '40' },
    { table_name: 'push_sends', age_days: 30, row_count: '7' },
  ]);
  assert.equal(clean.code, 0, 'exactly keep days old is not overdue');
  assert.match(summaryLine('retention-status', clean.summary), FORMATS['retention-status']);
  assert.equal(clean.summary.largest, 'sessions:40');
  const bad = retention.summarize([{ table_name: 'push_sends', age_days: 31, row_count: '5' }, { table_name: 'sessions', age_days: 60, row_count: '2' }, { table_name: 'ignored', age_days: 999, row_count: '9' }]);
  assert.equal(bad.code, 1);
  assert.deepEqual([bad.summary.tables, bad.summary.overdue], [4, 2]);
  assert.match(summaryLine('retention-status', bad.summary), FORMATS['retention-status']);
});

test('provider-health: stale only when a write is expected and older than max, or never', () => {
  const rows = [
    { provider: 'bdl', max_age_min: 30, expected: false, age_min: 99999 },
    { provider: 'cfbd', max_age_min: 60, expected: true, age_min: 59 },
    { provider: 'odds', max_age_min: 180, expected: true, age_min: 200 },
    { provider: 'ffc', max_age_min: 2280, expected: true, age_min: 100 },
    { provider: 'injuries', max_age_min: 60, expected: true, age_min: null },
  ];
  const r = providers.summarize(rows);
  assert.equal(r.code, 1);
  assert.deepEqual([r.summary.providers, r.summary.stale, r.summary.stalest], [5, 2, 'injuries:never']);
  assert.match(summaryLine('provider-health', r.summary), FORMATS['provider-health']);
  const quiet = providers.summarize(rows.slice(0, 2).concat(rows.slice(3, 4)));
  assert.equal(quiet.code, 0);
  assert.match(summaryLine('provider-health', quiet.summary), FORMATS['provider-health']);
  assert.equal(providers.summarize([{ provider: 'bdl', max_age_min: 30, expected: false, age_min: 5 }]).summary.stalest, '-');
});

test('cost-watch: pace=over only for a KNOWN figure projected past budget, after 3 days; unknown is "-"', () => {
  const day10 = cost.monthProgress(Date.UTC(2026, 9, 11)); // 10 of 31 days
  assert.ok(day10.elapsedDays >= 10 && day10.fraction > 0.3 && day10.fraction < 0.33);
  const under = cost.summarize({ vercelUsd: 10, progress: day10 });
  assert.equal(under.code, 0);
  assert.match(summaryLine('cost-watch', under.summary), FORMATS['cost-watch']);
  const over = cost.summarize({ vercelUsd: 20, resendSent: 12, progress: day10 }); // 20 / .32 = 62 > 50
  assert.equal(over.code, 1);
  assert.equal(over.summary.pace, 'over');
  assert.match(summaryLine('cost-watch', over.summary), FORMATS['cost-watch']);
  const early = cost.summarize({ vercelUsd: 49, progress: cost.monthProgress(Date.UTC(2026, 9, 2)) });
  assert.equal(early.summary.pace, 'ok', 'under 3 days in, pace is not judged');
  const unknown = cost.summarize({ vercelUsd: null, progress: day10 });
  assert.equal(unknown.summary.vercel_usd_mtd, '-');
  assert.equal(unknown.summary.pace, 'ok', 'unknown never counts as over');
  assert.equal(unknown.summary.neon_usd_mtd, '-');
  assert.match(summaryLine('cost-watch', unknown.summary), FORMATS['cost-watch']);
  const text = [JSON.stringify({ BilledCost: 1.5 }), JSON.stringify({ BilledCost: 2, Tags: { ProjectId: 'prj_other' } }), 'not json', JSON.stringify({ BilledCost: 0.25, Tags: { ProjectId: 'prj_dnWLrT1wn34YScbMwQgtGT3WYVoE' } })].join('\n');
  assert.equal(cost.sumCharges(text), 1.75, "another project's charges are excluded");
});

test('latest-deploy: ERROR is a regression; BUILDING/QUEUED fold; created is ISO8601; commit is sha7', () => {
  const d = { uid: 'dpl_abc123', state: 'READY', created: Date.UTC(2026, 9, 21, 12, 0, 5), meta: { githubCommitSha: '0123456789abcdef' } };
  const ok = deploy.summarize(d);
  assert.equal(ok.code, 0);
  assert.equal(ok.summary.commit, '0123456');
  assert.equal(ok.summary.created, '2026-10-21T12:00:05Z');
  assert.match(summaryLine('latest-deploy', ok.summary), FORMATS['latest-deploy']);
  assert.equal(deploy.summarize({ ...d, state: 'ERROR' }).code, 1);
  assert.equal(deploy.summarize({ ...d, state: 'QUEUED' }).summary.state, 'BUILDING');
  assert.equal(deploy.summarize({ ...d, state: 'INITIALIZING' }).summary.state, 'BUILDING');
  assert.match(summaryLine('latest-deploy', deploy.summarize({ ...d, state: 'ERROR' }).summary), FORMATS['latest-deploy']);
  assert.match(summaryLine('latest-deploy', deploy.summarize(undefined).summary), FORMATS['latest-deploy']);
});

// ---- board-state -----------------------------------------------------------------------------
test('board-state decide(): locks_in:<m> within 120 min, else open, else closed', () => {
  assert.equal(board.decide({ openCount: 0, minToLock: null }), 'closed');
  assert.equal(board.decide({ openCount: 0, minToLock: 5 }), 'closed', 'no open board outranks any lock time');
  assert.equal(board.decide({ openCount: 3, minToLock: 45 }), 'locks_in:45');
  assert.equal(board.decide({ openCount: 1, minToLock: 120 }), 'locks_in:120', '120 is inside');
  assert.equal(board.decide({ openCount: 1, minToLock: 121 }), 'open');
  assert.equal(board.decide({ openCount: 2, minToLock: null }), 'open', 'boards with no lock time stay open');
  assert.equal(board.decide({ openCount: 1, minToLock: 0 }), 'locks_in:0');
  for (const s of ['closed', 'open', 'locks_in:7']) assert.match(s, /^(closed|open|locks_in:\d+)$/);
});

test('board-state through runCli: success prints ONE line; a setup error prints nothing at all', async () => {
  const out = []; let code;
  await runCli('board-state', async () => ({ lines: [], summary: 'locks_in:9', code: 0 }), { argv: [], out: (s) => out.push(s), exit: (n) => { code = n; }, silentOnError: true, summaryFn: (s) => s, deadlineMs: null });
  assert.deepEqual(out, ['locks_in:9']);
  assert.equal(code, 0);
  const out2 = []; let code2;
  await runCli('board-state', async () => { throw new SetupError('boom'); }, { argv: [], out: (s) => out2.push(s), exit: (n) => { code2 = n; }, silentOnError: true, summaryFn: (s) => s, deadlineMs: null });
  assert.deepEqual(out2, []);
  assert.equal(code2, 2);
});

// ---- the contract: setup errors, secrets never printed --------------------------------------
const run = (name, args, env) => spawnSync(process.execPath, [path.join(BIN, name), ...args], {
  encoding: 'utf8', env: { PATH: process.env.PATH, HOME: process.env.HOME, ...env }, timeout: 15_000,
});

test('every script with NO secrets: exit 2, SUMMARY status=error last (board-state: nothing at all)', () => {
  const dir = tmp('empty');
  for (const name of Object.keys(SCRIPTS)) {
    const r = run(name, [], { CREW_SECRETS_DIR: dir });
    assert.equal(r.status, 2, `${name} exit`);
    if (name === 'board-state') { assert.equal(r.stdout, '', 'board-state stdout'); assert.equal(r.stderr, '', 'board-state stderr'); continue; }
    const lines = r.stdout.trimEnd().split('\n');
    assert.match(lines.at(-1), new RegExp(`^SUMMARY ${name} status=error reason=\\S+$`), `${name} last line`);
  }
  rmSync(dir, { recursive: true });
});

test('every script rejects an unlisted argument with exit 2 (before touching any secret)', () => {
  const dir = tmp('args');
  for (const name of Object.keys(SCRIPTS)) {
    const r = run(name, ['--apply'], { CREW_SECRETS_DIR: dir });
    assert.equal(r.status, 2, name);
    assert.ok(!/--apply/.test(r.stdout.split('\n').at(-2) ?? ''), name);
  }
  assert.equal(run('retention-status', ['5'], { CREW_SECRETS_DIR: dir }).status, 2, 'takes no args');
  assert.equal(run('app-errors', ['0'], { CREW_SECRETS_DIR: dir }).status, 2, 'window_min >= 1');
  assert.equal(run('app-errors', ['1', '2'], { CREW_SECRETS_DIR: dir }).status, 2, 'one arg at most');
  rmSync(dir, { recursive: true });
});

test('a DB script with an unreachable URL and a recognisable fake password never prints either', () => {
  const dir = tmp('fake');
  const PW = 'FAKEPASSWORD_zq81hx3Kd0';
  writeFileSync(path.join(dir, 'crew-reader.env'), `CREW_READER_URL="postgres://crew_reader:${PW}@127.0.0.1:1/neondb"\n`);
  for (const name of ['app-errors', 'retention-status', 'provider-health', 'board-state']) {
    const r = run(name, [], { CREW_SECRETS_DIR: dir });
    assert.equal(r.status, 2, `${name} (unreachable DB)`);
    const all = r.stdout + r.stderr;
    assert.ok(!all.includes(PW), `${name} leaked the password`);
    assert.ok(!/postgres:\/\//.test(all), `${name} printed a URL`);
    if (name !== 'board-state') assert.match(r.stdout.trimEnd().split('\n').at(-1), /^SUMMARY \S+ status=error reason=\S+$/);
  }
  rmSync(dir, { recursive: true });
});

test('runCli redacts a secret that leaks into an error message (token files and URLs)', async () => {
  const dir = tmp('leak');
  const TOKEN = 'FAKETOKEN_vcl_9a8b7c6d5e4f';
  writeFileSync(path.join(dir, 'vercel.token'), `${TOKEN}\n`);
  const env = { CREW_SECRETS_DIR: dir };
  const out = []; let code;
  await runCli('latest-deploy', async () => {
    const t = readToken('vercel.token', env);
    throw new Error(`upstream said Bearer ${t} and https://user:${t}@host/x and ${t}`);
  }, { argv: [], env, out: (s) => out.push(s), exit: (n) => { code = n; }, deadlineMs: null });
  assert.equal(code, 2);
  assert.ok(!out.join('\n').includes(TOKEN));
  assert.match(out.at(-1), /^SUMMARY latest-deploy status=error reason=error$/);
  // success-path lines are scrubbed too
  const out2 = [];
  await runCli('x', async () => ({ lines: [`token is ${TOKEN}`], summary: { status: 'ok' }, code: 0 }), { argv: [], env, out: (s) => out2.push(s), exit: () => {}, deadlineMs: null });
  assert.ok(!out2.join('\n').includes(TOKEN));
  rmSync(dir, { recursive: true });
});

test('redact(): URL passwords, bearer tokens, remembered secrets', () => {
  rememberSecret('s3cr3t-value-123');
  const r = redact('postgres://u:hunter2pass@h/db Authorization: Bearer abcdefghij12345 s3cr3t-value-123');
  assert.ok(!/hunter2pass|abcdefghij12345|s3cr3t-value-123/.test(r), r);
});

test('secret files: bare token, KEY=token, env-file key; a missing file is null', () => {
  const dir = tmp('files'); const env = { CREW_SECRETS_DIR: dir };
  writeFileSync(path.join(dir, 'a.token'), '  tok_AAAAAA  \n');
  writeFileSync(path.join(dir, 'b.token'), 'VERCEL_TOKEN="tok_BBBBBB"\n');
  writeFileSync(path.join(dir, 'x.env'), '# c\nOTHER=1\nexport CREW_READER_URL=postgres://u:p@h/d\n');
  assert.equal(readToken('a.token', env), 'tok_AAAAAA');
  assert.equal(readToken('b.token', env), 'tok_BBBBBB');
  assert.equal(readToken('nope.token', env), null);
  assert.equal(readEnvKey('x.env', 'CREW_READER_URL', env), 'postgres://u:p@h/d');
  assert.equal(readEnvKey('x.env', 'MISSING', env), null);
  rmSync(dir, { recursive: true });
});

test('parseArgs: defaults, bounds, extras', () => {
  const spec = [{ name: 'window_min', default: 60, min: 1, max: 1440 }];
  assert.deepEqual(parseArgs([], spec), [60]);
  assert.deepEqual(parseArgs(['15'], spec), [15]);
  for (const bad of [['0'], ['1441'], ['x'], ['1', '2'], ['-5'], ['1.5']]) assert.throws(() => parseArgs(bad, spec), SetupError);
  assert.throws(() => parseArgs(['1'], []), SetupError);
});

// ---- read-only database guard ----------------------------------------------------------------
test('db request: read-only preamble first, read-only batch header, no secret in the body', () => {
  const url = 'postgres://crew_reader:PW_not_in_body@ep-x-pooler.us-east-1.aws.neon.tech/neondb?sslmode=require';
  const { endpoint, init } = buildRequest(url, 'SELECT 1', [], 8000);
  assert.equal(endpoint, 'https://ep-x-pooler.us-east-1.aws.neon.tech/sql');
  const body = JSON.parse(init.body);
  assert.equal(body.queries[0].query, READ_ONLY_PREAMBLE);
  assert.match(READ_ONLY_PREAMBLE, /default_transaction_read_only = on/);
  assert.equal(body.queries.at(-1).query, 'SELECT 1');
  assert.equal(init.headers['Neon-Batch-Read-Only'], 'true');
  assert.ok(!init.body.includes('PW_not_in_body'));
});

// ---- the registry ----------------------------------------------------------------------------
test('every script has a bin shim, is executable, and is in the registry; dispatch passes digits only', () => {
  for (const name of Object.keys(SCRIPTS)) {
    const p = path.join(BIN, name);
    assert.ok(existsSync(p), name);
    assert.ok((statSync(p).mode & 0o111) !== 0, `${name} is executable`);
    assert.match(readFileSync(p, 'utf8'), new RegExp(`m\\.run\\("${name}"\\)`));
  }
  assert.match(readFileSync(path.join(BIN, 'dispatch'), 'utf8'), /\^\[0-9\]\+\$/);
  assert.equal(Object.keys(SCRIPTS).length, 9);
});
// ---- data-keeper -------------------------------------------------------------------------------
const QUEUE = (dry = 'node scripts/fake-dry.mjs', second = '') => `# queue

- [x] **already done**
  - dry-run: \`node scripts/should-not-run.mjs\`
  - apply: \`node scripts/should-not-run.mjs --apply\`
  - parser: team-colours-fill

- [ ] **team-colours recheck**
  - script: scripts/fake-dry.mjs
  - dry-run: \`${dry}\`
  - apply: \`DATABASE_URL="$PROD_DATABASE_URL" node scripts/fake-dry.mjs --apply\`
  - parser: team-colours-fill
  - sample: \`^\\s+(FILL|UNFILLED)\\s\`
${second}
- [ ] **second job**
  - dry-run: \`node scripts/second.mjs\`
  - apply: \`node scripts/second.mjs --apply\`
  - parser: team-colours-fill
`;

const FAKE_OUT = [
  '  FILL  cfb  Team A',
  ...Array.from({ length: 14 }, (_, i) => `  FILL  epl  Team ${i}`),
  '',
  'SUMMARY (dry run, fingerprint abc)',
  '  cfb  none 12 -> 0   primary-only/half 1 -> 2   fill 12   unfilled 0',
  '  epl  none 8 -> 0   primary-only/half 0 -> 0   fill 8   unfilled 0',
].join('\n');

function fixtureRepo({ queue = QUEUE(), body = FAKE_OUT, exit = 0 } = {}) {
  const repo = tmp('repo');
  mkdirSync(path.join(repo, 'docs', 'crew'), { recursive: true });
  mkdirSync(path.join(repo, 'scripts'), { recursive: true });
  writeFileSync(path.join(repo, 'docs', 'crew', 'data-queue.md'), queue);
  writeFileSync(path.join(repo, 'scripts', 'fake-dry.mjs'),
    `import { writeFileSync } from 'node:fs';\nwriteFileSync(new URL('./ran.txt', import.meta.url), process.argv.slice(2).join(' ') + '|' + (process.env.DATABASE_URL ? 'db' : 'nodb') + '|' + (process.env.PROD_DATABASE_URL ? 'prod' : 'noprod'));\nconsole.log(${JSON.stringify(body)});\nprocess.exit(${exit});\n`);
  writeFileSync(path.join(repo, 'scripts', 'second.mjs'), 'throw new Error("must not run");\n');
  writeFileSync(path.join(repo, 'scripts', 'should-not-run.mjs'), 'throw new Error("checked job must not run");\n');
  const secrets = tmp('sec'); const data = tmp('data');
  writeFileSync(path.join(secrets, 'crew-reader.env'), 'CREW_READER_URL=postgres://crew_reader:FAKEPW_kd77abc@127.0.0.1:1/db\n');
  return { repo, secrets, data, env: { CREW_REPO: repo, CREW_SECRETS_DIR: secrets, CREW_DATA_DIR: data, PATH: process.env.PATH, HOME: process.env.HOME } };
}

test('data-keeper queue: parses checkboxes, takes the TOP UNCHECKED job, ids are slugs', () => {
  const jobs = keeper.parseQueue(QUEUE());
  assert.deepEqual(jobs.map((j) => [j.checked, j.id]), [[true, 'already-done'], [false, 'team-colours-recheck'], [false, 'second-job']]);
  assert.equal(keeper.topUnchecked(jobs).id, 'team-colours-recheck');
  assert.equal(keeper.topUnchecked(jobs).fields['dry-run'], 'node scripts/fake-dry.mjs');
  assert.equal(keeper.topUnchecked(keeper.parseQueue('- [x] **only**\n  - dry-run: `node scripts/a.mjs`\n')), null);
});

test('the real docs/crew/data-queue.md: three jobs in order, existing scripts, dry-run with no apply flag, known parsers', () => {
  const jobs = keeper.parseQueue(readFileSync(path.join(ROOT, 'docs', 'crew', 'data-queue.md'), 'utf8'));
  assert.deepEqual(jobs.map((j) => j.title), ['daily-season-backfill 2000-2001', 'daily-season-backfill 1997-1999', 'team-colours recheck']);
  assert.equal(keeper.topUnchecked(jobs).title, 'daily-season-backfill 2000-2001');
  for (const j of jobs) {
    const argv = keeper.dryRunArgv(j.fields['dry-run']); // throws on an apply flag or a non-script
    assert.ok(existsSync(path.join(ROOT, argv[0])), `${argv[0]} exists`);
    assert.equal(j.fields.script, argv[0]);
    assert.match(j.fields.apply, /--apply/);
    assert.ok(j.fields.apply.includes(argv[0]), 'apply runs the same script');
    assert.ok(!/apply/i.test(j.fields['dry-run']));
    assert.ok(['footballdb-import', 'team-colours-fill'].includes(j.fields.parser));
    assert.ok(j.fields.sample);
  }
});

test('dryRunArgv: only `node scripts/<x>.mjs ...`; any apply flag is refused', () => {
  assert.deepEqual(keeper.dryRunArgv('node scripts/footballdb-import.mjs 2000-2001'), ['scripts/footballdb-import.mjs', '2000-2001']);
  for (const bad of ['node scripts/x.mjs --apply', 'node scripts/x.mjs --APPLY', 'node scripts/x.mjs --prod --apply', 'bash -c x', 'node ../x.mjs', 'node scripts/x.mjs; rm -rf /', 'node scripts/x.mjs $(id)', '', undefined]) {
    assert.throws(() => keeper.dryRunArgv(bad), SetupError, String(bad));
  }
});

test('data-keeper runs ONLY the dry-run command, with DATABASE_URL set to the reader, writes the dry-run file, prints APPLY last-but-one', async () => {
  const f = fixtureRepo();
  const out = []; let code;
  await runCli('data-keeper', keeper.main, { argv: [], env: f.env, out: (s) => out.push(s), exit: (n) => { code = n; }, deadlineMs: null });
  assert.equal(code, 0, out.join('\n'));
  const text = out.join('\n');
  const last = out.at(-1);
  assert.match(last, FORMATS['data-keeper']);
  assert.match(last, /job=team-colours-recheck rows_before=21 rows_after=2 would_change=20 /);
  assert.match(out.at(-2), /^APPLY: DATABASE_URL="\$PROD_DATABASE_URL" node scripts\/fake-dry\.mjs --apply$/);
  assert.ok(out.some((l) => l.startsWith('dry run output: ')));
  const samples = out.filter((l) => /^ {2}FILL /.test(l));
  assert.equal(samples.length, 10, '10 sample rows');
  assert.ok(!text.includes('FAKEPW_kd77abc'), 'no secret in the output');
  const ran = readFileSync(path.join(f.repo, 'scripts', 'ran.txt'), 'utf8');
  assert.equal(ran, '|db|noprod', 'no argument at all (so no apply flag); reader URL as DATABASE_URL only');
  const file = last.match(/dry_run=(\S+)/)[1];
  assert.ok(file.startsWith(f.data) && /\d{4}-\d{2}-\d{2}-team-colours-recheck\.txt$/.test(file));
  assert.ok(readFileSync(file, 'utf8').includes('SUMMARY (dry run'));
});

test('data-keeper: data that contradicts itself is a regression (exit 1)', async () => {
  const f = fixtureRepo({ body: `${FAKE_OUT}\nCONFLICT: two colour sources disagree for Team A (#112233 vs #445566)` });
  const out = []; let code;
  await runCli('data-keeper', keeper.main, { argv: [], env: f.env, out: (s) => out.push(s), exit: (n) => { code = n; }, deadlineMs: null });
  assert.equal(code, 1);
  assert.match(out.at(-1), /^SUMMARY data-keeper status=regression job=team-colours-recheck /);
  assert.ok(out.some((l) => /CONFLICT: two colour sources/.test(l)));
  assert.ok(out.some((l) => l.startsWith('APPLY: ')), 'still hands Derik the command');
  // footballdb's own signal
  assert.deepEqual(keeper.contradictions('TOTALS 2000-2001: rows=9 gamesConflict=0', { gamesConflict: 0 }), []);
  assert.equal(keeper.contradictions('x', { gamesConflict: 2 }).length, 1);
});

test('data-keeper refuses a queue entry whose dry-run carries an apply flag, and never runs it', async () => {
  const f = fixtureRepo({ queue: QUEUE('node scripts/fake-dry.mjs --apply') });
  const out = []; let code;
  await runCli('data-keeper', keeper.main, { argv: [], env: f.env, out: (s) => out.push(s), exit: (n) => { code = n; }, deadlineMs: null });
  assert.equal(code, 2);
  assert.match(out.at(-1), /^SUMMARY data-keeper status=error reason=apply-flag$/);
  assert.ok(!existsSync(path.join(f.repo, 'scripts', 'ran.txt')), 'the script never ran');
});

test('data-keeper: a failing job script is exit 2 with the output kept on disk; an empty queue is ok', async () => {
  const f = fixtureRepo({ exit: 3, body: 'boom' });
  const out = []; let code;
  await runCli('data-keeper', keeper.main, { argv: [], env: f.env, out: (s) => out.push(s), exit: (n) => { code = n; }, deadlineMs: null });
  assert.equal(code, 2);
  assert.match(out.at(-1), /reason=job-failed$/);
  const f2 = fixtureRepo({ queue: '- [x] **done**\n  - dry-run: `node scripts/fake-dry.mjs`\n' });
  const out2 = []; let code2;
  await runCli('data-keeper', keeper.main, { argv: [], env: f2.env, out: (s) => out2.push(s), exit: (n) => { code2 = n; }, deadlineMs: null });
  assert.equal(code2, 0);
  assert.match(out2.at(-1), /^SUMMARY data-keeper status=ok job=- /);
});

test('footballdb-import parser: totals, gamesConflict, written', () => {
  const sample = [
    '2000  teams(About)=31  rows(tabs merged)=1529',
    '   written=570  exact=552 (97%)  created=1 (0%)  ambiguous=17  defenseOnly(no slot, not written)=959  gamesConflict=0',
    '2001  teams(About)=31  rows(tabs merged)=1500',
    '   written=549  exact=500 (97%)  created=0 (0%)  ambiguous=2  defenseOnly(no slot, not written)=900  gamesConflict=0',
    'TOTALS 2000-2001: rows=3029 exact=1052 created=1 ambiguous=19 defenseOnly=1859 gamesConflict=0',
  ].join('\n');
  const a = keeper.assess({ id: 'j', fields: { parser: 'footballdb-import', sample: '^\\s+written=' } }, sample, 1097);
  assert.deepEqual([a.rowsBefore, a.rowsAfter, a.wouldChange, a.contradictions.length], [1097, 1119, 1119, 0]);
  assert.equal(a.samples.length, 2);
  const bad = keeper.assess({ id: 'j', fields: { parser: 'footballdb-import' } }, sample.replace('gamesConflict=0\n', 'x').replace(/gamesConflict=0$/, 'gamesConflict=4'), 0);
  assert.equal(bad.contradictions.length, 1);
  assert.throws(() => keeper.assess({ id: 'j', fields: { parser: 'footballdb-import' } }, 'no totals', 0), SetupError);
  assert.throws(() => keeper.assess({ id: 'j', fields: { parser: 'nope' } }, sample, 0), SetupError);
});

// ---- docs and code must agree ---------------------------------------------------------------
test('docs/crew/watch-rules.md states the same retention days and budget as the code', () => {
  const md = readFileSync(path.join(ROOT, 'docs', 'crew', 'watch-rules.md'), 'utf8');
  const line = md.match(/^RETENTION (.+)$/m)[1];
  const doc = Object.fromEntries(line.split(' ').map((kv) => kv.split('=')).map(([k, v]) => [k, Number(v)]));
  assert.deepEqual(doc, { ...retention.RETENTION });
  assert.equal(Number(md.match(/^BUDGET vercel_usd_month=(\d+)$/m)[1]), cost.BUDGET_USD.vercel);
});

test('crew/README.md names every script, the Drive source line, and no secret value', () => {
  const md = readFileSync(path.join(ROOT, 'crew', 'README.md'), 'utf8');
  for (const name of Object.keys(SCRIPTS)) assert.ok(md.includes(`\`${name}`), name);
  assert.ok(md.includes('SOULs and project.yaml live in Drive CrewOS/crews/sportsvyn (single source; not copied here).'));
});
