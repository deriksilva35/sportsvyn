// lib/daily/shareCardFonts.test.mjs - the share card's faces (relay mon-18/19).
//
// Rubik-Regular.ttf (400) and Rubik-SemiBold.ttf (600) came from the Mac
// (mac-mon-3) and are committed in assets/fonts with OFL-Rubik.txt. HARD
// assertions now: present, real TTF, registered at 400 and 600, and - for
// EVERY face the card registers - static: no 'fvar' table (Satori is given
// statics only, never a variable font).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { shareCardFonts, RUBIK_FILES, FONT_DIR, FALLBACK_FILE, MONO_FILE } from './shareCardFonts.js';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const at = (f) => path.join(REPO, FONT_DIR, f);

/** The sfnt table tags of a TTF/OTF buffer (offset table + table directory). */
function sfntTables(buf) {
  const tag = buf.subarray(0, 4);
  const ok = tag.equals(Buffer.from([0, 1, 0, 0])) || ['OTTO', 'true'].includes(tag.toString('latin1'));
  if (!ok) return null;
  const n = buf.readUInt16BE(4);
  return Array.from({ length: n }, (_, i) => buf.subarray(12 + i * 16, 16 + i * 16).toString('latin1'));
}

test('Rubik Regular and SemiBold are committed, real static TTFs, with the OFL licence beside them', () => {
  assert.equal(RUBIK_FILES[400], 'Rubik-Regular.ttf');
  assert.equal(RUBIK_FILES[600], 'Rubik-SemiBold.ttf');
  for (const f of ['Rubik-Regular.ttf', 'Rubik-SemiBold.ttf', MONO_FILE, FALLBACK_FILE]) {
    assert.ok(existsSync(at(f)), `${f} is committed in ${FONT_DIR}`);
    const tables = sfntTables(readFileSync(at(f)));
    assert.ok(tables, `${f} is a TTF/OTF (not woff/woff2)`);
    assert.ok(tables.includes('glyf') || tables.includes('CFF '), `${f} carries outlines`);
  }
  assert.ok(existsSync(at('OFL-Rubik.txt')), 'OFL-Rubik.txt sits beside the Rubik TTFs');
  assert.match(readFileSync(at('OFL-Rubik.txt'), 'utf8'), /SIL OPEN FONT LICENSE/i);
});

test('the renderer registers Rubik 400 and 600 from their OWN files - no Bold stand-in', async () => {
  const { fonts, fallbacks } = await shareCardFonts(REPO);
  assert.deepEqual(fallbacks, [], 'no weight fell back to Rubik-Bold.ttf');
  const byWeight = Object.fromEntries(fonts.filter((f) => f.name === 'Rubik').map((f) => [f.weight, f.data]));
  assert.ok(byWeight[400].equals(readFileSync(at('Rubik-Regular.ttf'))), '400 is Rubik-Regular.ttf');
  assert.ok(byWeight[600].equals(readFileSync(at('Rubik-SemiBold.ttf'))), '600 is Rubik-SemiBold.ttf');
  assert.ok(byWeight[700].equals(readFileSync(at('Rubik-Bold.ttf'))), '700 is Rubik-Bold.ttf');
});

test('STATICS ONLY: every face the card registers has no fvar table', async () => {
  const { fonts } = await shareCardFonts(REPO);
  assert.ok(fonts.length >= 4);
  for (const f of fonts) {
    const tables = sfntTables(Buffer.from(f.data));
    assert.ok(tables, `${f.name} ${f.weight} is an sfnt`);
    assert.ok(!tables.includes('fvar'), `${f.name} ${f.weight} is a VARIABLE font (fvar) - Satori gets statics only`);
  }
});

test('a missing weight is still drawn from Rubik Bold under that weight - the card degrades, never 500s', async () => {
  const fake = async (p) => {
    if (p.endsWith('Rubik-Regular.ttf') || p.endsWith('Rubik-SemiBold.ttf')) throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
    return Buffer.from(path.basename(p));
  };
  const { fonts, fallbacks } = await shareCardFonts('/repo', fake);
  assert.deepEqual(fallbacks, ['Rubik-Regular.ttf', 'Rubik-SemiBold.ttf']);
  const rubik = fonts.filter((f) => f.name === 'Rubik');
  assert.deepEqual(rubik.map((f) => f.weight), [400, 600, 700]);
  for (const f of rubik) assert.equal(String(f.data), 'Rubik-Bold.ttf');
});
