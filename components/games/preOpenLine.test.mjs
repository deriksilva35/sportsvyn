// components/games/preOpenLine.test.mjs - the glued-middot regression
// (relay 2c item 1). RENDERED output, not source text: a source-level grep
// for '·' not preceded by a space passed clean on the buggy version of this
// sentence, because the space genuinely was in the JSX source - the bug
// only exists once React actually renders the text child. See
// lib/testing/renderJsx.mjs and components/games/preOpenLine.js for the
// full story, including this test's own coverage boundary (a plain React
// render, not the RSC pipeline the real pages render through).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderJsxExport } from '../../lib/testing/renderJsx.mjs';

const FILE = path.join(path.dirname(fileURLToPath(import.meta.url)), 'preOpenLine.js');

function assertNoGluedMiddot(html, label) {
  assert.doesNotMatch(html, />·/, `${label}: '·' glued to a tag boundary with no space`);
  assert.doesNotMatch(html, /·</, `${label}: '·' glued to the next tag with no space`);
  assert.doesNotMatch(html, /\w·/, `${label}: a word character sits directly against '·'`);
  assert.doesNotMatch(html, /·\w/, `${label}: '·' sits directly against the next word character`);
}

test('WeeklyPreOpenLine renders with a real space on both sides of every middot', async () => {
  const html = await renderJsxExport(FILE, 'WeeklyPreOpenLine');
  assertNoGluedMiddot(html, 'WeeklyPreOpenLine');
  // Pinned positive, not just an absence check - the sentence itself must
  // still be there, spaced, not merely free of the one broken pattern.
  assert.match(html, / · edit until <b>first kickoff<\/b> · results Tuesday morning/);
});

test('DraftPreOpenLine renders with a real space on both sides of every middot', async () => {
  const html = await renderJsxExport(FILE, 'DraftPreOpenLine');
  assertNoGluedMiddot(html, 'DraftPreOpenLine');
  assert.match(html, /Draft against the room · <b>best ball<\/b> · results Tuesday morning/);
});
