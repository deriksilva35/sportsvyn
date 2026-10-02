// The og palette is the arcade palette, value for value (app/globals.css).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { OG_ARCADE } from './ogPalette.js';

test('every og literal equals its --arcade-* token in app/globals.css', () => {
  const css = readFileSync(new URL('../../app/globals.css', import.meta.url), 'utf8');
  const map = { page: 'page', ink: 'ink', primary: 'primary', volt: 'volt', muted: 'muted', surface2: 'surface-2', line: 'line' };
  for (const [k, tok] of Object.entries(map)) {
    const m = new RegExp(`--arcade-${tok}:\\s*(#[0-9A-Fa-f]{3,8})`).exec(css);
    assert.ok(m, `--arcade-${tok} exists`);
    assert.equal(OG_ARCADE[k].toUpperCase(), m[1].toUpperCase(), k);
  }
});
