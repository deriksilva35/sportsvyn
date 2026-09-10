// components/team/helmet.test.mjs - the helmet renders only when dressed,
// faces where it is told, and takes the decal tone from the shell.
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { install } from '../../lib/testing/nextResolve.mjs';
import { INK, PAPER } from '../../lib/brand/contrast.js';
import { MONOGRAM_MARK } from '../../lib/brand/monogram.js';

let html; let DECAL_FRACTION;
before(async () => {
  install();
  const React = (await import('react')).default;
  const { renderToStaticMarkup } = await import('react-dom/server');
  const mod = await import('./Helmet.js'); const Helmet = mod.default; DECAL_FRACTION = mod.DECAL_FRACTION;
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

test('the decal is 0.20 of the helmet: bar off at 24/32/40, on from 60 px', () => {
  assert.equal(DECAL_FRACTION, 0.20);
  const at100 = html({ primary: '#002244', secondary: '#C60C30', size: 100 });
  const s = 20 / MONOGRAM_MARK.height; // at 100 px the decal is 20 px, the bar is on, the box is the whole mark
  const got = Number(/scale\(([\d.e-]+)\)/.exec(at100)[1]);
  assert.ok(Math.abs(got - s) < 1e-9, `decal scale is 20 units over the glyph height (${s}, got ${got})`);
  const p = { primary: '#002244', secondary: '#C60C30' };
  for (const size of [24, 32, 40]) assert.match(html({ ...p, size }), /data-bar="0"/, `${size}`);
  assert.match(html({ ...p, size: 59 }), /data-bar="0"/); assert.match(html({ ...p, size: 60 }), /data-bar="1"/); assert.match(html({ ...p, size: 64 }), /<rect /);
  assert.doesNotMatch(html({ ...p, size: 24 }), /<rect /);
});
