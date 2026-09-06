// app/daily/subLineStyle.test.mjs - the Weekly's and Draft's .yr .sub line,
// verified by the ACTUAL WINNING CSS RULE (relay 2c item 2), not a read of
// the rule that was meant to apply. See lib/testing/computedStyle.mjs for
// why a source read is not enough - the exact same file's .hdr .clock rule
// already lost silently to an unrelated .clock rule once.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadSkeleton, computed } from '../../lib/testing/computedStyle.mjs';

const CSS = path.join(path.dirname(fileURLToPath(import.meta.url)), 'daily.css');

// Both pages share the .weekly scope (draft/page.js's own Shell wraps in
// className="weekly" too - see the ADAPT-DON'T-CONSTRUCT note there), so
// the real ancestor chain for either page is identical.
const SKELETON = '<div class="weekly"><div class="yr"><div class="sub" id="target">'
  + 'Six slots. No clock. Any six from the full pool, full PPR, and whatever is '
  + 'saved at first kickoff is your entry.</div></div></div>';

test('.weekly .yr .sub renders 400 weight, #B8B8B3, 13px - the mock exactly', () => {
  const { window, target } = loadSkeleton(CSS, SKELETON);
  const cs = computed(target, window);
  assert.equal(cs.fontWeight, '400');
  assert.equal(cs.color, 'rgb(184, 184, 179)'); // #B8B8B3
  assert.equal(cs.fontSize, '13px');
});
