// app/scores/scoresLandscape.test.mjs - the landscape stylesheet's two laws (scores-landscape).
//   1. EVERY RULE SITS INSIDE THE ORIENTATION QUERY, so portrait is untouched.
//   2. NO COLOUR LITERAL: the mock's palette is tokens in app/globals.css; none of
//      its values may be typed into a component or stylesheet.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const read = (f) => readFileSync(path.join(REPO, f), 'utf8');
const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '');
const QUERY = '@media (orientation: landscape) and (max-height: 500px)';

/** Top-level blocks of a stylesheet: [{ head, body }]. Anything outside braces is also reported. */
function topLevel(css) {
  const out = [];
  let depth = 0, start = 0, head = '';
  for (let i = 0; i < css.length; i++) {
    const c = css[i];
    if (c === '{') { if (depth === 0) { head = css.slice(start, i).trim(); start = i + 1; } depth++; }
    else if (c === '}') { depth--; if (depth === 0) { out.push({ head, body: css.slice(start, i) }); start = i + 1; } }
    else if (c === ';' && depth === 0) { out.push({ head: css.slice(start, i).trim(), body: null }); start = i + 1; }
  }
  const tail = css.slice(start).trim();
  if (tail) out.push({ head: tail, body: null });
  return out;
}

test('scoresLandscape.css: every rule is inside the one orientation query', () => {
  const blocks = topLevel(strip(read('app/scores/scoresLandscape.css')));
  assert.equal(blocks.length, 1, `expected one top-level block, got: ${blocks.map((b) => b.head).join(' | ')}`);
  assert.equal(blocks[0].head, QUERY);
  const inner = topLevel(blocks[0].body);
  assert.ok(inner.length > 40, `${inner.length} rules inside the query`);
  for (const r of inner) {
    assert.ok(r.body != null, `a stray statement in the query: ${r.head}`);
    assert.doesNotMatch(r.head, /^@(media|supports)/, `no nested at-rule: ${r.head}`);
  }
});

test('the guard itself catches a rule outside the query', () => {
  assert.equal(topLevel(`.a { color: red } ${QUERY} { .b { color: blue } }`).length, 2);
});

test('the landscape pieces are display:none outside the query (scoresV4.css)', () => {
  const v4 = strip(read('app/scores/scoresV4.css'));
  assert.match(v4, /\.sv4-rail[^{]*\{ display: none; \}/);
  assert.match(v4, /\.sv4-featured \{ display: none; \}/);
});

test('NO MOCK LITERAL outside globals.css: the navy set, its text greys and its reds are tokens', () => {
  const MOCK = /#241F62|#352F7A|#C9C6E6|#9E9BC4|#FF7B86|#E63946/i;
  for (const f of ['app/scores/scoresLandscape.css', 'app/scores/scoresV4.css', 'components/scores/ScoresRail.js',
    'components/scores/FeaturedGame.js', 'lib/scores/featured.js', 'components/scores/ScoreboardV4.js', 'app/scores/page.js']) {
    assert.doesNotMatch(read(f), MOCK, f);
  }
  const g = strip(read('app/globals.css'));
  for (const v of ['#241F62', '#352F7A', '#C9C6E6', '#9E9BC4']) assert.ok(g.toUpperCase().includes(v), `${v} is defined in globals.css`);
});

test('the live dot, clock and LIVE pill use --arcade-live', () => {
  const css = strip(read('app/scores/scoresLandscape.css'));
  for (const sel of ['.sv4-compact .sv4-lbl .clock', '.sv4-compact .sv4-lbl .dot', '.sv4-chip.live']) {
    const m = css.match(new RegExp(`${sel.replace(/[.]/g, '\\.')}\\s*\\{[^}]*\\}`));
    assert.ok(m, sel);
    assert.match(m[0], /var\(--arcade-live\)/, sel);
  }
});
