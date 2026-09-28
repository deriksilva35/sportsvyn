// lib/brand/firstPaint.test.mjs - the first frame is the page colour.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { firstPaintColor, dataTheme, THEME_COLOR } from './theme.js';

test('the ground follows the SAME flag as data-theme', () => {
  assert.equal(firstPaintColor({}), '#0A0A0A', 'dark: the dark --tok-page');
  assert.equal(firstPaintColor({ ARCADE_THEME: 'on' }), '#FFFFFF', 'arcade: the page white');
  for (const env of [{}, { ARCADE_THEME: 'on' }, { ARCADE_THEME: 'off' }]) {
    assert.equal(firstPaintColor(env), dataTheme(env) === 'arcade' ? THEME_COLOR.arcade : THEME_COLOR.dark);
  }
});

test('it equals the dark --tok-page, so it adds no colour of its own', () => {
  const css = readFileSync(new URL('../../app/globals.css', import.meta.url), 'utf8');
  assert.match(css, /--tok-page: #0A0A0A;/);
  assert.equal(firstPaintColor({}), '#0A0A0A');
});

test('THE ROOT LAYOUT SETS IT ON <html>, ahead of everything in <head>', () => {
  const layout = readFileSync(new URL('../../app/layout.js', import.meta.url), 'utf8');
  const html = layout.slice(layout.indexOf('<html'), layout.indexOf('<body'));
  assert.match(html, /style=\{\{ backgroundColor: firstPaintColor\(\) \}\}/);
  assert.match(html, /data-theme=\{dataTheme\(\)\}/, 'beside the theme attribute it tracks');
});
