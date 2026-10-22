// lib/testing/ciDocsOnly.test.mjs - no file a test reads is "docs" to CI (fri-2).
//
// CI skips the suite when a PR changes only docs (.github/workflows/tests.yml,
// the "changes" job). A doc that a test reads is not a doc: change it and the
// test can go red, and a skipped suite would not say so. The receipt: thu-4
// edited crew/README.md, which crew/lib/crew.test.mjs pins, in a docs-only PR;
// main went red silently until the next code PR ran the suite.
//
// So: scan every tracked test for the tracked files it reads
// (lib/testing/testReads.mjs) and fail if the workflow's filter would call any of
// them docs. The fix is a `$0 == "<file>" { found = 1; next }` line above the
// docs rules in tests.yml.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { docsFilter, readsOf, testReads } from './testReads.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const isDocs = docsFilter(readFileSync(path.join(ROOT, '.github', 'workflows', 'tests.yml'), 'utf8'));

test('no tracked file a test reads is docs-only to CI', () => {
  const bad = [];
  for (const [t, files] of testReads(ROOT)) for (const f of files) if (isDocs(f) === 'docs') bad.push(`${t} reads ${f}`);
  assert.deepEqual(bad, [], `add each file to the code lines of the awk filter in .github/workflows/tests.yml:\n${bad.join('\n')}`);
});

test('the filter: docs, read docs, and code', () => {
  assert.equal(isDocs('docs/handoff.md'), 'docs');
  assert.equal(isDocs('README.md'), 'docs');
  assert.equal(isDocs('crew/agents/watcher/SOUL.md'), 'docs');
  assert.equal(isDocs('crew/README.md'), 'code');
  assert.equal(isDocs('docs/crew/data-queue.md'), 'code');
  assert.equal(isDocs('crew/lib/common.mjs'), 'code');
  assert.equal(isDocs('crew/watch-rules.md'), 'code');
  assert.equal(isDocs('lib/x/README.md'), 'code');
});

test('the scan sees the ways tests read files, and skips temp dirs and comments', () => {
  const tracked = new Set(['docs/a.md', 'docs/b.html', 'docs/c.txt', 'crew/README.md', 'docs/handoff.md', 'docs/d.md']);
  const src = [
    "const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');",
    "readFileSync(path.join(ROOT, 'crew', 'README.md'));",
    "readFileSync(path.join(ROOT, 'docs/a.md'));",
    "readFileSync(new URL('../../docs/b.html', import.meta.url));",
    "const src = (rel) => readFileSync(path.join(ROOT, rel)); src('docs/c.txt');",
    "const dir = mkdtempSync(join(tmpdir(), 'x')); writeFileSync(join(dir, 'docs', 'handoff.md'), 'h');",
    "// readFileSync('docs/d.md')",
  ].join('\n');
  assert.deepEqual(readsOf('lib/x/y.test.mjs', src, tracked), ['crew/README.md', 'docs/a.md', 'docs/b.html', 'docs/c.txt']);
});

test('a filter line the parser does not know fails loudly', () => {
  assert.throws(() => docsFilter("awk '\n  /^docs\\// { print }\n')"), /unparsed awk rule/);
});
