// lib/testing/testReads.mjs - which tracked files the tests read, and whether CI
// would call each one "docs" (fri-2).
//
// ANY FILE A TEST READS IS CODE FOR CI'S PURPOSES, regardless of extension or
// folder. The receipt, 22 Oct: crew/lib/crew.test.mjs pins a line of
// crew/README.md; thu-4 changed that line in a PR CI classed as docs-only, the
// suite was skipped, and main stayed red until the next code PR.
//
// THE SCAN IS TEXTUAL (comments stripped first). A test "reads" a tracked file when
// its source has:
//   - a string literal that IS a tracked path from the repo root ('docs/x.html'),
//     or a ./ ../ literal that resolves to one from the test's folder
//     (new URL('../../docs/x.html', import.meta.url));
//   - a join()/resolve() call whose FIRST argument is a repo-anchored name (one
//     declared from import.meta.url, __dirname or process.cwd(), or named ROOT /
//     REPO / __dirname) and whose string arguments, joined, name a tracked file
//     from the root or from the test's folder.
// A join() on a temp dir (mkdtemp) is not repo-anchored, so a test that writes
// docs/handoff.md into a scratch git repo does not count. Directories are not
// followed: a test that readdir()s a docs folder must name its files, or the
// filter must list that folder as code by hand.

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const stripComments = (s) => s
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/(^|[^:'"`\\])\/\/[^\n]*/g, '$1');

const LIT = /'([^'\\\n]*)'|"([^"\\\n]*)"|`([^`\\$\n]*)`/g;
const lits = (s) => [...s.matchAll(LIT)].map((m) => m[1] ?? m[2] ?? m[3]);

/** Names in this source that hold a path inside the repo. */
function anchors(src) {
  const out = new Set(['ROOT', 'REPO', '__dirname']);
  for (const m of src.matchAll(/\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*([^;\n]+)/g)) {
    if (/mkdtemp|tmpdir/.test(m[2])) { out.delete(m[1]); continue; }
    if (/import\.meta\.url|__dirname|process\.cwd\(\)|fileURLToPath/.test(m[2])) out.add(m[1]);
  }
  return out;
}

/** Tracked files the test at `rel` (repo-relative) reads. -> string[] */
export function readsOf(rel, src, tracked) {
  const code = stripComments(src);
  const dir = path.posix.dirname(rel);
  const found = new Set();
  const take = (p) => {
    for (const c of [path.posix.normalize(p), path.posix.join(dir, p)]) {
      if (!c.startsWith('..') && tracked.has(c) && c !== rel) { found.add(c); return; }
    }
  };
  for (const s of lits(code)) {
    if (/^\.\.?\//.test(s)) take(s);
    else if (s.includes('/') && tracked.has(s) && s !== rel) found.add(s);
  }
  const anch = anchors(code);
  for (const m of code.matchAll(/\b(?:join|resolve)\(\s*([A-Za-z_$][\w$]*)\s*,([^()]*)\)/g)) {
    if (!anch.has(m[1])) continue;
    const parts = lits(m[2]);
    if (parts.length) take(parts.join('/'));
  }
  return [...found].sort();
}

/** Every tracked *.test.mjs -> the tracked files it reads. */
export function testReads(root) {
  const files = execFileSync('git', ['ls-files'], { cwd: root, encoding: 'utf8' }).split('\n').filter(Boolean);
  const tracked = new Set(files);
  const out = new Map();
  for (const t of files.filter((f) => f.endsWith('.test.mjs'))) {
    const r = readsOf(t, readFileSync(path.join(root, t), 'utf8'), tracked);
    if (r.length) out.set(t, r);
  }
  return out;
}

/**
 * The "changes" job's awk filter from .github/workflows/tests.yml, as a JS
 * classifier: rules in order, first match wins. -> (file) => 'docs' | 'code'.
 *   /^re/ { next }              docs
 *   $0 == "x" { next }          docs
 *   $0 == "x" { found = 1; next }   code (a docs file a test reads)
 * A line it cannot parse throws, so the guard cannot drift from the workflow.
 */
export function docsFilter(yml) {
  const body = yml.match(/awk '\n([\s\S]*?)'\)/)?.[1];
  if (!body) throw new Error('no awk filter in tests.yml');
  const rules = [];
  for (const raw of body.split('\n').map((l) => l.trim()).filter(Boolean)) {
    let m;
    if ((m = raw.match(/^\$0 == "([^"]+)" \{ found = 1; next \}$/))) rules.push((f) => (f === m[1] ? 'code' : null));
    else if ((m = raw.match(/^\$0 == "([^"]+)" \{ next \}$/))) { const x = m[1]; rules.push((f) => (f === x ? 'docs' : null)); }
    else if ((m = raw.match(/^\/(.+)\/ \{ next \}$/))) { const re = new RegExp(m[1].replace(/\\\//g, '/')); rules.push((f) => (re.test(f) ? 'docs' : null)); }
    else if (raw === '{ found = 1 }' || raw.startsWith('END ')) continue;
    else throw new Error(`unparsed awk rule: ${raw}`);
  }
  return (f) => { for (const r of rules) { const v = r(f); if (v) return v; } return 'code'; };
}
