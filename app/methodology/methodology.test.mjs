// app/methodology/methodology.test.mjs - the Methodology page, RENDERED: the
// win-probability section says what the model is anchored on and why it is
// labelled Calibrating, and the footer's Methodology link lands here.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync, unlinkSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { registerHooks } from 'node:module';
import { install } from '../../lib/testing/nextResolve.mjs';
import { stubPath } from '../../lib/testing/stubDir.mjs';

install();
const LINK = stubPath('__meth_link.mjs'); const CSS = stubPath('__meth_css.mjs');
writeFileSync(LINK, "import React from 'react'; export default function Link({ href, children, ...rest }) { return React.createElement('a', { ...rest, href: String(href) }, children); }\n");
writeFileSync(CSS, 'export default {};\n');
registerHooks({ resolve(spec, ctx, next) {
  if (spec === 'next/link') return { url: pathToFileURL(LINK).href, shortCircuit: true };
  if (spec.endsWith('.css')) return { url: pathToFileURL(CSS).href, shortCircuit: true };
  return next(spec, ctx);
} });
after(() => { for (const f of [LINK, CSS]) { try { unlinkSync(f); } catch { /* gone */ } } });

const React = (await import('react')).default;
const { renderToStaticMarkup } = await import('react-dom/server');
const { default: Page } = await import('./page.js');
const html = renderToStaticMarkup(React.createElement(Page));

test('the win probability section: in-game, anchored on the pre-game market spread, Calibrating', () => {
  assert.match(html, /<h2 id="win-probability">Win probability<\/h2>/);
  assert.match(html, /anchored on\s+the pre-game market spread/);
  assert.match(html, /<strong>Calibrating<\/strong> until our own 2026 results\s+validate it/);
  assert.match(html, /A game with no\s+pre-game line gets no number\./, 'no line, no number - said, not just done');
});

test('the footer Methodology link points here, not at "#"', () => {
  assert.match(html, /<a href="\/methodology">Methodology<\/a>/);
  assert.doesNotMatch(html, /<a href="#">Methodology<\/a>/);
});
