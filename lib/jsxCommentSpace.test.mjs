// lib/jsxCommentSpace.test.mjs - A JSX COMMENT MUST NOT EAT A SPACE (sun-16 A).
//
// THE RECEIPT. v1 Daily's hero (app/daily/page.js before 4c10e05) shipped
// "...one real week of NFL history.One attempt" because of this:
//
//     Sixty-four real performances from one real week of NFL history.
//     {/* a comment */}
//     One attempt &middot; ...
//
// JSX trims a text node at every line break. Two text lines that touch are
// joined with a space, but a {/* comment */} between them splits them into
// two text nodes, each trimmed at its own break, and the space is gone. The
// comment is invisible in the source's reading order, which is why nobody
// sees it in review.
//
// THE GUARD. Every .js/.jsx file under app/, components/ and lib/ - WALKED,
// not listed, so a file nobody named is still seen - is parsed with the same
// Babel the mount tests use. A JSX text that ends a line with visible text,
// then only comment containers, then a text that starts on a new line with
// visible text, is the pattern. Put the comment above the sentence, or end
// the first line with {' '}.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseSync } from '@babel/core';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SKIP = new Set(['node_modules', '.next', 'test-tmp', '.git']);

function walk(dir, out = []) {
  for (const d of readdirSync(dir, { withFileTypes: true })) {
    if (SKIP.has(d.name)) continue;
    const p = path.join(dir, d.name);
    if (d.isDirectory()) walk(p, out);
    else if (/\.(js|jsx)$/.test(d.name)) out.push(p);
  }
  return out;
}

const isComment = (n) => n?.type === 'JSXExpressionContainer' && n.expression?.type === 'JSXEmptyExpression';
const blank = (n) => n?.type === 'JSXText' && !/\S/.test(n.value);

/** Every "text / comment / text" join that loses its space, as `line: "a" + "b"`. */
export function commentEatsSpace(src, filename = 'x.js') {
  const ast = parseSync(src, {
    filename, babelrc: false, configFile: false, sourceType: 'module',
    presets: ['@babel/preset-react'],
  });
  const hits = [];
  const visit = (n) => {
    if (!n || typeof n !== 'object') return;
    if (Array.isArray(n)) { n.forEach(visit); return; }
    if ((n.type === 'JSXElement' || n.type === 'JSXFragment') && Array.isArray(n.children)) {
      const ch = n.children;
      for (let i = 0; i < ch.length; i++) {
        const a = ch[i];
        if (a.type !== 'JSXText' || !/\S[ \t]*\n\s*$/.test(a.value)) continue;
        let j = i + 1; let sawComment = false;
        while (j < ch.length && (isComment(ch[j]) || (sawComment && blank(ch[j])))) {
          if (isComment(ch[j])) sawComment = true;
          j++;
        }
        const b = ch[j];
        if (sawComment && b?.type === 'JSXText' && /^\s*\n\s*\S/.test(b.value)) {
          hits.push(`${a.loc.end.line}: "${a.value.trim().slice(-30)}" + "${b.value.trim().slice(0, 30)}"`);
        }
      }
    }
    for (const k of Object.keys(n)) {
      if (k === 'loc' || k === 'leadingComments' || k === 'trailingComments') continue;
      const v = n[k];
      if (v && typeof v === 'object') visit(v);
    }
  };
  visit(ast.program);
  return hits;
}

test('the detector catches the v1 Daily receipt, and not the fixed forms', () => {
  const bad = [
    'export default () => (',
    '  <p>',
    '    One real week of NFL history.',
    '    {/* a note */}',
    '    One attempt',
    '  </p>',
    ');',
  ].join('\n');
  assert.equal(commentEatsSpace(bad).length, 1, 'text / comment / text across lines');
  const spaced = bad.replace('NFL history.', "NFL history.{' '}");
  assert.deepEqual(commentEatsSpace(spaced), [], "an explicit {' '} keeps the space");
  const above = [
    'export default () => (',
    '  <p>',
    '    {/* a note */}',
    '    One real week of NFL history.',
    '    One attempt',
    '  </p>',
    ');',
  ].join('\n');
  assert.deepEqual(commentEatsSpace(above), [], 'a comment above the sentence costs nothing');
  const inline = 'export default () => <p>history. {/* c */} One attempt</p>;';
  assert.deepEqual(commentEatsSpace(inline), [], 'on one line the spaces are literal');
});

test('no JSX in app/, components/ or lib/ loses a space to a comment', () => {
  const files = [
    ...walk(path.join(ROOT, 'app')),
    ...walk(path.join(ROOT, 'components')),
    ...walk(path.join(ROOT, 'lib')),
  ];
  // A walk that found nothing passes everything; the tree has hundreds.
  assert.ok(files.length > 300, `walked ${files.length} files`);
  const found = [];
  let jsxFiles = 0;
  for (const f of files) {
    const src = readFileSync(f, 'utf8');
    if (!/<[A-Za-z>]/.test(src) || !src.includes('{/*')) continue;
    jsxFiles += 1;
    for (const h of commentEatsSpace(src, f)) found.push(`${path.relative(ROOT, f)}:${h}`);
  }
  assert.ok(jsxFiles > 50, `parsed ${jsxFiles} files with JSX comments`);
  assert.deepEqual(found, []);
});
