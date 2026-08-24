// lib/seo/analytics.test.mjs - Web Analytics is wired, and stays aggregate.
//
// The project-level feature had been provisioned since launch; the CLIENT
// SCRIPT was never added, so nine days of App Store traffic went unmeasured.
// These pins keep both halves honest: the component present, and nothing
// user-identifying ever handed to it.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const src = (rel) => readFileSync(path.join(REPO, rel), 'utf8');

test('the analytics script is mounted in the root layout', () => {
  const t = src('app/layout.js');
  assert.match(t, /import \{ Analytics \} from '@vercel\/analytics\/next'/);
  assert.match(t, /<Analytics \/>/);
  // Inside <body>, or it never loads.
  const body = t.slice(t.indexOf('<body'), t.indexOf('</body>'));
  assert.match(body, /<Analytics \/>/);
  assert.match(src('package.json'), /"@vercel\/analytics"/);
});

test('NOTHING USER-IDENTIFYING IS HANDED TO ANALYTICS', () => {
  // The automatic pageview payload is Vercel's own (path, referrer, country,
  // device) and carries no identity. What WE must never do is call track()
  // with a handle, an email or a user id - so the codebase may not pass one.
  const files = ['app/layout.js'];
  for (const rel of files) {
    const t = src(rel);
    assert.ok(!/track\(/.test(t), `${rel} sends no custom event payload`);
  }
  // If a custom event is ever added, this pin is where the argument gets
  // reviewed: search the whole app for track( calls carrying identity.
  const layout = src('app/layout.js');
  assert.ok(!/userId|handle|email/i.test(layout.slice(layout.indexOf('<Analytics'))),
    'no identity near the analytics mount');
});
