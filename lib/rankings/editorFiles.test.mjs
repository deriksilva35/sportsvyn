// lib/rankings/editorFiles.test.mjs - every editor list is named, statically,
// and a week with no list is null rather than somebody else's list (tue-3).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { EDITOR_FILES, editorKey } from './editorFiles.js';
import { editorFilePath, parseEditorList } from './publishGridironEdition.js';

const DIR = new URL('../../content/power/', import.meta.url);
const onDisk = readdirSync(DIR).filter((f) => f.endsWith('.md')).map((f) => f.replace(/\.md$/, '')).sort();

test('EVERY FILE IN content/power/ HAS ITS LINE, and every line its file', () => {
  // A guard that walks and counts: a list written and not added to the table
  // would publish on the model alone and say nothing.
  assert.deepEqual(Object.keys(EDITOR_FILES).sort(), onDisk);
  for (const [k, url] of Object.entries(EDITOR_FILES)) {
    assert.ok(existsSync(url), `${k}.md exists`);
    assert.ok(String(url).endsWith(`/content/power/${k}.md`), `${k} points at its own file`);
    assert.ok(parseEditorList(readFileSync(url, 'utf8')).length > 0, `${k} parses`);
  }
});

test('A WEEK WITH NO LIST IS NULL - never another week\'s, never another league\'s', () => {
  // THE DEFECT: in the bundle every week resolved to cfb-2026-w4.md, so the NFL
  // read 25 college teams and the CFB week-5 board read week 4's list.
  assert.equal(editorFilePath('nfl', 2026, 3), null, 'NFL week 3 has no list');
  assert.equal(editorFilePath('cfb', 2026, 5), null, 'CFB week 5 has no list');
  assert.equal(String(editorFilePath('nfl', 2026, 2)), String(EDITOR_FILES['nfl-2026-w2']));
  assert.equal(editorKey('cfb', 2026, 4), 'cfb-2026-w4');
});

test('NO TEMPLATE new URL(...) OVER import.meta.url anywhere in lib/ or app/ - the bundle cannot trace one', () => {
  const walk = (d) => readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory()
    ? (['node_modules', '.next', 'test-tmp'].includes(e.name) ? [] : walk(new URL(`${e.name}/`, d)))
    : /\.(m?js)$/.test(e.name) && !/\.test\.mjs$/.test(e.name) ? [new URL(e.name, d)] : []));
  const bad = [];
  for (const root of ['../../lib/', '../../app/']) {
    for (const f of walk(new URL(root, import.meta.url))) {
      // CODE, NOT COMMENTS: editorFiles.js quotes the old template to explain it.
      const src = readFileSync(f, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
      if (/new URL\(\s*`[^`]*\$\{[^`]*`\s*,\s*import\.meta\.url/.test(src)) bad.push(String(f).split('/sv-power-files/').pop().split('/sportsvyn/').pop());
    }
  }
  assert.deepEqual(bad, []);
});
