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
  assert.equal(String(editorFilePath('cfb', 2026, 4)), String(EDITOR_FILES['cfb-2026-w4']));
  assert.equal(editorKey('cfb', 2026, 4), 'cfb-2026-w4');
});

test('THE NFL IS FULLY COMPUTED: null for every NFL week, even one whose file is on disk (wed-1)', () => {
  // The file is kept as history and keeps its table line (the walk above), but
  // the NFL publish must never read it again - the 13:05Z Tuesday cron runs on
  // the model alone.
  assert.ok(EDITOR_FILES['nfl-2026-w2'], 'the retired list is still named');
  for (let w = 0; w <= 22; w += 1) assert.equal(editorFilePath('nfl', 2026, w), null, `NFL week ${w}`);
});

test('THE CFB PATH STAYS OPEN: a cfb list added to the table is what editorFilePath reads', () => {
  // Every CFB key in the table resolves to its own file - the same lookup a
  // new content/power/cfb-<season>-w<week>.md plus its line would take.
  const cfb = Object.keys(EDITOR_FILES).filter((k) => k.startsWith('cfb-'));
  assert.ok(cfb.length > 0);
  for (const k of cfb) {
    const [, season, week] = /^cfb-(\d+)-w(\d+)$/.exec(k);
    assert.equal(String(editorFilePath('cfb', Number(season), Number(week))), String(EDITOR_FILES[k]), k);
  }
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
