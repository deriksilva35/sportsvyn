// lib/admin/adminActionsCensus.test.mjs - EVERY ADMIN DOOR CHECKS THE ADMIN ITSELF.
//
// sun-12 item 1. The proxy's Basic Auth gates requests by PATH. A Server Action
// is addressed by its Next-Action id, and Next 16 runs it for a POST to ANY page
// (forwarding it to the worker that owns the id), so an admin action can be
// reached from /games without ever touching the /admin matcher. Five inline
// actions on /admin/blurbs and /admin/daily-card had no check at all, and the
// other six checked only that ADMIN_USERNAME was set.
//
// A guard cannot see a file it does not name, so this one names none. It WALKS
// app/ and lib/ and takes, as admin scope:
//   - every .js file under app/admin/ or app/api/admin/,
//   - every file whose name contains "admin" under app/ or lib/ that carries a
//     'use server' directive,
//   - every 'use server' module that an admin-path file imports.
// In those files every Server Action (exported functions of a 'use server'
// module, and every function whose body opens with 'use server') and every
// exported HTTP handler of a route.js must call requireAdmin() as its FIRST
// await - before any read, any write, anything. Then it COUNTS, so a walker that
// silently matched nothing cannot pass, and a new door has to be seen here.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const rel = (f) => path.relative(REPO, f).split(path.sep).join('/');
const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

function walk(dir, acc = []) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (e.name === 'node_modules' || e.name.startsWith('.')) continue;
    const full = path.join(dir, e.name);
    if (e.isDirectory()) walk(full, acc);
    else if (/\.(js|jsx|mjs|ts|tsx)$/.test(e.name) && !/\.test\.mjs$/.test(e.name)) acc.push(full);
  }
  return acc;
}

