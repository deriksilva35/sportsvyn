// components/team/helmet.test.mjs - the helmet renders only when dressed,
// faces where it is told, and takes the decal tone from the shell.
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { install } from '../../lib/testing/nextResolve.mjs';
import { INK, PAPER } from '../../lib/brand/contrast.js';

let html;
before(async () => {
  install();
  const React = (await import('react')).default;
  const { renderToStaticMarkup } = await import('react-dom/server');
  const { default: Helmet } = await import('./Helmet.js');
  html = (props) => renderToStaticMarkup(React.createElement(Helmet, props));
});

test('a team with no colors renders NO helmet - null, never a grey one', () => {
  assert.equal(html({}), '');
  assert.equal(html({ primary: '#97233F' }), '', 'one color is not enough');
  assert.equal(html({ secondary: '#000000' }), '');
  assert.equal(html({ primary: null, secondary: null }), '');
  assert.equal(html({ primary: 'grey', secondary: '#000000' }), '');
});

test('shell in primary, mask and stripe in secondary, decal by the shell luminance', () => {
  const light = html({ primary: '#FFB612', secondary: '#000000' });
  assert.match(light, /<path d="M10 60[^"]*" fill="#FFB612"/, 'shell');
  assert.match(light, /stroke="#000000" stroke-width="6"/, 'stripe');
  assert.match(light, /stroke="#000000" stroke-width="4"/, 'facemask');
  assert.match(light, new RegExp(`data-decal="${INK}"`)); assert.match(light, new RegExp(`fill="${INK}"><polygon`), 'ink decal on a light shell');
  const dark = html({ primary: '#002244', secondary: '#C60C30' });
  assert.match(dark, new RegExp(`data-decal="${PAPER}"`)); assert.match(dark, new RegExp(`fill="${PAPER}"><polygon`), 'paper decal on a dark shell');
  assert.equal((dark.match(/<polygon /g) ?? []).length, 1, 'exactly one monogram');
});

test('facing mirrors the helmet, never the glyph; size sets the box', () => {
  const r = html({ primary: '#002244', secondary: '#C60C30', facing: 'right', size: 24 });
  const l = html({ primary: '#002244', secondary: '#C60C30', facing: 'left', size: 24 });
  assert.match(r, /data-facing="right"/); assert.doesNotMatch(r, /scale\(-1 1\)/);
  assert.match(l, /data-facing="left"/); assert.match(l, /<g transform="translate\(100 0\) scale\(-1 1\)">/);
  assert.match(l, /<g transform="translate\([\d.]+ 30\) scale\([\d.]+\) translate\(-285 -331\)"/, 'the decal group is placed, not mirrored');
  assert.match(r, /width="24" height="24"/); assert.match(html({ primary: '#002244', secondary: '#C60C30', size: 40 }), /width="40" height="40"/);
});

test('the decal bar follows the monogram default: off at 24/32/40, on from 43 px', () => {
  const p = { primary: '#002244', secondary: '#C60C30' };
  for (const size of [24, 32, 40]) assert.match(html({ ...p, size }), /data-bar="0"/, `${size}`);
  assert.match(html({ ...p, size: 43 }), /data-bar="1"/); assert.match(html({ ...p, size: 64 }), /<rect /);
  assert.doesNotMatch(html({ ...p, size: 24 }), /<rect /);
});
