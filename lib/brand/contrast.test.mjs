import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decalColor, relativeLuminance, contrastRatio, parseHex, INK, PAPER } from './contrast.js';

test('the decal is ink on a light shell and paper on a dark one - both ends and the middle', () => {
  assert.equal(decalColor('#FFFFFF'), INK); assert.equal(decalColor('#000000'), PAPER);
  assert.equal(decalColor('#F5F5F2'), INK, 'a paper-colored shell gets ink');
  assert.equal(decalColor('#0A0A0A'), PAPER, 'an ink-colored shell gets paper');
  assert.equal(decalColor('#FFB612'), INK, 'Steelers gold: light');
  assert.equal(decalColor('#D3BC8D'), INK, 'Saints old gold: light');
  assert.equal(decalColor('#002244'), PAPER, 'Patriots navy: dark');
  assert.equal(decalColor('#E31837'), PAPER, 'Chiefs red: dark');
  assert.equal(decalColor('#4495D2'), INK, 'Titans light blue: luminance 0.28 - ink wins 6.6:1 over paper 2.9:1');
});

test('the rule is contrast, not a hue table: it agrees with the WCAG ratio at every point', () => {
  for (const hex of ['#000000', '#404040', '#777777', '#808080', '#999999', '#BBBBBB', '#FFFFFF', '#97233F', '#69BE28', '#FFC20E']) {
    const want = contrastRatio(hex, INK) >= contrastRatio(hex, PAPER) ? INK : PAPER;
    assert.equal(decalColor(hex), want, hex);
  }
});

test('luminance and parsing', () => {
  assert.equal(relativeLuminance('#FFFFFF'), 1); assert.equal(relativeLuminance('#000000'), 0);
  assert.deepEqual(parseHex('#97233F'), [0x97, 0x23, 0x3F]); assert.deepEqual(parseHex('97233f'), [0x97, 0x23, 0x3F]);
  assert.equal(parseHex('#FFF'), null); assert.equal(parseHex(''), null); assert.equal(parseHex(null), null);
  assert.equal(contrastRatio('#FFFFFF', '#000000'), 21);
  assert.equal(decalColor('not-a-color'), PAPER, 'unparseable never throws');
});