const DIRECTIVE = /^\s*['"]use server['"];?\s*$/m;
const HTTP = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'];

/** True when the module's first statement is 'use server'. */
function fileLevelUseServer(text) {
  return /^\s*['"]use server['"]/.test(strip(text));
}

/** Body text (from the opening brace to its match) of a function starting at idx. */
function bodyAt(text, idx) {
  const open = text.indexOf('{', text.indexOf(')', idx));
  let depth = 0;
  for (let i = open; i < text.length; i++) {
    if (text[i] === '{') depth++;
    else if (text[i] === '}' && --depth === 0) return text.slice(open + 1, i);
  }
  throw new Error(`unbalanced braces after offset ${idx}`);
}

/**
 * Every admin door in one module's (comment-stripped) source.
 * Returns { doors: [{ name, body }], strays } - strays counts inline
 * 'use server' directives not attributed to a named function (an arrow-function
 * action, say), which the census refuses rather than skipping.
 */
export function doorsIn(text, { isRoute = false } = {}) {
  const t = strip(text);
  const fileLevel = fileLevelUseServer(t);
  const doors = [];
  let inlineDirectives = 0;
  for (const m of t.matchAll(/^\s*(export\s+)?(?:default\s+)?(async\s+)?function\s+(\w+)\s*\(/gm)) {
    const exported = Boolean(m[1]);
    const name = m[3];
    const body = bodyAt(t, m.index);
    const inline = /^\s*['"]use server['"]/.test(body);
    if (inline) inlineDirectives++;
    const isAction = inline || (fileLevel && exported);
    const isHandler = isRoute && exported && HTTP.includes(name);
    if (isAction || isHandler) doors.push({ name, body, async: Boolean(m[2]) });
  }
  // Every directive in the file, minus the file-level one, must have been
  // attributed to a function above.
  const all = (t.match(new RegExp(DIRECTIVE.source, 'gm')) || []).length - (fileLevel ? 1 : 0);
  // Arrow or const-bound handlers in a route (export const POST = ...) are a form
  // this census does not parse: refuse them rather than miss them.
  const constHandlers = isRoute
    ? HTTP.filter((h) => new RegExp(`export\\s+(const|let|var)\\s+${h}\\b`).test(t)).length
    : 0;
  return { doors, strays: (all - inlineDirectives) + constHandlers };
}

/** Is requireAdmin() the first await in this body? */
export function gatedFirst(body) {
  const first = body.indexOf('await ');
  if (first === -1) return false;
  return /^await requireAdmin\(\)/.test(body.slice(first));
}

function resolveImport(fromFile, spec) {
  let base;
  if (spec.startsWith('@/')) base = path.join(REPO, spec.slice(2));
  else if (spec.startsWith('.')) base = path.resolve(path.dirname(fromFile), spec);
  else return null;
  for (const c of [base, `${base}.js`, `${base}.jsx`, `${base}.mjs`, path.join(base, 'index.js')]) {
    if (existsSync(c) && !c.endsWith(path.sep) && /\.(js|jsx|mjs)$/.test(c)) return c;
  }
  return null;
}

const isAdminPath = (r) => r.startsWith('app/admin/') || r.startsWith('app/api/admin/');

function scope() {
  const files = [...walk(path.join(REPO, 'app')), ...walk(path.join(REPO, 'lib'))];
  const inScope = new Set();
  for (const f of files) {
    const r = rel(f);
    const text = readFileSync(f, 'utf8');
    if (isAdminPath(r)) inScope.add(f);
    else if (/admin/i.test(path.basename(f)) && DIRECTIVE.test(strip(text))) inScope.add(f);
  }
  // 'use server' modules imported from an admin-path file.
  for (const f of [...inScope]) {
    if (!isAdminPath(rel(f))) continue;
    const text = strip(readFileSync(f, 'utf8'));
    for (const m of text.matchAll(/from\s+['"]([^'"]+)['"]/g)) {
      const target = resolveImport(f, m[1]);
      if (target && fileLevelUseServer(readFileSync(target, 'utf8'))) inScope.add(target);
    }
  }
  return [...inScope].sort();
}

function census() {
  const doors = [];
  const problems = [];
  for (const f of scope()) {
    const r = rel(f);
    const text = readFileSync(f, 'utf8');
    const isRoute = /\/route\.(js|mjs|ts)$/.test(r);
    const { doors: found, strays } = doorsIn(text, { isRoute });
    if (strays) problems.push(`${r}: ${strays} server action(s) or handler(s) in a form the census cannot parse`);
    for (const d of found) {
      const id = `${r}#${d.name}`;
      doors.push(id);
      if (!d.async) problems.push(`${id}: not async`);
      else if (!gatedFirst(d.body)) problems.push(`${id}: requireAdmin() is not its first await`);
    }
    if (found.length && !/from\s+['"](@\/lib\/admin\/requireAdmin|[./]+(lib\/admin\/)?requireAdmin)(\.js)?['"]/.test(strip(text))) {
      problems.push(`${r}: does not import requireAdmin from lib/admin/requireAdmin`);
    }
  }
  return { doors: doors.sort(), problems };
}

// THE PINNED LIST. A new admin action or handler fails here until it is added -
// and it can only pass the gate check above by calling requireAdmin() first.
const EXPECTED = [
  'app/admin/blurbs/page.js#approveAction',
  'app/admin/blurbs/page.js#bulkApproveAction',
  'app/admin/blurbs/page.js#rejectAction',
  'app/admin/daily-card/page.js#approveIntro',
  'app/admin/daily-card/page.js#rejectIntro',
  'app/admin/prematch/actions.js#publishHeld',
  'app/admin/prematch/actions.js#saveEdit',
  'app/admin/prematch/actions.js#unpublish',
  'app/admin/topic-drafts/page.js#discardTopicDraft',
  'app/admin/topic-drafts/page.js#generateTopicDraft',
  'app/admin/topic-drafts/page.js#publishTopicDraftAction',
  'app/api/admin/topic-draft/route.js#POST',
];

test('every admin server action and route handler calls requireAdmin() first', () => {
  const { problems } = census();
  assert.deepEqual(problems, []);
});

test('the census counts 12 admin doors, by name', () => {
  const { doors } = census();
  assert.equal(doors.length, 12);
  assert.deepEqual(doors, [...EXPECTED].sort());
});

test('the old env-only check is gone', () => {
  for (const f of scope()) {
    assert.ok(!/assertAdminEnv/.test(strip(readFileSync(f, 'utf8'))), `${rel(f)} still has assertAdminEnv`);
  }
});

// NEGATIVE CONTROLS: the census must see each way a door can be left open.
test('negative control: an inline action with no check is caught', () => {
  const src = `import { sql } from '@/lib/db';
import { requireAdmin } from '@/lib/admin/requireAdmin';
async function ok(formData) {
  'use server';
  await requireAdmin();
  await sql\`UPDATE t SET x = 1\`;
}
async function open(formData) {
  'use server';
  const id = Number(formData.get('id'));
  await sql\`UPDATE t SET x = \${id}\`;
}
export default async function Page() { return null; }`;
  const { doors, strays } = doorsIn(src);
  assert.equal(strays, 0);
  assert.deepEqual(doors.map((d) => d.name), ['ok', 'open'], 'the page component is not a door');
  assert.equal(gatedFirst(doors[0].body), true);
  assert.equal(gatedFirst(doors[1].body), false);
});

test('negative control: a check AFTER another await does not count', () => {
  const src = `'use server';
export async function late(formData) {
  const rows = await sql\`SELECT 1\`;
  await requireAdmin();
}
async function helper() { await sql\`SELECT 2\`; }`;
  const { doors } = doorsIn(src);
  assert.deepEqual(doors.map((d) => d.name), ['late'], 'an unexported helper of a use-server module is not a door');
  assert.equal(gatedFirst(doors[0].body), false);
});

test('negative control: an un-awaited call is not a check', () => {
  const { doors } = doorsIn(`'use server';\nexport async function a() {\n  requireAdmin();\n  await sql\`DELETE FROM t\`;\n}`);
  assert.equal(gatedFirst(doors[0].body), false);
});

test('negative control: route handlers are doors, an arrow action is refused', () => {
  const route = doorsIn(`export async function GET(req) { return Response.json(await load()); }
export async function POST(req) { try { await requireAdmin(); } catch { return new Response('no', { status: 401 }); } }
export const PUT = async () => {};`, { isRoute: true });
  assert.deepEqual(route.doors.map((d) => d.name), ['GET', 'POST']);
  assert.equal(gatedFirst(route.doors[0].body), false);
  assert.equal(gatedFirst(route.doors[1].body), true);
  assert.equal(route.strays, 1, 'export const PUT is a form the census refuses');
  const arrow = doorsIn(`const act = async (fd) => {\n  'use server';\n  await sql\`DELETE FROM t\`;\n};`);
  assert.equal(arrow.strays, 1, 'an arrow-function action cannot slip by uncounted');
});

test('the walk reaches the files it claims to', () => {
  const s = scope().map(rel);
  for (const f of ['app/admin/blurbs/page.js', 'app/admin/daily-card/page.js',
    'app/admin/prematch/actions.js', 'app/admin/topic-drafts/page.js', 'app/api/admin/topic-draft/route.js']) {
    assert.ok(s.includes(f), `${f} must be in scope`);
  }
});
