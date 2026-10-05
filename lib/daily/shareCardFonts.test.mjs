// lib/daily/shareCardFonts.test.mjs - the share card's faces (relay mon-18 item 5).
//
// DEPENDENCY, NAMED: assets/fonts/Rubik-Regular.ttf and Rubik-SemiBold.ttf are
// being committed by the Mac relay (mac-mon-3). Until they land the card draws
// those weights from Rubik-Bold.ttf, and the "expected files" test below is
// SKIPPED with a message naming each missing file - visible in every run, never
// red. Once both are committed it runs and asserts they are real TTFs.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { shareCardFonts, RUBIK_FILES, FONT_DIR, FALLBACK_FILE, MONO_FILE } from './shareCardFonts.js';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const EXPECTED = ['Rubik-Regular.ttf', 'Rubik-SemiBold.ttf'];
const missing = EXPECTED.filter((f) => !existsSync(path.join(REPO, FONT_DIR, f)));

test('the card asks for exactly these two static TTFs, at 400 and 600', () => {
  assert.equal(RUBIK_FILES[400], 'Rubik-Regular.ttf');
  assert.equal(RUBIK_FILES[600], 'Rubik-SemiBold.ttf');
  for (const f of [MONO_FILE, FALLBACK_FILE]) assert.ok(existsSync(path.join(REPO, FONT_DIR, f)), `${f} is committed`);
});

test(`EXPECTED FONT FILES from mac-mon-3: ${EXPECTED.join(', ')}`,
  { skip: missing.length ? `AWAITING mac-mon-3 - not yet in ${FONT_DIR}: ${missing.join(', ')} (card falls back to ${FALLBACK_FILE})` : false },
  () => {
    for (const f of EXPECTED) {
      const head = readFileSync(path.join(REPO, FONT_DIR, f)).subarray(0, 4);
      assert.ok(head.equals(Buffer.from([0, 1, 0, 0])) || head.toString('latin1') === 'OTTO' || head.toString('latin1') === 'true', `${f} is a TTF/OTF, not woff2`);
    }
  });

test('a missing weight is drawn from Rubik Bold, registered under that weight - the card still renders', async () => {
  const fake = async (p) => {
    if (p.endsWith('Rubik-Regular.ttf') || p.endsWith('Rubik-SemiBold.ttf')) throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
    return Buffer.from(path.basename(p));
  };
  const { fonts, fallbacks } = await shareCardFonts('/repo', fake);
  assert.deepEqual(fallbacks, ['Rubik-Regular.ttf', 'Rubik-SemiBold.ttf']);
  const rubik = fonts.filter((f) => f.name === 'Rubik');
  assert.deepEqual(rubik.map((f) => f.weight), [400, 600, 700]);
  for (const f of rubik) assert.equal(String(f.data), 'Rubik-Bold.ttf');
  assert.equal(String(fonts.find((f) => f.name === 'RubikMono').data), 'RubikMonoOne-Regular.ttf');
});

test('when the files are there, each weight gets its own face', async () => {
  const { fonts, fallbacks } = await shareCardFonts('/repo', async (p) => Buffer.from(path.basename(p)));
  assert.deepEqual(fallbacks, []);
  assert.deepEqual(fonts.filter((f) => f.name === 'Rubik').map((f) => [f.weight, String(f.data)]),
    [[400, 'Rubik-Regular.ttf'], [600, 'Rubik-SemiBold.ttf'], [700, 'Rubik-Bold.ttf']]);
});
