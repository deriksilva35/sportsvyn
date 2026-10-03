// lib/testing/devSweepPlan.test.mjs - the pure decisions of scripts/dev-orphan-sweep.mjs:
// flags, the PROD refusal, delete/restore order and the age guard. No database.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseArgs, hostFingerprint, refuseReason, fkTreatment, deletionOrder, restoreTableOrder,
  isYoung, rootOf, qi, DEFAULT_OLDER_THAN_MIN,
} from './devSweepPlan.mjs';

// Placeholder hosts only - never a real connection string in a test.
const DEV = 'postgresql://u:p@ep-dev-aaa111-pooler.c-1.us-east-1.aws.neon.tech/db?sslmode=require';
const PROD = 'postgresql://u:p@ep-prod-bbb222-pooler.c-1.us-east-1.aws.neon.tech/db?sslmode=require';
const PROD_DIRECT = 'postgresql://other:pw@ep-prod-bbb222.c-1.us-east-1.aws.neon.tech/db';

test('no flags is list mode, the read-only default', () => {
  assert.deepEqual(parseArgs([]), { mode: 'list', dryRun: false, olderThan: DEFAULT_OLDER_THAN_MIN, undoFile: null, outFile: null });
  assert.equal(DEFAULT_OLDER_THAN_MIN, 30);
});

test('flags parse; nonsense combinations are refused, not guessed', () => {
  assert.deepEqual(parseArgs(['--apply', '--dry-run', '--older-than', '45']),
    { mode: 'apply', dryRun: true, olderThan: 45, undoFile: null, outFile: null });
  assert.equal(parseArgs(['--undo', 'x.jsonl']).undoFile, 'x.jsonl');
  assert.equal(parseArgs(['--undo', 'x.jsonl']).mode, 'undo');
  assert.throws(() => parseArgs(['--apply', '--undo', 'x']), /exclusive/);
  assert.throws(() => parseArgs(['--undo', 'x', '--apply']), /exclusive/);
  assert.throws(() => parseArgs(['--dry-run']), /--apply/);
  assert.throws(() => parseArgs(['--undo']), /needs a value/);
  assert.throws(() => parseArgs(['--older-than', '-5']), /needs a value|minutes/);
  assert.throws(() => parseArgs(['--older-than', 'soon']), /minutes/);
  assert.throws(() => parseArgs(['--out', 'f.jsonl']), /--apply/);
  assert.throws(() => parseArgs(['--aply']), /unknown/);
});

test('the pooled and the direct URL of one endpoint share a fingerprint', () => {
  assert.equal(hostFingerprint(PROD), hostFingerprint(PROD_DIRECT));
  assert.notEqual(hostFingerprint(DEV), hostFingerprint(PROD));
  assert.equal(hostFingerprint('not a url'), null);
});

