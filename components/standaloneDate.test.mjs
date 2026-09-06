// components/standaloneDate.test.mjs - StandaloneDate and its date-only
// sibling StandaloneDateOnly (relay 2c-fix item 1). Rendered output, not
// source - the same lesson relay 2c item 1 already pinned for the pre-open
// hero lines. renderToStaticMarkup never runs an effect, so this exercises
// exactly the SSR/first-paint render: the ET fallback both components are
// specified to open with, before hydration swaps in the visitor's own zone.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderJsxExport } from '../lib/testing/renderJsx.mjs';

const DIR = path.dirname(fileURLToPath(import.meta.url));
const DATE_FILE = path.join(DIR, 'StandaloneDate.js');
const DATE_ONLY_FILE = path.join(DIR, 'StandaloneDateOnly.js');

// 2026-09-08T13:00:00Z is 9:00 AM EDT.
const OPENS_AT = '2026-09-08T13:00:00Z';
// 2026-09-10T00:20:00Z is 8:20 PM EDT the PREVIOUS day - the exact instant
// relay 2c's own PROD dry run used to catch a UTC/ET date-pairing mistake.
const LOCKS_AT = '2026-09-10T00:20:00Z';

test('StandaloneDate: SSR/ET fallback carries the full date, time and zone', async () => {
  const html = await renderJsxExport(DATE_FILE, 'default', { iso: LOCKS_AT });
  assert.equal(html, 'Wed Sep 9 · 8:20 PM ET');
});

test('StandaloneDateOnly: SSR/ET fallback is a bare date - no time, no zone label', async () => {
  const html = await renderJsxExport(DATE_ONLY_FILE, 'default', { iso: OPENS_AT });
  assert.equal(html, 'Tue Sep 8');
  // Never a time, never a trailing zone abbreviation - the whole reason this
  // sibling exists instead of reusing StandaloneDate for the "opens" clause.
  assert.doesNotMatch(html, /:\d\d|AM|PM|ET|PT|CT|MT/);
});
