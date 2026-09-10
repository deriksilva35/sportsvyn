// lib/brand/monogram.test.mjs - the geometry is the icon, the file is the
// geometry, and the component drops the bar where it cannot be seen.
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  MONOGRAM_BAR, MONOGRAM_Y, MONOGRAM_MARK, MONOGRAM_Y_BOUNDS, MONOGRAM_BAR_MIN, MONOGRAM_VIEWBOX,
  barByDefault, monogramSvg, yPoints,
} from './monogram.js';
import { decodePng, iconMask, trace, rasterize, diffCount, ICON } from '../../scripts/monogram-trace.mjs';
import { install } from '../testing/nextResolve.mjs';

const root = new URL('../../', import.meta.url);

test('the constants are the icon: re-tracing the PNG reproduces them to the pixel', () => {
  const mask = iconMask(decodePng(readFileSync(new URL(ICON, root))));
  const t = trace(mask);
  assert.deepEqual(t.bar, MONOGRAM_BAR);
  assert.deepEqual(t.y, MONOGRAM_Y);
  const xs = MONOGRAM_Y.map((p) => p[0]); const ys = MONOGRAM_Y.map((p) => p[1]);
  assert.deepEqual(MONOGRAM_Y_BOUNDS, { x: Math.min(...xs), y: Math.min(...ys), width: Math.max(...xs) - Math.min(...xs), height: Math.max(...ys) - Math.min(...ys) });
  assert.deepEqual(MONOGRAM_MARK, { x: Math.min(...xs, MONOGRAM_BAR.x), y: MONOGRAM_BAR.y, width: MONOGRAM_Y_BOUNDS.width, height: Math.max(...ys) - MONOGRAM_BAR.y });
});

test('the traced shapes cover the raster: under 0.5% of pixels disagree', () => {
  const mask = iconMask(decodePng(readFileSync(new URL(ICON, root))));
  const r = rasterize(mask.W, mask.H, MONOGRAM_BAR, MONOGRAM_Y);
  const d = diffCount(r, mask.m);
  assert.ok(d / (mask.W * mask.H) < 0.005, `${d} px disagree`);
  assert.ok(d > 0, 'an antialiased raster and a hard-edged polygon never agree exactly - zero means the comparison is broken');
});

test('public/brand/monogram.svg is generated from the constants, byte for byte', () => {
  const file = readFileSync(new URL('public/brand/monogram.svg', root), 'utf8');
  assert.equal(file, monogramSvg());
  assert.match(file, new RegExp(`viewBox="0 0 ${MONOGRAM_VIEWBOX} ${MONOGRAM_VIEWBOX}"`));
  assert.equal((file.match(/<rect /g) ?? []).length, 1); assert.equal((file.match(/<polygon /g) ?? []).length, 1);
  assert.ok(file.includes(`points="${yPoints()}"`));
});

test('the bar is on from 12 CSS px of mark height and off below', () => {
  assert.equal(MONOGRAM_BAR_MIN, 12);
  assert.equal(barByDefault(11.99), false); assert.equal(barByDefault(12), true); assert.equal(barByDefault(64), true); assert.equal(barByDefault(8), false);
});

before(() => install());

test('Monogram: size is the drawn height, bar follows the default and the prop', async () => {
  const React = (await import('react')).default;
  const { renderToStaticMarkup } = await import('react-dom/server');
  const { default: Monogram } = await import('../../components/brand/Monogram.js');
  const html = (props) => renderToStaticMarkup(React.createElement(Monogram, props));
  const at12 = html({ size: 12 });
  assert.match(at12, /data-bar="1"/); assert.match(at12, /<rect /); assert.match(at12, /height="12"/);
  assert.match(at12, new RegExp(`viewBox="${MONOGRAM_MARK.x} ${MONOGRAM_MARK.y} ${MONOGRAM_MARK.width} ${MONOGRAM_MARK.height}"`));
  const at11 = html({ size: 11 });
  assert.match(at11, /data-bar="0"/); assert.doesNotMatch(at11, /<rect /); assert.match(at11, /<polygon /);
  assert.match(at11, new RegExp(`viewBox="${MONOGRAM_Y_BOUNDS.x} ${MONOGRAM_Y_BOUNDS.y} ${MONOGRAM_Y_BOUNDS.width} ${MONOGRAM_Y_BOUNDS.height}"`), 'without the bar the Y fills the height');
  assert.match(html({ size: 8, bar: true }), /<rect /, 'bar can be forced on');
  assert.doesNotMatch(html({ size: 40, bar: false }), /<rect /, 'and off');
  assert.match(html({ size: 20 }), /fill="currentColor"/); assert.match(html({ size: 20, color: '#D4FF00' }), /fill="#D4FF00"/);
  assert.match(html({ size: 20, title: 'Sportsvyn' }), /role="img" aria-label="Sportsvyn"/); assert.match(html({ size: 20 }), /aria-hidden="true"/);
});
