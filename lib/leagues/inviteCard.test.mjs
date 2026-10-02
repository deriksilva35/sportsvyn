// The /j/<key> invite card (Leagues V1 P4): the og:image file convention, its
// committed fonts, the arcade literals from one palette, and the absolute URL.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const src = (f) => readFileSync(path.join(REPO, f), 'utf8');

test('the invite card is app/j/[code]/opengraph-image.js, 1200x630, fonts read from assets/fonts', () => {
  const s = src('app/j/[code]/opengraph-image.js');
  assert.match(s, /export const size = \{ width: 1200, height: 630 \}/);
  assert.match(s, /join\(process\.cwd\(\), 'assets\/fonts\/RubikMonoOne-Regular\.ttf'\)/);
  for (const f of ['RubikMonoOne-Regular.ttf', 'Rubik-Bold.ttf']) assert.ok(existsSync(path.join(REPO, 'assets/fonts', f)), f);
  assert.ok(!/#[0-9a-fA-F]{3,8}\b/.test(s), 'colours come from lib/brand/ogPalette.js');
  assert.match(s, /invitePreview\(code\)/, 'the preview read - no code, token or roster on the card');
});

test('/j sets an absolute metadataBase so the unfurl can fetch the card', () => {
  assert.match(src('app/j/[code]/page.js'), /metadataBase: new URL\('https:\/\/sportsvyn\.com'\)/);
});
