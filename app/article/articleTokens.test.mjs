// app/article/articleTokens.test.mjs - pass (a) of the legacy migration.
//
// article.css's six local a-* aliases are retired into the global ink tokens
// they already shadowed. The tests that matter guard the two things a token
// pass can silently destroy: the drop cap, and the infographic's meaning.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const CSS = readFileSync(path.join(REPO, 'app/article/[slug]/article.css'), 'utf8');
const code = CSS.replace(/\/\*[\s\S]*?\*\//g, '');
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const rule = (sel) => (code.match(new RegExp(esc(sel) + '\\{[^}]*\\}')) ?? [''])[0];

test('the local a-* aliases are fully retired', () => {
  assert.doesNotMatch(code, /var\(--a-[a-z-]+\)/, 'no live reference to a local alias');
  assert.doesNotMatch(code, /--a-terra/, '--a-terra was dead and is deleted');
  // The defining block is gone too, not just the references.
  assert.doesNotMatch(code, /--a-graphite\s*:/);
});

test('THE DROP CAP IS BYTE-IDENTICAL to HEAD', () => {
  // The one rule the relay forbade touching. Compared against git, not eyeballed.
  const head = execFileSync('git', ['show', 'HEAD:app/article/[slug]/article.css'],
    { cwd: REPO, encoding: 'utf8' });
  const grab = (s) => (s.match(/\.a-body > p:first-of-type::first-letter\{[^}]*\}/) ?? [''])[0];
  assert.ok(grab(head), 'precondition: HEAD has the drop cap');
  assert.equal(grab(CSS), grab(head));
});

test('THE LEGEND STILL KEYS TO THE BAR - the double-duty check', () => {
  // --a-muted did double duty: 10 text sites AND the .ht halftime marker, which
  // the legend swatch mirrors. If the marker and its swatch ever resolve to
  // different values the chart's key silently stops matching the chart.
  const ht = rule('.a-fig-bar .ht');
  const swm = rule('.a-fig-legend .sw.m');
  assert.match(ht, /background:var\(--muted\)/);
  assert.match(swm, /background:var\(--muted\)/);
  const val = (r) => (r.match(/background:(var\(--[a-z0-9-]+\))/) ?? [])[1];
  assert.equal(val(ht), val(swm), 'halftime marker and its swatch must be one value');

  // The volt pair is untouched and must stay a DIRECT global reference.
  assert.match(rule('.a-fig-bar .brk'), /background:var\(--volt\)/);
  assert.match(rule('.a-fig-legend .sw.v'), /background:var\(--volt\)/);
  assert.equal(val(rule('.a-fig-bar .brk')), val(rule('.a-fig-legend .sw.v')));
});

test('the two marker types stay visually distinct from each other and the seg', () => {
  // If break, halftime and period ever collapsed to one value the diagram
  // would render as a single undifferentiated bar.
  const bg = (s) => (rule(s).match(/background:(var\(--[a-z0-9-]+\))/) ?? [])[1];
  const seg = bg('.a-fig-bar .seg'), ht = bg('.a-fig-bar .ht'), brk = bg('.a-fig-bar .brk');
  assert.equal(new Set([seg, ht, brk]).size, 3, 'period, halftime and break must differ');
  assert.equal(seg, 'var(--graphite)');
});

test('every retired token resolves to a real global value, none to initial', () => {
  // The collapse trap: an undefined var makes `background`/`border` fall back to
  // initial and vanish silently, while `color` merely inherits and looks fine.
  const globals = readFileSync(path.join(REPO, 'app/globals.css'), 'utf8');
  // --graphite, not --ink-3: --ink-3 is NOT a global token (it lives only in
  // admin/console.css), so mapping to it would have made the period blocks
  // transparent. This list is the guard against that recurring.
  for (const t of ['muted', 'paper-dim', 'graphite', 'rule', 'volt']) {
    assert.match(globals, new RegExp(`--${t}\\s*:`), `--${t} must be defined globally`);
  }
  // Borders retired to --rule must still carry a colour reference.
  for (const sel of ['.a-hero6', '.a-fig', '.a-sources', '.a-fig-bar .seg']) {
    assert.match(rule(sel), /border[^:]*:[^;}]*var\(--rule\)/, `${sel} keeps a real border colour`);
  }
});

test('EXISTING DEFECT FIXED: the byline separator dot was 1.38:1', () => {
  // --a-charcoal #2A2A2A on the page's #0A0A0A ground - effectively invisible on
  // the published site, and not a migration casualty. This is a separate
  // improvement, not part of the alias retirement.
  assert.match(rule('.article-meta .dot'), /color:var\(--muted\)/);
  assert.doesNotMatch(code, /#2A2A2A/i);
});
