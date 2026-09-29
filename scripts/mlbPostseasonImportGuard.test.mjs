// scripts/mlbPostseasonImportGuard.test.mjs - --prod --apply refuses unless lib/db.js
// is pointed at PROD too (29 Sep: the stages landed and nothing else opened).
// Fake, unreachable URLs: the guard must fire before any query is made.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const SCRIPT = fileURLToPath(new URL('./mlb-postseason-import.mjs', import.meta.url));
const run = (env, args) => spawnSync(process.execPath, [SCRIPT, ...args], {
  env: { PATH: process.env.PATH, ...env }, encoding: 'utf8', timeout: 20000,
});

test('--prod --apply with DATABASE_URL not PROD: refused before any query, with the right command', () => {
  const r = run({ PROD_DATABASE_URL: 'postgres://p:p@prod.example.invalid/db', DATABASE_URL: 'postgres://d:d@dev.example.invalid/db' }, ['--prod', '--apply', '2026']);
  assert.equal(r.status, 1, r.stdout + r.stderr);
  assert.match(r.stderr, /REFUSE: --prod --apply opens October days, Run rounds and series boards through lib\/db\.js/);
  assert.match(r.stderr, /DATABASE_URL="\$PROD_DATABASE_URL" node scripts\/mlb-postseason-import\.mjs --prod --apply <season>/);
  assert.doesNotMatch(r.stdout, /TARGET/, 'refused before it named a target or opened a connection');
});