test('refuses PROD by equality and by host, in every mode', () => {
  for (const mode of ['list', 'apply', 'undo']) {
    assert.match(refuseReason({ url: PROD, prodUrl: PROD, mode }), /PROD/);
    // different credentials, direct host: same database
    assert.match(refuseReason({ url: PROD_DIRECT, prodUrl: PROD, mode }), /PROD's host/);
    assert.equal(refuseReason({ url: DEV, prodUrl: PROD, mode }), null);
    assert.match(refuseReason({ url: undefined, prodUrl: PROD, mode }), /missing/);
  }
});

test('a write cannot proceed without PROD_DATABASE_URL to compare against; a list can', () => {
  assert.equal(refuseReason({ url: DEV, prodUrl: undefined, mode: 'list' }), null);
  assert.match(refuseReason({ url: DEV, prodUrl: undefined, mode: 'apply' }), /PROD_DATABASE_URL missing/);
  assert.match(refuseReason({ url: DEV, prodUrl: '', mode: 'undo' }), /PROD_DATABASE_URL missing/);
});

test('FK actions: cascade/no action/restrict delete, set null nulls, anything else throws', () => {
  for (const a of ['c', 'a', 'r']) assert.equal(fkTreatment(a), 'delete');
  assert.equal(fkTreatment('n'), 'null');
  assert.throws(() => fkTreatment('d'), /not handled/);
});

// A slice of the real graph: users <- drafts <- draft_picks, draft_configs <- drafts,
// users <- draft_configs, leagues <- teams <- matches (SET NULL), leagues <- matches.
const EDGES = [
  { child: 'draft_configs', parent: 'users', action: 'c' },
  { child: 'drafts', parent: 'users', action: 'c' },
  { child: 'drafts', parent: 'draft_configs', action: 'c' },
  { child: 'draft_picks', parent: 'drafts', action: 'c' },
  { child: 'draft_config_invites', parent: 'users', action: 'n' },
  { child: 'draft_config_invites', parent: 'draft_configs', action: 'c' },
  { child: 'teams', parent: 'leagues', action: 'c' },
  { child: 'matches', parent: 'leagues', action: 'c' },
  { child: 'matches', parent: 'teams', action: 'n' },
  { child: 'survivor_picks', parent: 'matches', action: 'r' },
  { child: 'editorial_blurbs', parent: 'editorial_blurbs', action: 'n' },
];

test('deletion order puts every child before its parent', () => {
  const tables = ['users', 'draft_picks', 'draft_configs', 'drafts', 'draft_config_invites', 'leagues', 'teams', 'matches', 'survivor_picks', 'editorial_blurbs'];
  const order = deletionOrder(tables, EDGES);
  assert.equal(order.length, tables.length);
  assert.deepEqual([...order].sort(), [...tables].sort());
  const pos = (t) => order.indexOf(t);
  for (const e of EDGES) {
    if (e.child === e.parent || fkTreatment(e.action) !== 'delete') continue;
    assert.ok(pos(e.child) < pos(e.parent), `${e.child} must go before ${e.parent}: ${order.join(' > ')}`);
  }
  // RESTRICT counts: the picks go before the match they point at.
  assert.ok(pos('survivor_picks') < pos('matches'));
});

test('deletion order is stable run to run, whatever order the tables arrive in', () => {
  const a = deletionOrder(['users', 'drafts', 'draft_picks'], EDGES);
  const b = deletionOrder(['draft_picks', 'users', 'drafts'], EDGES);
  assert.deepEqual(a, b);
  assert.deepEqual(a, ['draft_picks', 'drafts', 'users']);
});

test('only edges among the planned tables constrain the order; SET NULL and self edges never do', () => {
  // teams <- matches is SET NULL: either order is legal, and a would-be cycle is not one.
  const order = deletionOrder(['matches', 'teams'], [
    ...EDGES, { child: 'teams', parent: 'matches', action: 'n' },
  ]);
  assert.deepEqual(order, ['matches', 'teams']);
  assert.deepEqual(deletionOrder(['editorial_blurbs'], EDGES), ['editorial_blurbs']);
  // an edge to a table not in the plan is ignored
  assert.deepEqual(deletionOrder(['draft_picks'], EDGES), ['draft_picks']);
});

test('a real cycle among deleted tables is refused, never guessed', () => {
  assert.throws(() => deletionOrder(['a', 'b'], [
    { child: 'a', parent: 'b', action: 'c' }, { child: 'b', parent: 'a', action: 'a' },
  ]), /FK cycle among a, b/);
});

test('restore runs the file backwards: parents first', () => {
  const del = deletionOrder(['users', 'drafts', 'draft_picks', 'draft_configs'], EDGES);
  const restore = restoreTableOrder(del);
  assert.deepEqual(restore, [...del].reverse());
  for (const e of EDGES) {
    if (!restore.includes(e.child) || !restore.includes(e.parent) || e.child === e.parent) continue;
    if (fkTreatment(e.action) !== 'delete') continue;
    assert.ok(restore.indexOf(e.parent) < restore.indexOf(e.child), `${e.parent} must be back before ${e.child}`);
  }
  // pure: the input is not reversed in place
  const input = ['x', 'y'];
  restoreTableOrder(input);
  assert.deepEqual(input, ['x', 'y']);
});

test('age guard: created_at at/after the cutoff is young; no created_at follows its parent', () => {
  const cutoff = Date.parse('2026-10-03T06:00:00Z');
  assert.equal(isYoung({ created_at: '2026-10-03T06:00:00+00:00' }, cutoff), true);
  assert.equal(isYoung({ created_at: '2026-10-03T06:10:00+00:00' }, cutoff), true);
  assert.equal(isYoung({ created_at: '2026-10-03T05:59:59.999+00:00' }, cutoff), false);
  assert.equal(isYoung({ id: 1 }, cutoff), false);
  assert.equal(isYoung({ created_at: null }, cutoff), false);
});

test('a young row is traced to the fixture that pulled it in', () => {
  const nodes = new Map([
    ['users|[1]', { via: null }],
    ['drafts|[7]', { via: 'users|[1]' }],
    ['draft_picks|[99]', { via: 'drafts|[7]' }],
  ]);
  assert.equal(rootOf(nodes, 'draft_picks|[99]'), 'users|[1]');
  assert.equal(rootOf(nodes, 'users|[1]'), 'users|[1]');
  const loop = new Map([['a', { via: 'b' }], ['b', { via: 'a' }]]);
  assert.throws(() => rootOf(loop, 'a'), /via cycle/);
});

test('identifiers are quoted, embedded quotes doubled', () => {
  assert.equal(qi('users'), '"users"');
  assert.equal(qi('we"ird'), '"we""ird"');
});
